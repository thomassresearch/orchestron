"""Real Csound phrase boundaries, through the host scheduler and both export inputs."""

from contextlib import contextmanager
import re

import numpy as np
import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, MixerState
from backend.app.models.patch import NodeInstance
from backend.app.services.compiler_common import CompilationError, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_export_service import CapturedMidiEvent, PerformanceExportService
from backend.tests.csound_test_support import load_patch_fixture


@pytest.fixture(autouse=True)
def native_engine_environment(monkeypatch):
    # API tests deliberately force a mock engine; these are native DSP tests.
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "browser_clock")


def compile_legato(ksmps=32, mode="score", copies=1, mixer=False, patch=None):
    targets = []
    for index in range(copies):
        p = (patch or load_patch_fixture("midi_legato")).model_copy(deep=True)
        p.graph.engine_config.ksmps = ksmps
        p.graph.engine_config.control_rate = 48000 / ksmps
        targets.append(PatchInstrumentTarget(patch=p, midi_channel=index + 1, assignment_id=f"flute{index}"))
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets,
        midi_input="0",
        rtmidi_module="none",
        performance_input_mode=mode,
        audio_graph=AudioGraph() if mixer else None,
        mixer=MixerState() if mixer else None,
    )
    return artifact, targets


def observe(orc):
    """Expose compiler-local state only in the test orchestra, without altering DSP."""
    index = 0

    def instrument(match):
        nonlocal index
        body = match.group(0)
        if "VCS_LEGATO_PHRASE:" not in body:
            return body
        freq = re.search(r"(k_\w+) = cpsmidinn\(gk_", body)[1]
        vel = re.search(r"(k_\w+) portk gk_", body)[1]
        env = re.search(r"(k_\w+) vcs_legato_adsr", body)[1]
        body = body.replace(
            "rireturn",
            "\n".join(
                [
                    f'chnset {value}, "test_{index}_{name}"'
                    for name, value in {
                        "pitch": freq,
                        "velocity": vel,
                        "envelope": env,
                        "phrase": "k_vcs_legato_phrase",
                        "gate": "k_vcs_legato_gate",
                    }.items()
                ]
            )
            + "\nrireturn",
        )
        index += 1
        return body

    return re.sub(r"(?m)^instr .*?^endin", instrument, orc, flags=re.S | re.M)


@contextmanager
def run_engine(artifact, score="f 0 2", *, host=False, midi_file=None):
    cs = load_ctcsound_module().Csound()
    worker = CsoundWorker() if host else None
    if host:
        worker._configure_host_midi_callbacks(cs)
    options = "-n -d -m0" + (" -M0" if host else "") + (f" --midifile={midi_file}" if midi_file else "")
    csd = f"<CsoundSynthesizer>\n<CsOptions>\n{options}\n</CsOptions>\n<CsInstruments>\n{observe(artifact.orc)}\n</CsInstruments>\n<CsScore>\n{score}\n</CsScore>\n</CsoundSynthesizer>"
    try:
        assert cs.compileCsdText(csd) == 0
        assert cs.start() == 0
        yield cs, worker
    finally:
        cs.cleanup()
        cs.reset()


def render_trace(artifact, score, *, seconds=0.6, events=None, midi_file=None, copies=1):
    audio, states = [], []
    with run_engine(artifact, score, host=events is not None, midi_file=midi_file) as (cs, worker):
        if events is not None:
            for time, message in events:
                worker._midi_scheduler.enqueue(message, source="test", target_engine_sample=round(time * 48000))
        block = cs.ksmps()
        for start in range(0, round(seconds * 48000), block):
            if worker:
                worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + block)
            assert cs.performKsmps() == 0
            audio.append(cs.spout().copy().reshape(-1, 2))
            states.append(
                [
                    [
                        cs.controlChannel(f"test_{i}_{name}")[0]
                        for name in ("pitch", "velocity", "envelope", "phrase", "gate")
                    ]
                    for i in range(copies)
                ]
            )
    return np.concatenate(audio), np.asarray(states)


def at(trace, time, ksmps=32, instance=0):
    return trace[round(time * 48000 / ksmps), instance]


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


@pytest.mark.parametrize("ksmps", [1, 32])
@pytest.mark.parametrize("notes", [(60, 64, 67), (67, 64, 60), (60, 60, 60)])
def test_touching_notes_preserve_envelope_phase_and_change_pitch_immediately(ksmps, notes):
    artifact, _ = compile_legato(ksmps)
    score = (
        "\n".join(f"i 1 {start} .1 {note} 80 {i + 1} 1" for i, (start, note) in enumerate(zip((0.1, 0.2, 0.3), notes)))
        + "\nf 0 1"
    )
    audio, trace = render_trace(artifact, score)
    for time, note in zip((0.1, 0.2, 0.3), notes):
        assert at(trace, time, ksmps)[0] == pytest.approx(hz(note))
        assert at(trace, time, ksmps)[3:] == pytest.approx([1, 1])
    assert at(trace, 0.2, ksmps)[2] == pytest.approx(0.8)
    assert at(trace, 0.3, ksmps)[2] == pytest.approx(0.8)
    assert at(trace, 0.52, ksmps)[2:] == pytest.approx([0, 1, 0])
    if len(set(notes)) == 1:
        held, _ = render_trace(artifact, "i 1 .1 .3 60 80\nf 0 1")
        np.testing.assert_allclose(audio, held, atol=1e-12)


@pytest.mark.parametrize("on_first", [False, True])
@pytest.mark.parametrize("repeated", [False, True])
def test_host_midi_atomic_boundary_and_last_note_priority(on_first, repeated):
    artifact, _ = compile_legato(mode="midi")
    note = 60 if repeated else 67
    change = [[0x90, note, 120], [0x80, 60, 0]] if on_first else [[0x80, 60, 0], [0x90, note, 120]]
    events = [(0.1, [0x90, 60, 64]), *[(0.2, m) for m in change], (0.3, [0x80, note, 0])]
    _, trace = render_trace(artifact, "f 0 1", events=events)
    assert at(trace, 0.2)[0] == pytest.approx(hz(note))
    assert at(trace, 0.2)[2:] == pytest.approx([0.8, 1, 1])
    assert at(trace, 0.45)[2:] == pytest.approx([0, 1, 0])
    # The new velocity's remaining distance halves in exactly 10 ms.
    initial = at(trace, 0.2)[1]
    assert (120 / 128 - at(trace, 0.21)[1]) / (120 / 128 - initial) == pytest.approx(0.5, abs=1e-10)


@pytest.mark.parametrize("mode", ["score", "midi"])
def test_overlap_falls_back_and_gap_interrupts_release_with_new_articulation(mode):
    artifact, _ = compile_legato(mode=mode)
    events = [
        (0.1, [0x90, 60, 70]),
        (0.15, [0x90, 67, 110]),
        (0.2, [0x90, 64, 90]),
        (0.23, [0x80, 64, 0]),
        (0.25, [0x80, 67, 0]),
        (0.3, [0x80, 60, 0]),
        (0.31, [0x90, 72, 100]),
        (0.4, [0x80, 72, 0]),
    ]
    score = "i 1 .1 .2 60 70 1 1\ni 1 .15 .1 67 110 2 1\ni 1 .2 .03 64 90 3 1\ni 1 .31 .09 72 100 4 1\nf 0 1"
    audio, trace = render_trace(
        artifact, score if mode == "score" else "f 0 1", events=events if mode == "midi" else None
    )
    for time, note in [(0.2, 64), (0.23, 67), (0.25, 60), (0.31, 72)]:
        assert at(trace, time)[0] == pytest.approx(hz(note))
    assert at(trace, 0.3)[2:] == pytest.approx([0.8, 1, 0])
    assert at(trace, 0.31)[2:] == pytest.approx([0, 2, 1])
    assert abs(audio[round(0.31 * 48000), 0] - audio[round(0.31 * 48000) - 1, 0]) < 1e-10
    assert at(trace, 0.52)[2:] == pytest.approx([0, 2, 0])


@pytest.mark.parametrize("controller", [120, 123])
def test_panic_and_new_phrase(controller):
    artifact, _ = compile_legato(mode="midi")
    events = [
        (0.1, [0x90, 60, 80]),
        (0.15, [0x90, 67, 100]),
        (0.2, [0xB0, controller, 0]),
        (0.25, [0x90, 64, 90]),
        (0.35, [0x80, 64, 0]),
    ]
    _, trace = render_trace(artifact, "f 0 1", events=events)
    assert at(trace, 0.2)[4] == 0
    assert at(trace, 0.25)[2:] == pytest.approx([0, 2, 1])
    assert at(trace, 0.5)[2:] == pytest.approx([0, 2, 0])


def test_two_mixer_instances_have_separate_notes_and_phrases():
    artifact, _ = compile_legato(mode="midi", copies=2, mixer=True)
    assert (
        artifact.manifest["instrumentReferences"]["flute0"] != artifact.manifest["noteInstrumentReferences"]["flute0"]
    )
    events = [
        (0.1, [0x90, 60, 64]),
        (0.15, [0x91, 72, 110]),
        (0.2, [0x90, 67, 100]),
        (0.2, [0x80, 60, 0]),
        (0.25, [0x81, 72, 0]),
        (0.3, [0x91, 69, 90]),
        (0.4, [0x80, 67, 0]),
        (0.4, [0x81, 69, 0]),
    ]
    _, trace = render_trace(artifact, "f 0 1", events=events, copies=2)
    assert at(trace, 0.2, instance=0)[0] == pytest.approx(hz(67))
    assert at(trace, 0.2, instance=1)[0] == pytest.approx(hz(72))
    assert at(trace, 0.3, instance=0)[3:] == pytest.approx([1, 1])
    assert at(trace, 0.3, instance=1)[3:] == pytest.approx([2, 1])


def test_rapid_touching_notes_do_not_hit_maxalloc():
    artifact, _ = compile_legato()
    score = "\n".join(f"i 1 {(0.1 + i * 0.002):.6f} .002 {60 + i % 12} 100 {i + 1} 1" for i in range(100)) + "\nf 0 1"
    _, trace = render_trace(artifact, score)
    for i in range(100):
        assert at(trace, 0.1 + i * 0.002)[0] == pytest.approx(hz(60 + i % 12))
        assert at(trace, 0.1 + i * 0.002)[3] == 1


def test_score_export_preserves_chord_priority_and_collectors(tmp_path):
    artifact, targets = compile_legato(1)
    # Later note is lower and shorter: neither note sorting nor p3 sorting may win.
    data = [
        (0.1, [0x90, 72, 70]),
        (0.1, [0x90, 60, 100]),
        (0.2, [0x80, 60, 0]),
        (0.3, [0xB0, 120, 0]),
        (0.35, [0x90, 64, 100]),
        (0.42, [0x80, 64, 0]),
    ]
    events = [CapturedMidiEvent(t, bytes(m), i) for i, (t, m) in enumerate(data)]
    exporter = PerformanceExportService(compiler_service=None, gen_asset_service=None)
    lines, warnings = exporter._build_score_lines(
        events=events, targets=targets, duration_seconds=0.6, manifest=artifact.manifest
    )
    assert not warnings
    _, score_trace = render_trace(artifact, "\n".join(lines))
    assert at(score_trace, 0.1, 1)[0] == pytest.approx(hz(60))
    assert at(score_trace, 0.2, 1)[0] == pytest.approx(hz(72))
    import mido

    midi = mido.MidiFile(ticks_per_beat=24000)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    previous = 0
    for t, m in data:
        ticks = round(t * 48000)
        msg = mido.Message.from_bytes(m)
        msg.time = ticks - previous
        previous = ticks
        track.append(msg)
    midi.save(tmp_path / "notes.mid")
    midi_artifact, _ = compile_legato(1, mode="midi")
    _, midi_trace = render_trace(midi_artifact, "f 0 1", midi_file=tmp_path / "notes.mid")
    np.testing.assert_allclose(score_trace, midi_trace, atol=1e-10)


def test_validation_rejects_duplicate_or_continuous_legato():
    patch = load_patch_fixture("midi_legato")
    patch.graph.nodes.append(NodeInstance(id="second", opcode="midi_legato"))
    with pytest.raises(CompilationError, match="Patch compilation failed") as err:
        compile_legato(patch=patch)
    assert "exactly one" in str(err.value.diagnostics)
    patch.graph.nodes.pop()
    patch.always_on = True
    with pytest.raises(CompilationError) as err:
        compile_legato(patch=patch)
    assert "Continuous" in str(err.value.diagnostics)


@pytest.mark.parametrize("same_pitch", [False, True])
def test_source_cancellation_and_stop_release_only_owned_notes(same_pitch):
    artifact, _ = compile_legato(mode="midi")
    with run_engine(artifact, host=True) as (cs, worker):
        scheduler = worker._midi_scheduler

        def send(source, note):
            scheduler.enqueue([0x90, note, 100], source=source, target_engine_sample=0)

        def block(start):
            worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + 32)
            assert cs.performKsmps() == 0

        send("one", 60)
        block(0)
        send("two", 60 if same_pitch else 67)
        block(32)
        scheduler.release_sources({"two"}, sample=64)
        block(64)
        assert cs.controlChannel("test_0_gate")[0] == 1
        assert cs.controlChannel("test_0_pitch")[0] == pytest.approx(hz(60))
        scheduler.release_sources({"one"}, sample=96)
        block(96)
        assert cs.controlChannel("test_0_gate")[0] == 0
        worker._midi_scheduler.reset()
        cs.stop()


def test_all_sound_off_then_new_note_at_same_boundary():
    artifact, _ = compile_legato(mode="midi")
    events = [(0.1, [0x90, 60, 80]), (0.2, [0xB0, 120, 0]), (0.2, [0x90, 67, 100]), (0.3, [0x80, 67, 0])]
    _, trace = render_trace(artifact, "f 0 1", events=events)
    assert at(trace, 0.2)[0] == pytest.approx(hz(67))
    assert at(trace, 0.2)[3:] == pytest.approx([1, 1])
    assert at(trace, 0.45)[2:] == pytest.approx([0, 1, 0])


def test_flute_controllers_are_sampled_per_phrase_and_contours_continue():
    patch = load_patch_fixture("lake_bamboo_flute_legato")
    artifact, _ = compile_legato(mode="midi", patch=patch)
    # Observe the original flute's breath and pressure contours as well as its tone.
    orc = artifact.orc
    controller = re.search(r'(i_flute_attack_iout_\d+) chnget "([^"]+)"', orc)
    contour = re.search(r"(k_blowing_pressure_kenv_\d+) linseg", orc)[1]
    burst = re.search(r"(k_pressure_overshoot_kenv_\d+) linseg", orc)[1]
    vibrato = re.search(r"(k_vibrato_delay_kenv_\d+) linseg", orc)[1]
    orc = orc.replace(
        "rireturn",
        "\n".join(
            f'chnset {variable}, "{name}"'
            for variable, name in [
                (controller[1], "attack_setting"),
                (contour, "contour"),
                (burst, "overshoot"),
                (vibrato, "vibrato"),
            ]
        )
        + "\nrireturn",
    )
    artifact.orc = orc
    with run_engine(artifact, host=True) as (cs, worker):
        for t, msg in [
            (0.1, [0x90, 60, 70]),
            (1.3, [0x90, 67, 120]),
            (1.3, [0x80, 60, 0]),
            (1.5, [0x80, 67, 0]),
            (1.51, [0x90, 64, 90]),
        ]:
            worker._midi_scheduler.enqueue(msg, source="test", target_engine_sample=round(t * 48000))
        values = {}
        for start in range(0, round(1.6 * 48000), 32):
            if start == 48000:
                cs.setControlChannel(controller[2], 0.15)
            worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + 32)
            assert cs.performKsmps() == 0
            if start in [62400, 72480]:
                values[start] = [cs.controlChannel(n)[0] for n in ["attack_setting", "contour", "overshoot", "vibrato"]]
        assert values[62400] == pytest.approx([0.075, 1, 0, 1])
        assert values[72480] == pytest.approx([0.15, 0, 0, 0])


def test_flute_stereo_outlets_are_nonzero_equal_and_release_completely():
    from backend.app.models.audio import AudioRoute

    patch = load_patch_fixture("lake_bamboo_flute_legato")
    targets = [PatchInstrumentTarget(patch=patch, midi_channel=1, assignment_id="flute")]
    graph = AudioGraph(
        routes=[
            AudioRoute(id=side, sourceId="flute", sourcePort=side, targetId="$output", targetPort=side)
            for side in ["left", "right"]
        ]
    )
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode="score", audio_graph=graph
    )
    audio, trace = render_trace(artifact, "i 1 .1 .3 60 100\ni 1 .4 .2 64 80\nf 0 1", seconds=1)
    assert np.isfinite(audio).all()
    assert 0.03 < abs(audio).max() < 0.8
    np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=1e-12)
    assert abs(audio[-4800:]).max() < 1e-9
    assert at(trace, 0.4)[3] == 1


def test_worker_stop_restart_clears_phrase_state(monkeypatch):
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)
    artifact, _ = compile_legato(mode="midi")
    worker = CsoundWorker()
    csd = artifact.csd.replace(artifact.orc, observe(artifact.orc))
    try:
        for _ in range(2):
            worker.start(csd, midi_input="internal:loopback", rtmidi_module="null")
            assert worker.queue_midi_message([0x90, 60, 100])
            worker.render_blocks(block_count=8, target_sample_rate=48000)
            assert worker._csound.controlChannel("test_0_phrase")[0] == 1
            assert worker._csound.controlChannel("test_0_gate")[0] == 1
            assert worker.stop() == "stopped"
            assert not worker.is_running
            assert worker._midi_scheduler.pending_count == 0
    finally:
        worker.stop()


def test_ordinary_polyphony_is_retained_beside_a_legato_instance():
    from backend.tests.test_mixer_audio import source

    patch = load_patch_fixture("lake_bamboo_flute_legato")
    poly = source("poly", always_on=False)
    poly.midi_channel = 2
    targets = [PatchInstrumentTarget(patch=patch, midi_channel=1, assignment_id="flute"), poly]
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode="score"
    )
    ref = artifact.manifest["noteInstrumentReferences"]["poly"]
    assert ref == artifact.manifest["instrumentReferences"]["poly"]
    audio, _ = render_trace(artifact, f"i {ref} .1 .2 60 100\ni {ref} .1 .2 64 100\nf 0 1")
    np.testing.assert_allclose(audio[4800:14400], 0.4, atol=1e-12)
    np.testing.assert_allclose(audio[14400:], 0, atol=1e-12)
