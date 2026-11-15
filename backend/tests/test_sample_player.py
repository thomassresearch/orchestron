from __future__ import annotations

from pathlib import Path
import shutil
import struct
import subprocess
from threading import Event
from time import perf_counter

import numpy as np
import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.sample_voices import SampleVoices
from backend.app.models.audio import AudioGraph, MixerState
from backend.app.models.patch import Connection, NodeInstance
from backend.app.models.sample_player import SampleMap
from backend.app.services.compiler_common import CompilationError, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.sample_asset_service import decode_sample, verify_sample_assets
from backend.tests.csound_test_support import load_patch_fixture

SAMPLES = Path(__file__).parent / "fixtures" / "sample_player"


@pytest.fixture
def media(tmp_path):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg and FFprobe are required for sample ingestion tests.")
    return GenAssetService(tmp_path / "audio")


def upload(media, name):
    return decode_sample(SAMPLES / name, name, media)


@pytest.mark.parametrize("name,channels,frames", [
    ("mono.wav", 1, 24000), ("stereo.wav", 2, 12000),
    ("stereo.mp3", 2, 12000), ("long.wav", 1, 480000), ("tiny.wav", 1, 3),
    ("stereo.m4a", 2, 12288), ("mono-alac.m4a", 1, 24000),
])
def test_sample_ingestion_identity_and_metadata(media, name, channels, frames):
    result = upload(media, name)
    assert (result.asset.playback.channels, result.asset.playback.frame_count) == (channels, frames)
    source = media.resolve_audio_path(result.asset.source.stored_name)
    assert source.read_bytes() == (SAMPLES / name).read_bytes()
    assert upload(media, name).asset_id == result.asset_id
    verify_sample_assets({result.asset_id: result.asset}, media)


def test_m4a_detection_uses_content_and_rejects_truncated_audio(media, tmp_path):
    renamed = tmp_path / "upload.bin"
    original = (SAMPLES / "stereo.m4a").read_bytes()
    renamed.write_bytes(original)
    result = decode_sample(renamed, "recording.M4A", media)
    assert result.asset.source.format == "m4a"
    assert result.asset.source.original_name == "recording.M4A"
    before = set(media.audio_dir.iterdir())
    renamed.write_bytes(original[:-200])
    with pytest.raises(ValueError, match="truncated M4A"):
        decode_sample(renamed, "broken.m4a", media)
    assert set(media.audio_dir.iterdir()) == before


@pytest.mark.parametrize("mode", ["surround", "multiple", "unsupported"])
def test_m4a_rejects_unsupported_streams(media, tmp_path, mode):
    target = tmp_path / "invalid.m4a"
    args = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(SAMPLES / "stereo.wav")]
    if mode == "surround":
        args += ["-ac", "3"]
    elif mode == "multiple":
        args += ["-map", "0:a", "-map", "0:a"]
    args += ["-c:a", "mp3" if mode == "unsupported" else "aac", "-f", "mp4", str(target)]
    subprocess.run(args, check=True)
    with pytest.raises(ValueError, match="audio stream|audio channels"):
        decode_sample(target, target.name, media)
    assert not list(media.audio_dir.iterdir())


@pytest.mark.parametrize("name", ["surround.wav", "corrupt.wav"])
def test_sample_ingestion_failure_keeps_storage_clean(media, name):
    with pytest.raises(ValueError):
        upload(media, name)
    assert not list(media.audio_dir.iterdir())


def test_sample_media_validation_rejects_truncated_mp3_and_nonfinite_audio(media, tmp_path):
    from backend.app.services.sample_asset_service import _canonical

    truncated = tmp_path / "truncated.mp3"
    truncated.write_bytes((SAMPLES / "stereo.mp3").read_bytes()[:-288])
    with pytest.raises(ValueError, match="missing audio frames|Truncated"):
        decode_sample(truncated, truncated.name, media)
    raw = tmp_path / "fixture.pcm"
    wav = tmp_path / "float.wav"
    raw.write_bytes(struct.pack("<128f", *([1.75] * 127 + [float("nan")])))
    _canonical(wav, raw, channels=1, size=512)
    with pytest.raises(ValueError, match="floating-point"):
        decode_sample(wav, wav.name, media)
    assert not list(media.audio_dir.iterdir())
    raw.write_bytes(struct.pack("<128f", *([1.75] * 128)))
    _canonical(wav, raw, channels=1, size=512)
    uploaded = decode_sample(wav, wav.name, media)
    assert uploaded.asset.source.stored_name == uploaded.asset.playback.stored_name
    assert media.resolve_audio_path(uploaded.asset.playback.stored_name).read_bytes() == wav.read_bytes()


def test_cancel_during_sample_commit_rolls_back_first_file(media, monkeypatch):
    canceled = Event()
    original = media.import_audio_chunks_with_stored_name

    def first_file(*args, **kwargs):
        file = original(*args, **kwargs)
        canceled.set()
        return file

    monkeypatch.setattr(media, "import_audio_chunks_with_stored_name", first_file)
    with pytest.raises(ValueError, match="canceled"):
        decode_sample(SAMPLES / "mono.wav", "mono.wav", media, canceled=canceled)
    assert not list(media.audio_dir.iterdir())


def test_frozen_mp3_waveform_can_be_used_on_another_decoder_build(media):
    reference = np.frombuffer((SAMPLES / "stereo-from-mp3.f32.wav").read_bytes()[44:], dtype="<f4")
    result = upload(media, "stereo.mp3").asset.playback
    signal = np.frombuffer(media.resolve_audio_path(result.stored_name).read_bytes()[44:], dtype="<f4")
    assert result.channels == 2 and result.frame_count == 12000
    np.testing.assert_allclose(signal, reference, atol=3e-5, rtol=2e-4)


def test_composite_upload_quota_rolls_back_new_source_and_retains_existing(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg required.")
    store = GenAssetService(tmp_path, max_audio_assets_count=2)
    existing = store.store_audio_bytes(filename="legacy.wav", content_type=None, payload=b"legacy")
    with pytest.raises(ValueError, match="quota"):
        upload(store, "mono.wav")
    assert [item.name for item in tmp_path.iterdir()] == [existing.stored_name]


@pytest.mark.parametrize("note", [-1, 128, True, 0.5, "36"])
def test_sample_map_requires_strict_integer_notes(note):
    with pytest.raises(ValueError, match="note"):
        SampleMap.model_validate({"version": 1, "entries": [{"note": note, "assetId": "sample-a"}]})


def test_sample_map_rejects_collisions_and_orders_endpoints():
    def sample(note):
        return {"note": note, "assetId": "sample-a"}

    value = SampleMap.model_validate({"version": 1, "entries": [sample(127), sample(0)]})
    assert [entry.note for entry in value.entries] == [0, 127]
    with pytest.raises(ValueError, match="unique MIDI notes"):
        SampleMap.model_validate({"version": 1, "entries": [sample(36), sample(36)]})
    for version in (True, 1.0, 2):
        with pytest.raises(ValueError, match="version"):
            SampleMap.model_validate({"version": version, "entries": []})


def test_invalid_graphs_and_empty_standalone_compilation():
    compiler = CompilerService(OpcodeService("/icons"))
    patch = load_patch_fixture("sample_player")
    assert any("no mapped notes" in warning for warning in compiler.compile_patch(patch, "0", "null").diagnostics)
    target = PatchInstrumentTarget(patch, 1, "sample", always_on=True)
    with pytest.raises(CompilationError):
        compiler.compile_patch_bundle([target], "0", "null")
    patch.graph.nodes.append(NodeInstance(id="legato", opcode="midi_legato"))
    with pytest.raises(CompilationError) as error:
        compiler.compile_patch(patch, "0", "null")
    assert "MIDI Legato" in str(error.value.diagnostics)
    patch.graph.nodes.pop()
    patch.graph.nodes.append(patch.graph.nodes[0].model_copy(update={"id": "second"}))
    with pytest.raises(CompilationError, match="compilation"):
        compiler.compile_patch(patch, "0", "null")


def render(worker, frames, *, block=32, rate=48000):
    chunks = []
    for start in range(0, frames // block, 512):
        result = worker.render_blocks(block_count=min(512, frames // block - start), target_sample_rate=rate)
        chunks.append(np.frombuffer(result.pcm_f32le, dtype="<f4").reshape(-1, 2))
    return np.concatenate(chunks)


def send(worker, source, sample, *, note=36, velocity=96, channel=1):
    assert worker.enqueue_timestamped_midi([0x90 + channel - 1, note, velocity], source=source, target_engine_sample=sample)


def start_native(media, monkeypatch, targets, *, mixer=None, graph=None):
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)
    worker = CsoundWorker(gen_audio_assets_dir=str(media.audio_dir))
    if worker.backend != "ctcsound":
        pytest.skip("Native Csound is not installed.")
    compiler = CompilerService(OpcodeService("/icons"), media)
    compile_started = perf_counter()
    artifact = compiler.compile_patch_bundle(targets, "0", "null", audio_graph=graph or AudioGraph(), mixer=mixer)
    startup = perf_counter()
    worker.start(artifact.csd, "0", "null")
    print(f"sample compile {startup - compile_started:.4f}s; native start {perf_counter() - startup:.4f}s")
    return worker, artifact


def test_mixer_short_gate_overlap_and_cancel_after_ordinary_release(media, monkeypatch):
    patch = load_patch_fixture("sample_player")
    long = upload(media, "long.wav").asset.playback
    output = patch.graph.nodes.pop()
    patch.graph.nodes.append(NodeInstance(id="factor", opcode="const_a", params={"value": .5}))
    for side in ("left", "right"):
        gain = f"gain-{side}"
        patch.graph.nodes.append(NodeInstance(id=gain, opcode="a_mul"))
        patch.graph.nodes.append(output.model_copy(update={"id": side, "opcode": "outleta", "params": {"sname": side}}))
        edge = next(c for c in patch.graph.connections if c.to_port_id == side)
        edge.to_node_id, edge.to_port_id = gain, "a"
        patch.graph.connections.extend([
            Connection(from_node_id="factor", from_port_id="aout", to_node_id=gain, to_port_id="b"),
            Connection(from_node_id=gain, from_port_id="aout", to_node_id=side, to_port_id="asignal"),
        ])
    graph = AudioGraph(masterId="$master", routes=[
        {"id": "l", "sourceId": "sampler", "sourcePort": "left", "targetId": "$master",
         "targetPort": "left", "targetStage": "input"},
        {"id": "r", "sourceId": "sampler", "sourcePort": "right", "targetId": "$master",
         "targetPort": "right", "targetStage": "input"},
    ])
    # A downstream mixer strip applies half gain to the complete long tail.
    mixer = MixerState(strips={"sampler": {"gainDb": -6.020599913279624}})
    target = PatchInstrumentTarget(patch, 1, "sampler", samples={36: long})
    worker, artifact = start_native(media, monkeypatch, [target], mixer=mixer, graph=graph)
    try:
        start = perf_counter()
        send(worker, "lane:drumrow:A:first", 0, velocity=64)
        send(worker, "lane:drumrow:A:first", 960, velocity=0)
        send(worker, "lane:B", 0, velocity=32)
        # B's key is held after the sample ends. It still stops naturally.
        before = render(worker, 4_800)
        worker.release_lane_events(["drumrow:A:first"])
        after = render(worker, 4_800)
        tail = render(worker, 471_424)
        print(f"10s sample rendered in {perf_counter() - start:.4f}s, table budget {(long.frame_count+2)*8} bytes")
        assert len(artifact.manifest["sampleBindings"]) == 1
        assert np.array_equal(before[:, 0], before[:, 1])
        assert np.max(before[:, 0]) == pytest.approx(0.04578, abs=.00025)
        assert np.max(after[1000:, 0]) == pytest.approx(.01526, abs=.00025)

        assert np.max(tail[-4400:-2250, 0]) > .01
        assert np.array_equal(tail[-1024:], np.zeros((1024, 2)))
        assert not worker._sample_voices.active
    finally:
        worker.stop()
    reference, _ = start_native(media, monkeypatch, [target], mixer=mixer, graph=graph)
    try:
        send(reference, "lane:B", 0, velocity=32)
        baseline = render(reference, 9_600)
        # Leftover PCM becomes exactly B's waveform after the cancellation ramp.
        np.testing.assert_array_equal(after[256:], baseline[4_800 + 256:])
        np.testing.assert_allclose(before, 3 * baseline[:4_800], atol=1e-7)
    finally:
        reference.stop()


@pytest.mark.parametrize("rate,block", [(44100, 32), (48000, 1)])
def test_instance_map_stereo_identity_and_unmapped_notes(media, monkeypatch, rate, block):
    patch = load_patch_fixture("sample_player")
    patch.graph.engine_config.sr = rate
    patch.graph.engine_config.ksmps = block
    mono = upload(media, "mono.wav").asset.playback
    stereo = upload(media, "stereo.mp3").asset.playback
    targets = [
        PatchInstrumentTarget(patch, 1, "a", samples={36: mono, 127: stereo}),
        PatchInstrumentTarget(patch, 2, "b", samples={36: stereo}),
    ]
    worker, artifact = start_native(media, monkeypatch, targets)
    try:
        assert artifact.orc.count("ftgen 0, 0, 0, -1") == 2
        send(worker, "external", 0, note=37)
        assert not np.any(render(worker, block * 200, block=block, rate=rate))
        send(worker, "external", worker.render_sample_cursor)
        signal = render(worker, block * 200, block=block, rate=rate)
        assert np.any(signal) and np.array_equal(signal[:, 0], signal[:, 1])
        worker.panic()
        render(worker, 640, block=block, rate=rate)
        send(worker, "external", worker.render_sample_cursor, channel=2)
        signal = render(worker, block * 400, block=block, rate=rate)
        assert np.any(signal) and not np.array_equal(signal[:, 0], signal[:, 1])
        if block > 1:
            # Samples retain source rate even when engine rate changes.
            segment = signal[800:8000]
            values = np.abs(np.fft.rfft((segment - segment.mean(axis=0)) * np.hanning(len(segment))[:, None], axis=0))
            peaks = np.argmax(values[1:], axis=0) + 1
            np.testing.assert_allclose(peaks * rate / len(segment), [220, 550], atol=rate / len(segment))
    finally:
        worker.stop()


def test_layer_cancellation_and_polyphony():
    voices = SampleVoices({1: (1, {36: (0, 1, 4800)})}, 48000, 1)
    message = bytes([0x90, 36, 1])
    normal = voices.attack(message, "lane:a", 0)
    preview = voices.attack(message, "lane:a\x00audition:abc", 0)
    assert voices.cancel(1000, sources=frozenset(("lane:a\x00audition:abc",))) == [preview]
    assert normal.end == 4800 and preview.end == 1240
    for _ in range(62):
        assert voices.attack(message, "lane:b", 1000)
    assert not voices.attack(message, "lane:b", 1000)
    assert voices.dropped == 1
    assert voices.attack(message, "lane:a\x00audition:other", 1240)
    assert len(voices.cancel(1300, sources=frozenset(("lane:a",)))) == 2


def test_offline_source_cancel_retires_tails_and_discards_later_queued_attacks():
    from backend.app.services.performance_export_service import CapturedMidiEvent, PerformanceExportService

    origin = "lane:arp\x01lane:drumrow:kit:a"
    events = [
        CapturedMidiEvent(0, bytes((0x90, 36, 96)), 1, origin),
        CapturedMidiEvent(.02, bytes((0x80, 36, 0)), 2, origin),
        CapturedMidiEvent(0, bytes((0x90, 36, 64)), 3, "lane:independent"),
        CapturedMidiEvent(.1, bytes((0x90, 36, 100)), 4, origin),
        CapturedMidiEvent(.2, bytes((0x90, 36, 100)), 5, origin),
        CapturedMidiEvent(.1, bytes((0x90, 36, 32)), 7, origin),
    ]
    cancels = [(4800, 6, frozenset(("lane:drumrow:kit:a",)))]
    lines, end, drops = PerformanceExportService._sample_score_lines(
        events, cancels, {1: (1, {36: (0, 1, 24000)})}, .25,
    )
    fields = [line.split() for _, line in lines]
    assert [int(row[5]) for row in fields] == [96, 64, 32]
    assert [float(row[3]) for row in fields] == [.105, .5, .5]
    assert [float(row[11]) for row in fields] == [.1, -1, -1]
    assert end == 2.6 and drops == 0


def test_tiny_sample_onsets_and_repeated_native_engine_starts(media, monkeypatch):
    patch = load_patch_fixture("sample_player")
    patch.graph.engine_config.ksmps = 1
    tiny = upload(media, "tiny.wav").asset.playback
    target = PatchInstrumentTarget(patch, 1, "tiny", samples={0: tiny})
    worker, artifact = start_native(media, monkeypatch, [target])
    try:
        for index in range(3):
            if index:
                worker.start(artifact.csd, "0", "null")
            for at in range(0, 4000, 4):
                send(worker, "retrigger", at, note=0, velocity=127)
            pcm = render(worker, 4004, block=1)
            assert not worker._sample_voices.active and worker.sample_voice_overflow_count == 0
            assert np.count_nonzero(pcm[:4000, 0]) == 2000
            assert not np.any(pcm[4000:])
            assert np.array_equal(pcm[:, 0], pcm[:, 1])
            worker.stop()
    finally:
        worker.stop()
