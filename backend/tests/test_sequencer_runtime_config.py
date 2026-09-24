from __future__ import annotations

from dataclasses import FrozenInstanceError
import json
from pathlib import Path

import pytest

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_STEP
from backend.app.models.session import SessionControllerSequencerKeypointConfig
from backend.app.services.sequencer_runtime_config import _compile_controller_pad_runtime, _compiled_controller_pad
from backend.app.services.sequencer_runtime_models import SequencerTimingRuntime


_CURVE_CASES = json.loads((Path(__file__).parent / "fixtures/controller_curves.json").read_text())


@pytest.mark.parametrize("case", _CURVE_CASES, ids=lambda case: case["name"])
def test_controller_curves_match_complete_pre_optimization_sequences(case: dict) -> None:
    pad = _compile_controller_pad_runtime(
        [SessionControllerSequencerKeypointConfig.model_validate(point) for point in case["keypoints"]],
        length_beats=case["length_beats"], timing=SequencerTimingRuntime(**case["timing"]),
    )
    assert [[event.offset_subunit, event.value] for event in pad.events] == [[offset * 6, value] for offset, value in case["events"]]
    assert pad.step_count == case["step_count"]
    assert pad.transport_subunit_count == case["transport_subunit_count"] * 6


def test_controller_cache_is_bounded_reused_and_immutable() -> None:
    _compiled_controller_pad.cache_clear()
    request = SessionSequencerConfigRequest.model_validate({"controller_tracks": [{"track_id": "cc", "controller_number": 74}]})
    first = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    before = _compiled_controller_pad.cache_info()
    second = compile_sequencer_runtime_config(request, controller_default_channels=(2,))
    after = _compiled_controller_pad.cache_info()
    assert after.hits > before.hits
    assert after.misses == before.misses
    left, right = first.controller_tracks["cc"], second.controller_tracks["cc"]
    assert left.pads[0] is right.pads[0]
    left.active_pad = 3
    assert right.active_pad == 0
    assert right.target_channels == (2,)
    with pytest.raises(FrozenInstanceError):
        left.pads[0].events[0].value = 100
    for duration in range(1, 600):
        _compiled_controller_pad(((0.0, 5), (1.0, 5)), 1, 4, duration)
    assert _compiled_controller_pad.cache_info().currsize == 512


def test_tb303_fixture_one_pad_edit_reuses_unchanged_controller_data() -> None:
    request = SessionSequencerConfigRequest.model_validate_json(
        (Path(__file__).parent / "fixtures/performances/tb303_madness.runtime.json").read_text()
    )
    original = compile_sequencer_runtime_config(request, controller_default_channels=(1, 2, 3, 4))
    assert len(original.tracks) == 8
    assert len(original.controller_tracks) == 8
    identity = request.controller_tracks[0].track_id
    previous_value = original.controller_tracks[identity].pads[0].events[0].value
    request.controller_tracks[0].pads[0].keypoints[0].value ^= 1
    edited = compile_sequencer_runtime_config(request, controller_default_channels=(1, 2, 3, 4))
    assert edited.controller_tracks[identity].pads[0].events[0].value == previous_value ^ 1
    assert original.controller_tracks[identity].pads[0].events[0].value == previous_value
    for track_id, track in original.controller_tracks.items():
        assert len(track.pads) == 8
        for index, pad in track.pads.items():
            if (track_id, index) != (identity, 0):
                assert edited.controller_tracks[track_id].pads[index] is pad


def test_compile_sequencer_runtime_config_normalizes_tracks_and_derives_loop_extent() -> None:
    request = SessionSequencerConfigRequest.model_validate(
        {
            "timing": {"tempo_bpm": 120, "steps_per_beat": 4},
            "step_count": 8,
            "tracks": [
                {
                    "track_id": "lead",
                    "midi_channel": 2,
                    "length_beats": 1,
                    "active_pad": 0,
                    "pad_loop_enabled": True,
                    "pad_loop_sequence": [0, -2],
                    "pads": [
                        {
                            "pad_index": 0,
                            "length_beats": 1,
                            "steps": [{"note": [60, 60, 72], "hold": True, "velocity": 110}],
                        }
                    ],
                },
                {
                    "track_id": "follower",
                    "midi_channel": 3,
                    "length_beats": 1,
                    "sync_to_track_id": "lead",
                    "pads": [{"pad_index": 0, "length_beats": 1, "steps": [48]}],
                },
            ],
        }
    )

    config = compile_sequencer_runtime_config(request, controller_default_channels=(1,))

    track = config.tracks["lead"]
    assert track.step_count == 4
    assert track.pad_loop_sequence == (0, -2)
    assert track.pads[0].steps[0].notes == (60, 72)
    assert track.pads[0].steps[0].hold is True
    assert track.pads[0].steps[0].velocity == 110
    assert len(track.pads[0].steps) == 4
    assert config.playback_end_subunit == 3 * 8 * TRANSPORT_SUBUNITS_PER_STEP
    assert config.sync_master_track_ids == frozenset({"lead"})


def test_compile_sequencer_runtime_config_uses_default_controller_channels_and_explicit_extent() -> None:
    request = SessionSequencerConfigRequest.model_validate(
        {
            "timing": {"tempo_bpm": 90, "steps_per_beat": 4},
            "step_count": 8,
            "playback_end_step": 12,
            "controller_tracks": [
                {
                    "track_id": "filter",
                    "controller_number": 74,
                    "target_channels": [],
                    "length_beats": 1,
                    "pads": [
                        {
                            "pad_index": 0,
                            "length_beats": 1,
                            "keypoints": [
                                {"position": 0.0, "value": 20},
                                {"position": 0.5, "value": 100},
                                {"position": 1.0, "value": 20},
                            ],
                        }
                    ],
                }
            ],
        }
    )

    config = compile_sequencer_runtime_config(request, controller_default_channels=(2, 5))

    track = config.controller_tracks["filter"]
    assert track.target_channels == (2, 5)
    assert config.playback_end_subunit == 12 * TRANSPORT_SUBUNITS_PER_STEP
    assert track.pads[0].events[0].value == 20
    assert all(
        left.value != right.value
        for left, right in zip(track.pads[0].events, track.pads[0].events[1:], strict=False)
    )
    assert track.pads[0].event_offsets == tuple(event.offset_subunit for event in track.pads[0].events)
