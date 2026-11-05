"""Shared authored CLI fixture exercised by real scheduler and export services."""
from copy import deepcopy
import json
from pathlib import Path

from backend.app.models.export import PerformanceCsdExportRequest
from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.performance_export_service import PerformanceExportService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.tests.test_sequencer_note_timing import Capture, advance, notes


def test_cli_live_note_events_match_offline_capture_for_both_csd_modes():
    fixture = json.loads((Path(__file__).parent / "fixtures/performance_creator/all_sources.json").read_text())
    wire = deepcopy(fixture["wire"])
    # The arpeggiator also consumes channel 1 in this all-source fixture. Select
    # the authored melodic lane here so the compared events have one owner.
    wire.update(tracks=[wire["tracks"][0]], score_tracks=[], controller_tracks=[], arpeggiators=[])
    request = SessionSequencerConfigRequest.model_validate(wire)
    capture = Capture()
    runtime = SessionSequencerRuntime("cli-fixture", capture, "internal:loopback", (2,), lambda *_: None, clock_mode="render_driven")
    runtime.configure(request)
    with runtime._lock:
        runtime._running = True
        runtime._apply_absolute_subunit_locked(runtime._config, 0)
    advance(runtime, capture, 100000)
    live = [(round(sample/6720, 5), message) for sample, message in notes(capture)]
    assert len([m for _, m in live if m[0] & 0xf0 == 0x90]) == 8
    exporter = PerformanceExportService(None, None)
    for mode in ("midiFile", "score"):
        payload = PerformanceCsdExportRequest.model_validate({"eventSource": mode, "sequencerConfig": wire,
            "performanceExport": {"format": "orchestron.performance", "version": 1, "exported_at": "2026-11-05T00:00:00Z",
                "performance": {"name": "CLI fixture", "config": fixture["config"]}, "patch_definitions": []}})
        events = exporter._capture_offline_midi_events(request=payload, controller_default_channels=(2,))
        offline = [(round(e.time_seconds, 5), tuple(e.message)) for e in events if e.message[0] & 0xf0 in (0x90, 0x80)]
        assert offline == live
