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
