import random

import pytest

from backend.app.models import controller_curve as curve
from backend.app.models.session import SessionControllerSequencerKeypointConfig


@pytest.mark.parametrize('points', [(), ((0.0, 42),)])
def test_empty_or_single_point_curve_matches_scalar(points):
    positions = [-1.0, 0.0, 0.5, 1.0, 2.0]
    assert list(curve.sample_controller_curve_values(points, positions)) == [0] * len(positions)


def test_dense_curve_samples_match_scalar_reference_exactly():
    rng = random.Random(2079)
    for count in (1, 2, 8, 32):
        for _ in range(10):
            points = curve.normalize_controller_keypoints([
                SessionControllerSequencerKeypointConfig(position=at, value=rng.randrange(128))
                for at in sorted([0.0, 1.0, *[rng.random() for _ in range(count)]])])
            positions = sorted([-0.1, 0.0, 1.0, 1.1, *[i/1920 for i in range(1920)], *[x for x, _ in points]])
            expected = [curve.sample_controller_curve_value(points, x) for x in positions]
            assert list(curve.sample_controller_curve_values(points, positions)) == expected


@pytest.mark.parametrize("raw, expected", [
    ([(0, 20), (1, 90)], ((0.0, 20), (1.0, 90))),
    ([(0, 42)], ((0.0, 42), (1.0, 42))),
    ([(1, 90)], ((0.0, 0), (1.0, 90))),
    ([], ((0.0, 0), (1.0, 0))),
])
def test_normalization_preserves_explicit_endpoints_and_legacy_missing_end(raw, expected):
    points = [SessionControllerSequencerKeypointConfig(position=p, value=v) for p, v in raw]
    assert curve.normalize_controller_keypoints(points) == expected


def test_open_curve_samples_reach_both_independent_endpoints():
    points = curve.normalize_controller_keypoints([
        SessionControllerSequencerKeypointConfig(position=0, value=20),
        SessionControllerSequencerKeypointConfig(position=1, value=90),
    ])
    assert list(curve.sample_controller_curve_values(points, [0, .5, 1])) == [20, 55, 90]


@pytest.mark.parametrize("block", [64, 4096])
def test_live_open_curves_continue_across_pads_without_return_to_start(block):
    from backend.app.models.session import SessionSequencerConfigRequest
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.tests.test_sequencer_runtime import _FakeMidiService

    request = SessionSequencerConfigRequest.model_validate({
        "timing": {"tempo_bpm": 120}, "playback_end_step": 16,
        "controller_tracks": [{"track_id": "cc", "controller_number": 74, "target_channels": [2],
            "controller_mode": "curve", "length_beats": 1,
            "pad_loop_enabled": True, "pad_loop_repeat": False, "pad_loop_sequence": [0, 1],
            "pads": [{"pad_index": i, "length_beats": 1, "keypoints": [
                {"position": 0, "value": start}, {"position": 1, "value": end}]
            } for i, (start, end) in enumerate([(20, 50), (50, 90)])]}],
    })
    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id="open-curves", midi_service=midi,
        midi_input_selector="test", controller_default_channels=(2,), clock_mode="render_driven",
        publish_event=lambda *_: None)
    runtime.configure(request)
    runtime.start()
    sample = 0
    while runtime._running:
        assert sample < 96000, "Finite curve arrangement did not end"
        runtime.advance_render_block(sample_rate=48000, ksmps=block, block_start_sample=sample)
        sample += block
    values = [m[2] for _, batch, _ in midi.calls for m in batch if m[:2] == [0xB1, 74]]
    assert values[0] == 20 and values[-1] == 90 and 50 in values
    assert values == sorted(values)
    assert max(b - a for a, b in zip(values, values[1:])) == 1
    assert len(values) <= 72  # Only changes, plus at most one pad-boundary resend.
