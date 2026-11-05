"""Shared authored CLI fixture exercised by real scheduler and export services."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from backend.app.models.export import PerformanceCsdExportRequest
from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.performance_export_service import PerformanceExportService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.tests.test_sequencer_note_timing import Capture, advance
from backend.tests.test_arpeggiator_runtime import _CaptureMidi, _router


@pytest.mark.parametrize("source", ["melodic", "drummer", "score", "controller"])
def test_cli_live_note_events_match_offline_capture_for_both_csd_modes(source):
    fixture = json.loads((Path(__file__).parent / "fixtures/performance_creator/all_sources.json").read_text())
    wire = deepcopy(fixture["wire"])
    # The arpeggiator also consumes channel 1 in this all-source fixture. Select
    # one source family here so the compared events have unambiguous ownership.
    wire.update(tracks=([wire["tracks"][0]] if source == "melodic" else wire["tracks"][1:] if source == "drummer" else []),
                score_tracks=wire["score_tracks"] if source == "score" else [],
                controller_tracks=wire["controller_tracks"] if source == "controller" else [], arpeggiators=[])
    if source == "score":
        wire["score_tracks"][0]["pads"][0]["notes"] = [{"id": "sustained", "pitch": 67, "velocity": 91,
                                                       "start_ticks": 5040, "duration_ticks": 30240}]
    request = SessionSequencerConfigRequest.model_validate(wire)
    capture = Capture()
    runtime = SessionSequencerRuntime("cli-fixture", capture, "internal:loopback", (2,), lambda *_: None, clock_mode="render_driven")
    runtime.configure(request)
    with runtime._lock:
        runtime._running = True
        runtime._apply_absolute_subunit_locked(runtime._config, 0)
    advance(runtime, capture, 100000)
    kinds = (0xb0,) if source == "controller" else (0x90, 0x80)
    live = [(round(sample/6720, 5), message) for sample, message in capture.events if message[0] & 0xf0 in kinds]
    assert live
    exporter = PerformanceExportService(None, None)
    for mode in ("midiFile", "score"):
        payload = PerformanceCsdExportRequest.model_validate({"eventSource": mode, "sequencerConfig": wire,
            "performanceExport": {"format": "orchestron.performance", "version": 1, "exported_at": "2026-11-05T00:00:00Z",
                "performance": {"name": "CLI fixture", "config": fixture["config"]}, "patch_definitions": []}})
        events = exporter._capture_offline_midi_events(request=payload, controller_default_channels=(2,))
        offline = [(round(e.time_seconds, 5), tuple(e.message)) for e in events if e.message[0] & 0xf0 in kinds]
        assert offline == live


@pytest.mark.parametrize("pattern", ["up", "random"])
@pytest.mark.parametrize("hold", [False, True])
def test_clip_chord_input_arpeggiator_matches_both_exports(pattern, hold):
    fixture = json.loads((Path(__file__).parent / "fixtures/performance_creator/all_sources.json").read_text())
    wire = deepcopy(fixture["wire"])
    wire["tracks"] = wire["tracks"][:1]
    wire["score_tracks"] = []
    wire["controller_tracks"] = []
    wire["tracks"][0]["pads"][0]["steps"] = [
        {"note": [60, 64, 67], "velocity": 88}, {"hold": True}, None, None,
        {"note": [62, 65, 69], "velocity": 96}, {"hold": True}, None, None,
    ]
    arp = wire["arpeggiators"][0]
    arp.update(input_channel=wire["tracks"][0]["midi_channel"], target_channel=3, hold=hold)
    for pad in arp["pads"]:
        pad.update(pattern=pattern, random_seed=48271)
    request = SessionSequencerConfigRequest.model_validate(wire)
    capture = _CaptureMidi()
    router = _router(capture)
    runtime = SessionSequencerRuntime("clip-input", router, "internal:loopback", (3,), lambda *_: None,
                                      clock_mode="render_driven")
    runtime.configure(request)
    router.configure(request.arpeggiators, tempo_bpm=request.timing.tempo_bpm)
    router.set_transport(beat=0, running=True, sample=0, bar_beats=request.timing.meter_numerator)
    with runtime._lock:
        runtime._running = True
        runtime._apply_absolute_subunit_locked(runtime._config, 0)
    while runtime._running:
        assert capture.current_sample < 48000 * 30
        start = capture.current_sample
        runtime.advance_render_block(sample_rate=48000, ksmps=64, block_start_sample=start)
        router.advance_render_block(block_start_sample=start, block_end_sample=start + 64,
                                    sample_rate=48000, tempo_bpm=request.timing.tempo_bpm)
        capture.current_sample += 64
    router.shutdown()
    live = [(round(sample / 48000, 5), tuple(message)) for message, sample in capture.messages
            if message[0] in (0x92, 0x82)]
    assert live
    for mode in ("midiFile", "score"):
        payload = PerformanceCsdExportRequest.model_validate({"eventSource": mode, "sequencerConfig": wire,
            "performanceExport": {"format": "orchestron.performance", "version": 1, "exported_at": "2026-11-05T00:00:00Z",
                "performance": {"name": "Clip chord input", "config": fixture["config"]}, "patch_definitions": []}})
        events = PerformanceExportService(None, None)._capture_offline_midi_events(request=payload, controller_default_channels=(3,))
        offline = [(round(e.time_seconds, 5), tuple(e.message)) for e in events if e.message[0] in (0x92, 0x82)]
        assert offline == live
