from __future__ import annotations

from dataclasses import FrozenInstanceError
import json
from pathlib import Path

import pytest

from backend.app.services import sequencer_runtime_config as config

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


def test_note_pad_cache_invalidation_immutability_and_bound():
    compile_pad = config._cached_note_pad
    compile_pad.cache_clear()
    request = SessionSequencerConfigRequest.model_validate({'tracks': [{'track_id': 'lead', 'pads': [
        {'pad_index': 0, 'steps': [{'note': [60, 64], 'velocity': 101, 'ratchets': 3}]},
        {'pad_index': 1, 'steps': [67]}]}]})
    a = config.compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    b = config.compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    assert a.tracks['lead'] is not b.tracks['lead']
    assert a.tracks['lead'].pads[0] is b.tracks['lead'].pads[0]
    a.tracks['lead'].active_pad = 1
    assert b.tracks['lead'].active_pad == 0
    assert a.tracks['lead'].pads is not b.tracks['lead'].pads
    with pytest.raises(FrozenInstanceError):
        a.tracks['lead'].pads[0].steps[0].velocity = 1
    request.tracks[0].pads[0].steps[0].velocity = 57
    c = config.compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    assert c.tracks['lead'].pads[0].steps[0].velocity == 57
    assert a.tracks['lead'].pads[0].steps[0].velocity == 101
    assert c.tracks['lead'].pads[1] is a.tracks['lead'].pads[1]
    for index in range(600):
        compile_pad((), 100, 1, 4, 20160, 5040, str(index), 'aeolian')
    assert compile_pad.cache_info().currsize == 512


@pytest.mark.parametrize(('section', 'field', 'value'), [
    ('step', 'note', [62, 65]), ('step', 'hold', True), ('step', 'velocity', 57),
    ('step', 'timing_offset_percent', -37), ('step', 'ratchets', 3),
    ('step', 'ratchet_end_velocity', 20), ('pad', 'length_beats', 2),
    ('pad', 'scale_root', 'D'), ('pad', 'mode', 'dorian'),
    ('track', 'velocity', 58), ('track', 'scale_root', 'E'), ('track', 'mode', 'aeolian'),
    ('timing', 'steps_per_beat', 8), ('timing', 'beat_rate_numerator', 3),
    ('timing', 'beat_rate_denominator', 2), ('timing', 'meter_denominator', 8),
])
def test_note_cache_key_covers_authored_fields(section, field, value):
    request = SessionSequencerConfigRequest.model_validate({'tracks': [{
        'track_id': 'lead', 'length_beats': 1, 'scale_root': 'C', 'mode': 'ionian',
        'timing': {'beat_unit': 'meter'},
        'pads': [{'pad_index': 0, 'steps': [{'note': [60, 64], 'ratchets': 2}]}],
    }]})
    before = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    track = request.tracks[0]
    target = {'step': track.pads[0].steps[0], 'pad': track.pads[0],
              'track': track, 'timing': track.timing}[section]
    setattr(target, field, value)
    after = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    assert before.tracks['lead'].pads[0] != after.tracks['lead'].pads[0]


def test_note_cache_ignores_unused_steps_until_pad_is_extended():
    request = SessionSequencerConfigRequest.model_validate({'tracks': [{
        'track_id': 'lead', 'length_beats': 1, 'timing': {'steps_per_beat': 4},
        'pads': [{'pad_index': 0, 'steps': [60, None, None, None, 65]}],
    }]})
    before = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    request.tracks[0].pads[0].steps[4] = 67
    after = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    assert before.tracks['lead'].pads[0] is after.tracks['lead'].pads[0]
    request.tracks[0].pads[0].length_beats = 2
    extended = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    assert extended.tracks['lead'].pads[0].steps[4].notes == (67,)


@pytest.mark.parametrize('supplied', [[], [0], [0, 3, 7], list(range(8))])
def test_default_pad_completeness(supplied):
    request = SessionSequencerConfigRequest.model_validate({'tracks': [{'track_id': 'lead', 'length_beats': 2,
        'velocity': 57, 'pads': [{'pad_index': index, 'length_beats': 1, 'steps': [60 + index]} for index in supplied]}]})
    track = config.compile_sequencer_runtime_config(request, controller_default_channels=(1,)).tracks['lead']
    assert set(track.pads) == set(range(8))
    for index, pad in track.pads.items():
        assert pad.length_beats == (1 if index in supplied else 2)
        assert pad.steps[0].notes == ((60+index,) if index in supplied else ())
        assert pad.steps[0].velocity == (57 if index in supplied else 100)
