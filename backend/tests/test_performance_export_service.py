import json
from pathlib import Path

import pytest

from backend.app.models.session import SessionSequencerTimingConfig
from backend.app.services.compiler_service import PatchInstrumentTarget
from backend.app.services.performance_export_service import (
    CapturedMidiEvent,
    OFFLINE_RENDER_SR,
    PerformanceExportService,
)
from backend.tests.csound_test_support import load_patch_fixture


@pytest.fixture
def exporter():
    return PerformanceExportService(compiler_service=None, gen_asset_service=None)


@pytest.fixture
def targets():
    return [PatchInstrumentTarget(patch=load_patch_fixture("midi_legato"), midi_channel=1)]


def captured_events(messages):
    return [CapturedMidiEvent(time, bytes(message), sequence) for sequence, (time, message) in enumerate(messages)]


@pytest.mark.parametrize("sample_rate,ksmps", [(48000, 1), (48000, 16), (48000, 32), (44100, 64), (48000, 128)])
def test_score_step_gate_renders_every_value_with_larger_control_blocks(exporter, sample_rate, ksmps):
    import numpy as np

    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.app.models.export import PerformanceCsdExportRequest
    from backend.app.services.compiler_orchestra import OrchestraEmitter, SCORE_CONTROLLER_ARRAY_NAME

    config = json.loads((Path(__file__).parent / "fixtures/sequencers/trance_gate_steps.json").read_text())
    request = PerformanceCsdExportRequest.model_validate({
        "performanceExport": {"format": "orchestron.performance", "version": 1, "exported_at": "test",
                              "performance": {"name": "Gate probe", "config": {"version": 20}}},
        "sequencerConfig": config, "eventSource": "score",
    })
    # Make the end reset observable even though the demo's last step is zero.
    request.sequencer_config.controller_tracks[0].reset_value = 23
    events = exporter._capture_offline_midi_events(request=request, controller_default_channels=(1,))
    duration = 16 * 60 / 137
    lines, _ = exporter._build_score_lines(events=events, targets=[], duration_seconds=duration + .1,
                                         timing=request.sequencer_config.timing, allow_continuous=True)
    # A sustained reader exposes the actual received CC, including the final reset.
    # Keep the export's one-sample setter duration while changing the host block size.
    orc = [f"sr={sample_rate}", f"ksmps={ksmps}", "nchnls=2", "0dbfs=1",
           *OrchestraEmitter.score_controller_header_lines(),
           "instr 1", f"a_gate upsamp {SCORE_CONTROLLER_ARRAY_NAME}[1944] / 127",
           f"a_other upsamp {SCORE_CONTROLLER_ARRAY_NAME}[1816] / 127",
           "outs a_gate, a_other", "endin"]
    csd = "\n".join(["<CsoundSynthesizer>", "<CsOptions>", "-n -d -m0", "</CsOptions>",
                     "<CsInstruments>", *orc, "</CsInstruments>", "<CsScore>",
                     f"i 1 0 {duration + .1}", *lines, "</CsScore>", "</CsoundSynthesizer>"])
    cs = load_ctcsound_module().Csound()
    try:
        assert cs.compileCsdText(csd) == 0
        assert cs.start() == 0
        blocks = []
        while cs.performKsmps() == 0:
            blocks.append(cs.spout().copy().reshape(-1, 2))
        samples = np.concatenate(blocks)
    finally:
        cs.cleanup()
        cs.reset()
    track = config["controller_tracks"][0]
    expected = [value / 127 for pad in track["pad_loop_sequence"] for value in track["pads"][pad]["steps"]]
    # Assert the authored pattern independently of captured/compacted event output.
    midpoints = ((np.arange(len(expected)) + .5) * (60 / 137 / 8) * sample_rate).astype(int)
    np.testing.assert_array_equal(samples[midpoints, 0], expected)
    assert samples[int((duration + .05) * sample_rate), 0] == 23 / 127
    assert np.count_nonzero(samples[:, 1]) == 0


def test_score_groups_notes_and_controllers_by_measure_without_changing_events(exporter, targets):
    events = captured_events([
        (0.0, [0x90, 60, 100]),
        (0.5, [0xB0, 1, 20]),
        (2.0, [0x90, 67, 90]),
        (2.0, [0xB0, 1, 80]),
        (2.0, [0xB0, 1, 81]),
        (2.25, [0x80, 67, 0]),
        (2.5, [0x80, 60, 0]),
    ])
    lines, warnings = exporter._build_score_lines(
        events=events, targets=targets, duration_seconds=4.5, timing=SessionSequencerTimingConfig(),
    )
    assert warnings == []
    assert lines == [
        "f 1 0 16384 10 1",
        "",
        "; Measure 1 | 00:00",
        "i 1 0 2.5 60 100",
        "i 9000 0.5 0.000021 1 20",
        "",
        "; Measure 2 | 00:02",
        "i 9000 2 0.000021 1 80",
        "i 9000 2 0.000021 1 81",
        "i 1 2 0.25 67 90",
        "",
        "f 0 4.5",
    ]


@pytest.mark.parametrize("sample_offset, measure", [(-1, 1), (0, 2), (1, 2)])
def test_score_measure_boundary_handles_sample_rounding(exporter, targets, sample_offset, measure):
    timing = SessionSequencerTimingConfig(tempo_bpm=137)
    boundary_sample = round(4 * 60 / 137 * OFFLINE_RENDER_SR)
    start = (boundary_sample + sample_offset) / OFFLINE_RENDER_SR
    lines, _ = exporter._build_score_lines(
        events=captured_events([(start, [0x90, 60, 100]), (start + 0.1, [0x80, 60, 0])]),
        targets=targets, duration_seconds=4, timing=timing,
    )
    assert [line for line in lines if line.startswith(";")] == [
        f"; Measure {measure} | 00:0{measure - 1}",
    ]


def test_score_measure_labels_keep_silent_gaps_and_minute_rollover(exporter, targets):
    lines, _ = exporter._build_score_lines(
        events=captured_events([
            (0, [0x90, 60, 100]), (0.1, [0x80, 60, 0]),
            (60.5, [0x90, 67, 90]), (60.6, [0x80, 67, 0]),
        ]),
        targets=targets, duration_seconds=63, timing=SessionSequencerTimingConfig(),
    )
    assert [line for line in lines if line.startswith(";")] == [
        "; Measure 1 | 00:00", "; Measure 31 | 01:00",
    ]
    assert "\n\n; Measure 31 | 01:00\ni 1 60.5 0.1 67 90\n\nf 0 63" in "\n".join(lines)


def test_score_measure_labels_follow_master_bars_and_export_start(exporter, targets):
    lines, _ = exporter._build_score_lines(
        events=captured_events([
            (0, [0x90, 60, 100]), (0.1, [0x80, 60, 0]),
            (2, [0x90, 67, 90]), (2.1, [0x80, 67, 0]),
        ]),
        targets=targets, duration_seconds=5,
        timing=SessionSequencerTimingConfig(tempo_bpm=120, meter_numerator=3, meter_denominator=8),
        playback_start_step=32,  # Starts one quarter-note beat into master measure 2.
    )
    assert [line for line in lines if line.startswith(";")] == [
        "; Measure 2 | 00:00", "; Measure 3 | 00:01",
    ]


def test_continuous_score_without_events_keeps_duration_and_has_no_empty_measure_blocks(exporter):
    lines, warnings = exporter._build_score_lines(
        events=[], targets=[], duration_seconds=6, timing=SessionSequencerTimingConfig(), allow_continuous=True,
    )
    assert warnings == []
    assert lines == ["f 1 0 16384 10 1", "", "f 0 6"]


def test_score_compaction_uses_merged_channel_cc_state_and_preserves_startup(exporter):
    events = captured_events([
        (0, [0xB0, 74, 0]),
        (0, [0xB0, 74, 0]),  # Startup writes must still override patch initialization.
        (.1, [0xB0, 74, 0]),
        (.2, [0xB0, 74, 64]),
        (.3, [0xB1, 74, 64]),  # Same value, different channel.
        (.3, [0xB0, 75, 64]),  # Same value, different controller.
        (.4, [0xB0, 74, 64]),
        (.5, [0xB0, 74, 20]),  # A second lane changes the shared state.
        (.5, [0xB0, 74, 64]),  # First lane must reassert its unchanged local value.
        (.5, [0xB0, 74, 64]),
        (3, [0xB0, 74, 64]),  # Repeated pad after a rest.
        (4, [0xB0, 74, 0]),  # Finite-end reset changes the state.
        (4, [0xB1, 74, 0]),
        (4, [0xB0, 75, 0]),
        (5, [0xB0, 74, 0]),  # Redundant reset.
        (6, [0xB2, 74, 0]),  # First write is zero, with no known prior state.
        (6, [0xB0, 120, 0]),
        (6, [0xB0, 123, 0]),
        (6, [0x90, 60, 0]),
        (6, [0xB0]),
    ])
    # Capture order can differ from chronological order; ties use sequence.
    result = exporter._score_controller_events(list(reversed(events)))
    assert [event.sequence for event in result] == [0, 1, 3, 4, 5, 7, 8, 11, 12, 13, 15]

    original = exporter._score_controller_events(events, deduplicate=False)
    before, after = {}, {}
    for time in sorted({event.time_seconds for event in original}):
        for event in original:
            if event.time_seconds == time:
                before[event.midi_channel, event.controller_number] = event.value
        for event in result:
            if event.time_seconds == time:
                after[event.midi_channel, event.controller_number] = event.value
        assert after == before


def test_score_compaction_keeps_note_releases_panic_and_final_duration(exporter, targets, monkeypatch):
    events = captured_events([
        (0, [0x90, 60, 100]), (0, [0xB0, 74, 64]),
        (.1, [0xB0, 74, 64]), (.2, [0xB0, 123, 0]),
        (.3, [0x90, 60, 90]), (.4, [0xB0, 74, 64]),
        (.5, [0xB0, 120, 0]), (.6, [0x90, 67, 80]),
        (1, [0xB0, 74, 64]),  # Last event closes an otherwise unterminated note.
    ])
    args = dict(events=events, targets=targets, duration_seconds=3, timing=SessionSequencerTimingConfig())
    compact, warnings = exporter._build_score_lines(**args)
    collect = exporter._score_controller_events
    monkeypatch.setattr(exporter, "_score_controller_events", lambda events, **kw: collect(events, deduplicate=False))
    original, original_warnings = exporter._build_score_lines(**args)
    assert warnings == original_warnings == []
    assert [line for line in compact if line.startswith("i 1 ")] == [
        "i 1 0 0.2 60 100", "i 1 0.3 0.2 60 90", "i 1 0.6 0.4 67 80",
    ]
    assert [line for line in compact if not line.startswith("i 9000 ")] == [
        line for line in original if not line.startswith("i 9000 ")
    ]
    assert compact[-1] == "f 0 3"
    assert len(original) - len(compact) == 3


@pytest.mark.parametrize("initialization", ["none", "continuous", "per_note"])
@pytest.mark.parametrize("ksmps", [1, 16, 64])
def test_score_compaction_renders_identical_samples_with_controller_initialization(exporter, monkeypatch, initialization, ksmps):
    import numpy as np

    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.app.models.patch import PatchDocument
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.opcode_service import OpcodeService

    nodes, connections = [], []
    for channel, side in [(1, "left"), (2, "right")]:
        nodes.extend([
            dict(id=side, opcode="ctrl7", params=dict(ichan=channel, ictlno=74, kmin=0, kmax=1)),
            dict(id=side + "_audio", opcode="upsamp"),
        ])
        connections.extend([
            dict(from_node_id=side, from_port_id="kout", to_node_id=side + "_audio", to_port_id="ksig"),
            dict(from_node_id=side + "_audio", from_port_id="aout", to_node_id="output", to_port_id=side),
        ])
    nodes.append(dict(id="output", opcode="outs"))
    if initialization != "none":
        nodes.append(dict(id="init", opcode="initc7", params=dict(ichan=1, ictlno=74, ivalue=1)))
    patch = PatchDocument.model_validate(dict(name="CC state probe", graph=dict(
        nodes=nodes, connections=connections, engine_config=dict(sr=48000, ksmps=ksmps, nchnls=2, **{"0dbfs": 1}),
    )))
    always_on = initialization == "continuous"
    targets = [PatchInstrumentTarget(patch=patch, midi_channel=0 if always_on else 1, always_on=always_on)]
    artifact = CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode="score",
    )
    events = captured_events([
        (0, [0xB0, 74, 20]), (0, [0xB0, 74, 20]), (0, [0xB1, 74, 60]),
        (0, [0x90, 60, 100]), (.01, [0xB0, 74, 20]),
        (.02, [0x80, 60, 0]), (.03, [0x90, 62, 100]),  # Retrigger can initialize CC again.
        (.04, [0xB0, 74, 20]), (.04, [0xB1, 74, 60]),
        (.05, [0xB0, 74, 20]), (.05, [0xB0, 74, 80]), (.05, [0xB0, 74, 20]),
        (.06, [0xB0, 74, 20]), (.07, [0xB0, 74, 0]), (.08, [0xB0, 74, 0]),
        (.09, [0x80, 62, 0]),
    ])
    args = dict(events=events, targets=targets, duration_seconds=.1, timing=SessionSequencerTimingConfig(),
                allow_continuous=always_on)
    compact, _ = exporter._build_score_lines(**args)
    collect = exporter._score_controller_events
    monkeypatch.setattr(exporter, "_score_controller_events", lambda events, **kw: collect(events, deduplicate=False))
    original, _ = exporter._build_score_lines(**args)
    if initialization == "per_note":
        assert compact == original
    else:
        assert len(compact) < len(original)

    def render(lines):
        orc = artifact.orc + "\n" + "\n".join(exporter._score_controller_initializer_lines(events))
        csd = "\n".join([
            "<CsoundSynthesizer>", "<CsOptions>", "-n -d -m0", "</CsOptions>",
            "<CsInstruments>", orc, "</CsInstruments>", "<CsScore>", *lines,
            "</CsScore>", "</CsoundSynthesizer>",
        ])
        cs = load_ctcsound_module().Csound()
        try:
            assert cs.compileCsdText(csd) == 0
            assert cs.start() == 0
            samples = []
            while cs.performKsmps() == 0:
                samples.append(cs.spout().copy())
            return np.array(samples)
        finally:
            cs.cleanup()
            cs.reset()

    before, after = render(original), render(compact)
    assert np.isfinite(before).all() and np.max(before) > 0
    np.testing.assert_array_equal(after, before)
