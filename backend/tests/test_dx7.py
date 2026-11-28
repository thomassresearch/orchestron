from base64 import b64encode
import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from backend.app.models.dx7 import INIT_VOICE, node_voice, read_sysex
from backend.app.models.patch import Connection, NodeInstance
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_render_resources import analyze_render_resources
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_controller_service import controller_bindings
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, note_events, render

FIXTURES = Path(__file__).parent / "fixtures/dx7"


def test_bundled_presets_are_distinct_playable_voices():
    catalog = Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json"
    presets = json.loads(catalog.read_text())["presets"]
    assert [preset["id"] for preset in presets] == list(range(1, 33))
    voices = [node_voice(preset) for preset in presets]
    assert len({voice[:145] for voice in voices}) == 32
    for preset, voice in zip(presets, voices, strict=True):
        compiled, targets = compile_guitars([patch(voice)], mode="host", ksmps=32)
        events = note_events([(0.032, 60, 108, 1.15)])
        audio, _ = render(compiled, targets, events, 1.4, mode="host")
        assert np.isfinite(audio).all() and 0.001 < abs(audio).max() < 1, preset["name"]
        selected_orc, selected_targets = compile_guitars([patch()], mode="host", ksmps=32, settings=[{"__dx7_program": preset["id"]}])
        actual, _ = render(selected_orc, selected_targets, events, 1.4, mode="host")
        np.testing.assert_array_equal(actual, audio, err_msg=preset["name"])


def patch(voice=INIT_VOICE):
    result = load_patch_fixture("dx7")
    next(n for n in result.graph.nodes if n.opcode == "fm_dx7").params["voice"] = b64encode(voice).decode()
    return result


@pytest.mark.parametrize("preview", [False, True])
def test_rack_preset_latches_new_notes_and_returns_to_editor_voice(preview):
    p = patch(read_sysex((FIXTURES / "tine_keys.syx").read_bytes())[0])
    bank = json.loads((Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json").read_text())["presets"]
    compiled, targets = compile_guitars([p], mode="host", ksmps=32, fm6_preview=preview)
    channel = controller_bindings(targets[0], "guitar0")["__dx7_program"]["channel"]
    notes = [(0, 60, 96, .32), (.096, 48, 108, .24), (.192, 72, 96, .18)]
    actual, _ = render(compiled, targets, note_events(notes), .55, mode="host",
                       controller_updates=[(.064, channel, 7), (.16, channel, 0)])
    expected = np.zeros_like(actual)
    for source, events in [(p, [notes[0], notes[2]]), (patch(node_voice(bank[6])), [notes[1]])]:
        artifact, parts = compile_guitars([source], mode="host", ksmps=32)
        signal, _ = render(artifact, parts, note_events(events), .55, mode="host")
        expected += signal
    np.testing.assert_allclose(actual, expected, atol=1e-10)


@pytest.mark.parametrize("mode", ["score", "midi"])
def test_csd_exports_embed_rack_selected_preset(mode):
    preset = json.loads((Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json").read_text())["presets"][-1]
    events = note_events([(.032, 60, 96, .12)])
    def play(instrument, settings):
        artifact, targets = compile_guitars([instrument], mode=mode, ksmps=1, settings=[settings])
        return render(artifact, targets, events, .35, mode=mode)[0]
    np.testing.assert_array_equal(play(patch(), {"__dx7_program": 32}), play(patch(node_voice(preset)), {}))


def pack_voice(voice):
    data = bytearray()
    for i in range(0, 126, 21):
        op = voice[i : i + 21]
        data.extend(op[:11])
        data.extend(
            (op[11] | op[12] << 2, op[13] | op[20] << 3, op[14] | op[15] << 2, op[16], op[17] | op[18] << 1, op[19])
        )
    return (
        data
        + voice[126:135]
        + bytes([voice[135] | voice[136] << 3])
        + voice[137:141]
        + bytes([voice[141] | voice[142] << 1 | voice[143] << 4])
        + voice[144:]
    )


def bank(voices):
    data = b"".join(pack_voice(v) for v in voices)
    return bytes([240, 67, 15, 9, 32, 0]) + data + bytes([-sum(data) % 128, 247])


def test_cartridge_and_invalid_dumps():
    from backend.app.models.dx7 import VOICE_MAX

    voices = [INIT_VOICE] * 30 + [bytes(VOICE_MAX), read_sysex((FIXTURES / "iron_bell.syx").read_bytes())[0]]
    dump = bank(voices)
    assert read_sysex(dump) == voices
    for broken in [
        dump[:-1],
        dump[:-2] + bytes([dump[-2] ^ 1, 247]),
        dump.replace(b"\xf0\x43", b"\xf0\x44", 1),
        dump[:3] + b"\x00" + dump[4:],
        dump + dump,
        bytes([240, 67, 32]) + dump[3:],
    ]:
        with pytest.raises(ValueError):
            read_sysex(broken)
    for bad in ("", True, b64encode(bytes([127]) * 155).decode()):
        with pytest.raises(ValidationError, match="DX7"):
            NodeInstance(id="n", opcode="fm_dx7", params={"voice": bad}, position={"x": 0, "y": 0})
    assert node_voice({}) == INIT_VOICE


@pytest.mark.parametrize("parameter", [8, 19], ids=["scaling-breakpoint", "fine-tuning"])
def test_cartridge_preserves_extended_operator_values(parameter):
    extended = bytearray(INIT_VOICE)
    extended[4 * 21 + parameter] = 127
    assert read_sysex(bank([INIT_VOICE] * 31 + [extended]))[-1] == bytes(extended)


def test_udo_emitted_once_shared_readonly_voice_and_per_note_state():
    artifact, targets = compile_guitars([patch(), patch()], mode="host")
    assert artifact.orc.count("opcode fm_dx7, ak,") == 1
    assert artifact.orc.count("[] fillarray " + ", ".join(map(str, INIT_VOICE[:145]))) == 1
    assert not analyze_render_resources(targets, OpcodeService("/static/icons")).blockers
    p = patch()
    p.always_on = True
    with pytest.raises(CompilationError):
        compile_guitars([p])


def test_live_reserves_shared_udos_and_matches_both_portable_exports():
    voice, = read_sysex((FIXTURES / "loop_brass.syx").read_bytes())
    notes = note_events([(0, 48 + key, 96, .032 if key % 2 else .064) for key in range(16)])
    rendered = []
    orchestras = []
    for mode in ("host", "midi", "score"):
        artifact, targets = compile_guitars([patch(voice)], mode=mode, ksmps=1)
        assert ('prealloc "vcs_dx7_voice", 16, 1' in artifact.orc) == (mode == "host")
        assert ('prealloc "vcs_dx7_operator", 96, 1' in artifact.orc) == (mode == "host")
        orchestras.append(artifact.orc.split("opcode vcs_dx7_voice,", 1)[1].split("endop", 1)[0])
        # The live PCM stream and exported WAV both use IEEE 32-bit float.
        audio, _ = render(artifact, targets, notes, .15, mode=mode)
        rendered.append(audio.astype("<f4"))
    assert orchestras[0] == orchestras[1] == orchestras[2]
    assert np.max(abs(rendered[0])) > .001
    np.testing.assert_array_equal(rendered[0], rendered[1])
    np.testing.assert_array_equal(rendered[0], rendered[2])


def test_all_algorithms_render_including_multi_operator_feedback():
    voice = bytearray(read_sysex((FIXTURES / "loop_brass.syx").read_bytes())[0])
    for algo in range(32):
        voice[134] = algo
        artifact, targets = compile_guitars([patch(voice)], mode="host")
        audio, _ = render(artifact, targets, note_events([(0, 60, 112, 0.048)]), 0.12, mode="host")
        assert np.isfinite(audio).all() and max(abs(audio[:, 0])) > 0.001, algo


@pytest.mark.parametrize("algorithm", [3, 6, 4], ids=["one-operator", "two-operator", "three-operator"])
@pytest.mark.parametrize("mode,block", [("host", 32), ("midi", 1), ("score", 1)])
def test_maximum_feedback_matches_mark_i_body_spectrum(algorithm, mode, block):
    from tools.dx7.qualify import spectrum

    voice = bytearray(read_sysex((FIXTURES / "loop_brass.syx").read_bytes())[0])
    voice[134] = algorithm - 1
    artifact, targets = compile_guitars([patch(voice)], mode=mode, ksmps=block)
    audio, _ = render(artifact, targets, note_events([(.064, 60, 112, .064)]), .16, mode=mode)
    body = spectrum(audio[4608:6144, 0])
    with np.load(FIXTURES / "mark_i_feedback_spectra.npz") as reference:
        assert body @ reference[f"algorithm_{algorithm}"] > .998


def test_sixteen_notes_equal_independent_voices_with_early_releases():
    (voice,) = read_sysex((FIXTURES / "loop_brass.syx").read_bytes())
    artifact, targets = compile_guitars([patch(voice)], mode="host", ksmps=32)
    notes = [(0, 48 + i, 40 + 4 * i, 0.064 if i % 2 else 0.192) for i in range(16)]

    def play(events):
        audio, _ = render(artifact, targets, note_events(events), 0.384, mode="host")
        return audio[:, 0]

    chord = play(notes)
    singles = [play([n]) for n in notes]
    assert all(np.max(abs(tone)) > 0.001 for tone in singles)
    np.testing.assert_allclose(chord, np.sum(singles, axis=0), atol=1e-8)


def test_exported_midi_and_score_use_same_voice_and_release():
    (voice,) = read_sysex((FIXTURES / "iron_bell.syx").read_bytes())
    notes = note_events([(0.032, 60, 112, 0.064)])
    signals = []
    for mode in ("midi", "score"):
        artifact, targets = compile_guitars([patch(voice)], mode=mode, ksmps=1)
        audio, _ = render(artifact, targets, notes, 0.35, mode=mode)
        assert abs(audio[5000:6000]).max() > 0.0001
        signals.append(audio)
    np.testing.assert_allclose(*signals, atol=1e-8)


def test_preview_latches_operator_algorithm_and_cancel_per_note():
    from backend.app.services.compiler_fm6 import preview_channel, preview_values, preview_writes

    opening, = read_sysex((FIXTURES / "tine_keys.syx").read_bytes())
    edited = bytearray(opening)
    edited[134] = 3  # algorithm 4 includes a three-operator feedback loop
    edited[135] = 7
    edited[5 * 21 + 3] = 35
    edited[5 * 21 + 16] = 70
    before, after = patch(opening), patch(edited)
    compiled, targets = compile_guitars([before], mode="host", ksmps=32, fm6_preview=True)
    initial = preview_values(before)["dx7"]
    values = preview_values(after)["dx7"]
    assert len(initial) == 145 and len(preview_writes("guitar0", "dx7", initial, values)) == 145
    with pytest.raises(ValueError, match="DX7"):
        preview_writes("guitar0", "dx7", initial, {"dx7_134": 32})
    updates = [(time, preview_channel("guitar0","dx7",key), v) for time, changes in [(0.064, values), (.192, initial)]
               for key, v in changes.items()]
    notes = [(0, 60, 112, .24), (.128, 65, 100, .08), (.256, 72, 90, .08)]
    mixed, _ = render(compiled, targets, note_events(notes), .48, mode="host", controller_updates=updates)
    expected = np.zeros_like(mixed)
    for p, events in [(before, [notes[0], notes[2]]), (after, [notes[1]])]:
        ordinary, t = compile_guitars([p], mode="host", ksmps=32)
        signal, _ = render(ordinary, t, note_events(events), .48, mode="host")
        expected += signal
    np.testing.assert_allclose(mixed, expected, atol=1e-9)


def release_patch(preset, seconds=0, voices=None):
    catalog = json.loads((Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json").read_text())
    instrument = patch(node_voice(catalog["presets"][preset - 1]))
    next(n for n in instrument.graph.nodes if n.opcode == "fm_dx7").params["imaxrelease"] = seconds
    if voices is not None:
        instrument.graph.nodes.append(NodeInstance(id="polyphony", opcode="maxalloc", params={"icount": voices}))
    return instrument


def render_observed(instrument, notes, seconds, mode="host", *, block=32):
    artifact, targets = compile_guitars([instrument], mode=mode, ksmps=block)
    # The normal instrument is centered. Add the physical instance count to the
    # right channel after mixing, so subtraction leaves a sample-aligned trace.
    artifact.orc += """
instr dx7_test_observer
 kCount active 1
 outch 2, a(kCount)
endin
alwayson "dx7_test_observer"
"""
    audio, _ = render(artifact, targets, note_events(notes), seconds, mode=mode)
    return audio[:, 0], np.rint(audio[:, 1] - audio[:, 0])


@pytest.mark.parametrize(("mode", "block"), [("host", 32), ("midi", 1), ("score", 1)])
@pytest.mark.parametrize("preset", [9, 30])
def test_fast_dx7_voices_have_smooth_note_edges(mode, block, preset):
    audio, _ = render_observed(release_patch(preset), [(.032, 60, 108, .16)], .23, mode, block=block)
    start, release = 1536, 9216  # Block-aligned at 48 kHz.
    peak = np.max(abs(audio[start:release]))
    assert peak > .01
    assert audio[start] == 0
    assert np.max(abs(audio[start:start + 48])) < .16 * peak
    # The fast R4 used to drop into silence in under 3 ms. Follow the
    # tail through the taper and check that its final cut is inaudible.
    assert np.max(abs(audio[release + 240:release + 384])) > .05 * peak
    assert np.max(abs(audio[release + 480:])) < .001 * peak


@pytest.mark.parametrize(("mode", "block"), [("host", 32), ("midi", 1), ("score", 1)])
def test_release_cap_starts_at_keyup_and_fades_long_patch(mode, block):
    notes = [(0, 60, 96, 1.28)]
    capped, count = render_observed(release_patch(21, 1), notes, 2.35, mode, block=block)
    native, _ = render_observed(release_patch(21), notes, 2.35, mode, block=block)
    np.testing.assert_array_equal(capped[:100000], native[:100000])
    assert np.max(abs(native[-960:])) > .0001
    assert np.max(abs(capped[int(2.28*48000):])) < 1e-10
    assert count[-1] == 0
    # A still-loud Low Mist tapers progressively before the deadline.
    for time, expected in [(2.23, .5), (2.27, .028)]:
        window = slice(int(time * 48000), int(time * 48000) + 32)
        assert np.max(abs(capped[window])) / np.max(abs(native[window])) == pytest.approx(expected, abs=.025)


def test_expired_clock_click_retires_while_held_and_rising_release_voices_are_preserved():
    note = [(0, 60, 96, .64)]
    _, count = render_observed(release_patch(16, voices=2), note, .9)
    assert count[1200] == 1
    assert count[24000] == 0  # All remaining carrier targets are already silent while held.
    assert count[-1] == 0  # Previously retained a slot for another 25.48 seconds.
    v = bytearray(INIT_VOICE)
    v[105:113] = bytes([99, 99, 99, 25, 0, 0, 0, 99])  # OP1 rises from silence on release.
    sound, count = render_observed(patch(v), note, 1.5)
    assert count[-1] == 1
    assert np.max(abs(sound[-4800:])) > np.max(abs(sound[24000:28800])) * 3


@pytest.mark.parametrize(("mode", "block"), [("host", 32), ("midi", 1), ("score", 1)])
def test_steal_fades_quietest_released_voice_and_preserves_louder_tail(mode, block):
    # Make loudness velocity-dependent and use a long release. The oldest and
    # loudest note must survive when the third note replaces the quieter tail.
    v = bytearray(INIT_VOICE)
    v[108], v[120] = 20, 7
    p = patch(v)
    p.graph.nodes.append(NodeInstance(id="limit", opcode="maxalloc", params={"icount": 2}))
    notes = [(0, 48, 120, .16), (.032, 55, 85, .128), (.224, 72, 110, .096)]
    poly, count = render_observed(p, notes, .48, mode, block=block)
    singles = [render_observed(p, [n], .48, mode, block=block)[0] for n in notes]
    victim = singles[1]
    outgoing = poly - singles[0] - singles[2]
    start = round(.224 * 48000)
    np.testing.assert_allclose(outgoing[:start], victim[:start], atol=1e-10)
    assert np.max(abs(victim[start:start+960])) > 1e-5
    # Throughout the handoff the removed contribution follows a smooth gain
    # ramp. A hard cut, rejected attack, or wrong victim fails this comparison.
    valid = np.flatnonzero(abs(victim[start:start+960]) > 1e-7) + start
    gain = outgoing[valid] / victim[valid]
    assert gain[0] > .95 and np.min(gain) >= -1e-6
    assert np.max(np.abs(np.diff(gain) / np.diff(valid))) < .004
    np.testing.assert_allclose(outgoing[start+600:], 0, atol=1e-10)
    assert count[start+600] == 2


def test_stolen_held_voice_finishes_and_its_later_keyup_leaves_successor_playing():
    notes = [(0, 48, 110, .24), (.096, 72, 96, .38)]
    instrument = release_patch(28, voices=1)
    audio, count = render_observed(instrument, notes, .52)
    successor, _ = render_observed(instrument, notes[1:], .52)
    np.testing.assert_allclose(audio[5600:], successor[5600:], atol=1e-10)
    assert count[6000] == 1 and count[14000] == 1


def test_other_audio_source_keeps_its_own_release_after_dx7_silence():
    instrument = release_patch(16, voices=2)
    instrument.graph.nodes.append(NodeInstance(id="other", opcode="const_a", params={"value": .25}))
    instrument.graph.connections.append(Connection(from_node_id="other", from_port_id="aout",
                                                   to_node_id="output_pan2", to_port_id="asig"))
    audio, count = render_observed(instrument, [(0, 60, 96, .64)], 1)
    assert count[-1] == 1 and np.max(abs(audio[-480:])) > .01


def test_release_controller_is_sampled_only_at_note_start():
    p = release_patch(21)
    p.graph.nodes.append(NodeInstance(id="tail", opcode="perf_controller", params={
        "label": "Max release", "controller_type": "integer", "min": 0, "max": 120, "default": 0}))
    p.graph.connections.append(Connection(from_node_id="tail", from_port_id="iout", to_node_id="dx7", to_port_id="imaxrelease"))
    compiled, targets = compile_guitars([p], mode="host", ksmps=32)
    channel = controller_bindings(targets[0], "guitar0")["tail"]["channel"]
    notes = [(0, 60, 96, .16), (.096, 67, 96, .24)]
    actual, _ = render(compiled, targets, note_events(notes), 1.6, mode="host",
                       controller_updates=[(.064, channel, 1), (.224, channel, 0)])
    native, _ = render_observed(release_patch(21), notes[:1], 1.6)
    capped, _ = render_observed(release_patch(21, 1), notes[1:], 1.6)
    np.testing.assert_allclose(actual[:, 0], native + capped, atol=1e-10)


def test_sixteen_occupied_slots_accept_a_new_chord_and_reclaim_the_fading_instances():
    p = release_patch(24, voices=16)
    chord = [(0, key, 96, .064) for key in range(48, 64)]
    replacement = [(.096, key, 96, .128) for key in range(64, 80)]
    mix, count = render_observed(p, chord + replacement, .3)
    new, _ = render_observed(p, replacement, .3)
    old, _ = render_observed(p, chord, .3)
    np.testing.assert_allclose(mix[:4608], old[:4608], atol=1e-10)
    np.testing.assert_allclose(mix[5400:], new[5400:], atol=1e-10)
    assert count[3000] == count[5400] == 16
    assert count[4700] == 32  # Both chords render during the short handoff.


def test_rack_instances_have_independent_voice_limits():
    p = release_patch(24, voices=1)
    a = [(0, 48, 96, .08), (.16, 60, 96, .14)]
    b = [(.032, 72, 110, .28)]
    compiled, targets = compile_guitars([p, p], mode="host", ksmps=32)
    mix, _ = render(compiled, targets, note_events(a, 0) + note_events(b, 1), .4, mode="host")
    first, _ = render_observed(p, a, .4)
    second, _ = render_observed(p, b, .4)
    np.testing.assert_allclose(mix[:, 0], first + second, atol=1e-10)


@pytest.mark.parametrize("mode,subfolder", [("midiFile", False), ("score", True)])
def test_instance_banks_render_from_standalone_archives(tmp_path, mode, subfolder):
    from copy import deepcopy
    from io import BytesIO
    import shutil
    import subprocess
    import zipfile

    from backend.app.models.export import PerformanceCsdExportRequest
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.gen_asset_service import GenAssetService
    from backend.app.services.performance_export_service import PerformanceExportService
    from backend.app.services.sample_asset_service import _wav_format
    from backend.tests.test_api import _performance_csd_export_payload

    csound = shutil.which("csound")
    if not csound:
        pytest.skip("Standalone Csound required")
    payload = _performance_csd_export_payload()
    payload.update(eventSource=mode, samplesInSubfolder=subfolder)
    exported = payload["performanceExport"]
    definition = exported["patch_definitions"][0]
    definition["graph"] = load_patch_fixture("dx7").graph.model_dump(mode="json")
    config = exported["performance"]["config"]
    config.update(version=29, instruments=[], audioGraph={"routes": []})
    tracks = payload["sequencerConfig"]["tracks"]
    tracks.append({**deepcopy(tracks[0]), "track_id": "second", "midi_channel": 2})
    voices = [read_sysex((FIXTURES / filename).read_bytes())[0] for filename in ("iron_bell.syx", "tine_keys.syx")]
    shared = bank([INIT_VOICE] * 32)
    dumps = [bank([INIT_VOICE] * 31 + [voice]) for voice in voices]
    def cartridge(raw):
        return {"name": "cartridge.syx", "data": b64encode(raw).decode()}

    for index, (side, dump) in enumerate(zip(("left", "right"), dumps, strict=True), 1):
        config["instruments"].append(dict(id=side, midiChannel=index, patchId=definition["sourcePatchId"],
            dx7Banks={"1": cartridge(shared), "16": cartridge(dump)},
            performanceControllerValues={"__dx7_bank": 16, "__dx7_program": 32}))
        config["audioGraph"]["routes"].append(dict(id=side, sourceId=side, sourcePort=side, targetId="$output", targetPort=side))
    config["instruments"].append(dict(id="unused", midiChannel=3, patchId=definition["sourcePatchId"],
        dx7Banks={"2": cartridge(bank(list(reversed([INIT_VOICE] * 31 + [voices[0]]))))}))

    expected = deepcopy(payload)
    reference = expected["performanceExport"]
    reference["patch_definitions"] = []
    reference["performance"]["config"]["instruments"].pop()
    for row, voice in zip(reference["performance"]["config"]["instruments"], voices, strict=True):
        row.pop("dx7Banks")
        row.pop("performanceControllerValues")
        row["patchId"] = row["id"]
        reference["patch_definitions"].append({**definition, "sourcePatchId": row["id"],
            "graph": patch(voice).graph.model_dump(mode="json")})

    exporter = PerformanceExportService(CompilerService(OpcodeService("/static/icons")), GenAssetService(tmp_path / "assets"))
    signals = []
    for index, data in enumerate((payload, expected)):
        package = exporter.build_performance_csd_archive(PerformanceCsdExportRequest.model_validate(data))
        dest = tmp_path / str(index)
        with zipfile.ZipFile(BytesIO(package)) as archive:
            prefix = "assets/" if subfolder else ""
            main = archive.read("Offline_Export/Offline_Export.csd").decode()
            assert main.count(f'#include "{prefix}fm_dx7.udo"') == 1
            voice = archive.read(f"Offline_Export/{prefix}fm_dx7.udo").decode()
            assert [line for line in voice.splitlines() if line.startswith("opcode ")] == [
                "opcode fm_dx7, ak, iikii[]o", "opcode fm_dx7, a, iikii[]o"]
            members = [n for n in archive.namelist() if n.endswith(".syx")]
            if index == 0:
                assert len(members) == 3 and {archive.read(n) for n in members} == {*dumps, shared}
                assert all(("/assets/" in n) == subfolder for n in members)
            archive.extractall(dest)
        csd = next(dest.rglob("*.csd"))
        completed = subprocess.run([csound, csd.name], cwd=csd.parent, capture_output=True, timeout=30)
        assert completed.returncode == 0, completed.stderr
        wav = csd.with_suffix(".wav")
        _, channels, rate, _, _, offset, size = _wav_format(wav)
        assert rate == 48000 and channels == 2
        signals.append(np.frombuffer(wav.read_bytes(), dtype="<f4", count=size // 4, offset=offset).reshape(-1, 2))
    np.testing.assert_array_equal(*signals)
    assert min(abs(signals[0]).max(axis=0)) > .001
    assert not np.array_equal(signals[0][:, 0], signals[0][:, 1])


def test_instance_bank_and_program_latch_per_note():
    from backend.app.models.dx7 import Dx7Cartridge
    voice, = read_sysex((FIXTURES / "loop_brass.syx").read_bytes())
    cartridge = Dx7Cartridge(name="brass.syx", data=b64encode(bank([voice] * 32)).decode())
    source = patch()
    artifact, targets = compile_guitars([source], mode="host", ksmps=32, dx7_banks=[{"1": cartridge}])
    controls = controller_bindings(targets[0], "guitar0")
    assert "__dx7_program" in controls
    bank_channel = controls["__dx7_bank"]["channel"]
    program_channel = controls["__dx7_program"]["channel"]
    notes = [(0, 60, 96, .34), (.096, 68, 108, .22), (.192, 72, 96, .16)]
    signal, _ = render(artifact, targets, note_events(notes), .5, mode="host",
        controller_updates=[(.064, bank_channel, 1), (.064, program_channel, 32), (.16, program_channel, 0)])
    expected = np.zeros_like(signal)
    for instrument, events in [(source, [notes[0], notes[2]]), (patch(voice), [notes[1]])]:
        ordinary, parts = compile_guitars([instrument], mode="host", ksmps=32)
        audio, _ = render(ordinary, parts, note_events(events), .5, mode="host")
        expected += audio
    np.testing.assert_allclose(signal, expected, atol=1e-10)


@pytest.mark.parametrize("with_cartridges", [True, False])
def test_parallel_workers_own_their_dx7_banks_and_voice_reserves(with_cartridges):
    from backend.app.models.audio import AudioGraph, MixerState
    from backend.app.models.dx7 import Dx7Cartridge
    from backend.app.models.render_protocol import RendererPolicy
    from backend.app.services.compiler_common import PatchInstrumentTarget
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.render_partition_plan import plan_render_partitions
    from backend.tests.render_plan_support import synthetic_costs
    from backend.tools._sequential_partition_probe import compare_sequential
    from backend.app.engine.ctcsound_loader import load_ctcsound_module

    targets, routes = [], []
    for i, voice in enumerate(("iron_bell", "loop_brass")):
        cartridge = Dx7Cartridge(name=voice + ".syx", data=b64encode(
            bank(read_sysex((FIXTURES / (voice + ".syx")).read_bytes()) * 32)).decode())
        identity = f"source{i}"
        targets.append(PatchInstrumentTarget(patch(), i + 1, identity,
            dx7_banks={"1": cartridge} if with_cartridges else {},
            performance_controller_values={"__dx7_bank": int(with_cartridges), "__dx7_program": 1}))
        routes.extend(dict(id=identity+side, sourceId=identity, sourcePort=side, targetId="$master", targetPort=side)
                      for side in ("left", "right"))
    graph = AudioGraph(masterId="$master", routes=routes)
    compiler = CompilerService(OpcodeService("/static/icons"))
    deps = compiler.analyze_realtime_graph(targets, graph)
    reserves = [r for r in deps.resources if r.resource == "dx7:voice-reserve"]
    assert {r.stage for r in reserves} == {"patch:source0", "patch:source1"}
    assert all(r.memory_bytes >= 112 * 1024**2 for r in reserves)
    plan = plan_render_partitions(deps, policy=RendererPolicy(mode="parallel", max_workers=4), costs=synthetic_costs(deps))
    compiled = compiler.compile_realtime_partitions(targets, graph, MixerState(), plan)
    assert len(compiled.programs) >= 2
    for program in compiled.programs:
        local_dx7 = any("patch:" + target.assignment_id in program.stages for target in targets)
        assert ('prealloc "vcs_dx7_voice", 16, 1' in program.csd) == local_dx7
        for target in targets:
            if with_cartridges:
                assert (target.dx7_banks["1"].digest in program.csd) == ("patch:" + target.assignment_id in program.stages)
    result = compare_sequential(compiled, plan, frames=6144, events=[(0, [144, 60, 100]), (256, [145, 72, 100])],
                                module=load_ctcsound_module())
    assert np.max(abs(result.canonical)) > .001
    np.testing.assert_array_equal(result.partitioned, result.canonical)
