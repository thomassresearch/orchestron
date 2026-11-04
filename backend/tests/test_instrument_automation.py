from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.models.clip_validation import validate_authored_clips
from backend.app.services.instrument_automation import validate_automation_routing
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.tests.test_sequencer_runtime import _FakeMidiService
from backend.tests.test_controller_steps import at, play, values

Q = 20160


def automation_wire(duration=512 * Q):
    return {"playback_end_step": duration // 2520, "controller_tracks": [{
        "track_id": "automation", "controller_number": 21, "target_channels": [1],
        "automation_target": {"instrument_id": "one", "controller_node_ids": ["setting"]},
        "pad_loop_enabled": True, "pad_loop_repeat": False,
        "pads": [{"pad_index": 0, "length_beats": 4, "curve_duration_ticks": duration,
                  "keypoints": [{"position": 0, "value": 0}, {"position": 1, "value": 127}], "steps": [30, None, 90]}],
        "clip_schedule": {"version": 1, "end": duration, "clips": [{"id": "sweep", "start": 0, "length": duration,
                          "mode": "once", "content": [{"pad": 0, "length": duration}]}]}}]}


def automation_document():
    return json.loads((Path(__file__).parent / "fixtures/sequencers/instrument_automation_performance.json").read_text())


def test_long_curve_preparation_status_seek_and_step_mode():
    request = SessionSequencerConfigRequest.model_validate(automation_wire())
    compiled = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    pad = compiled.controller_tracks["automation"].pads[0]
    assert pad.transport_subunit_count == 512 * Q
    assert len(pad.events) == 128
    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime("automation", midi, "test", (1,), lambda *_: None, clock_mode="render_driven")
    runtime.configure(request)
    play(runtime)
    at(runtime, 256 * Q)
    assert values(midi, channel=1, cc=21)[-1] in (63, 64)
    assert runtime.status().controller_tracks[0].curve_duration_ticks == 512 * Q
    runtime.stop()
    raw = automation_wire()
    raw["controller_tracks"][0]["controller_mode"] = "step"
    raw["controller_tracks"][0]["clip_schedule"]["clips"][0]["content"][0]["length"] = 4 * Q
    compiled = compile_sequencer_runtime_config(SessionSequencerConfigRequest.model_validate(raw), controller_default_channels=(1,))
    pad = compiled.controller_tracks["automation"].pads[0]
    assert pad.transport_subunit_count == 4 * Q
    assert [(e.offset_subunit, e.value) for e in pad.events] == [(0, 30), (10080, 90)]


@pytest.mark.parametrize("mutation", ["points", "unbound", "negative", "too_long", "channels"])
def test_runtime_rejects_invalid_bound_automation(mutation):
    wire = automation_wire()
    track = wire["controller_tracks"][0]
    if mutation == "points":
        track["pads"][0]["keypoints"] = [{"position": i / 10, "value": 64} for i in range(11)]
    elif mutation == "unbound":
        del track["automation_target"]
    elif mutation == "negative":
        track["pads"][0]["curve_duration_ticks"] = -1
    elif mutation == "too_long":
        track["pads"][0]["curve_duration_ticks"] = 20160000001
    else:
        track["target_channels"] = [1, 2]
    with pytest.raises(ValidationError):
        SessionSequencerConfigRequest.model_validate(wire)


def test_routing_cannot_override_the_rack_or_broadcast_missing_targets():
    config = SessionSequencerConfigRequest.model_validate(automation_wire())
    rack = [SimpleNamespace(id="one", midi_channel=1, performance_controller_midi_ccs={"setting": 21})]
    validate_automation_routing(config, rack)
    config.controller_tracks[0].controller_number = 22
    with pytest.raises(ValueError, match="match"):
        validate_automation_routing(config, rack)
    with pytest.raises(ValueError, match="suspended"):
        validate_automation_routing(config, [])
    config.controller_tracks[0].enabled = False
    validate_automation_routing(config, [])


def test_persisted_points_and_duration_reject_without_normalization():
    valid = automation_document()
    assert validate_authored_clips(valid) == valid
    for mutation in ("points", "duration", "unbound", "version"):
        data = deepcopy(valid)
        pad = data["sequencer"]["clipArrangement"]["lanes"][0]["definitions"][0]["payload"]
        if mutation == "points":
            pad["keypoints"] = [{"id": str(i), "position": i / 10, "value": 0} for i in range(11)]
        elif mutation == "duration":
            pad["curveDurationTicks"] = 1.5
        elif mutation == "unbound":
            del data["sequencer"]["controllerSequencers"][0]["automationTarget"]
        else:
            data["version"] = 23
        with pytest.raises(ValueError):
            validate_authored_clips(data)
