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
