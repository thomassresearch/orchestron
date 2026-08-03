from __future__ import annotations

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_STEP


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
