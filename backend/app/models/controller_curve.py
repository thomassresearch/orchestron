"""Pure controller-curve math shared by playback and offline export validation."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class ControllerKeypoint(Protocol):
    @property
    def position(self) -> float: ...

    @property
    def value(self) -> float: ...


def clamp_controller_value(value: float) -> int:
    return max(0, min(127, int(round(value))))


def _clamp_controller_position(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def normalize_controller_keypoints(
    raw: Sequence[ControllerKeypoint],
) -> tuple[tuple[float, int], ...]:
    epsilon = 1e-6
    normalized = sorted(
        (
            _clamp_controller_position(point.position),
            clamp_controller_value(point.value),
        )
        for point in raw
    )

    start_point: tuple[float, int] | None = None
    interior: list[tuple[float, int]] = []
    for position, value in normalized:
        if position <= epsilon:
            start_point = (0.0, value)
            continue
        if position >= 1.0 - epsilon:
            continue
        if interior and abs(interior[-1][0] - position) <= epsilon:
            interior[-1] = (position, value)
        else:
            interior.append((position, value))

    if start_point is None:
        start_point = (0.0, 0)

    boundary_value = clamp_controller_value(start_point[1])
    return ((0.0, boundary_value), *interior, (1.0, boundary_value))


def _catmull_rom_1d(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def sample_controller_curve_value(
    keypoints: tuple[tuple[float, int], ...],
    normalized_position: float,
) -> int:
    t = _clamp_controller_position(normalized_position)
    points = keypoints
    if len(points) <= 1:
        return 0
    if t <= 0.0:
        return clamp_controller_value(points[0][1])
    if t >= 1.0:
        return clamp_controller_value(points[-1][1])

    segment_index = 0
    for index in range(len(points) - 1):
        if t <= points[index + 1][0]:
            segment_index = index
            break

    p1 = points[segment_index]
    p2 = points[min(len(points) - 1, segment_index + 1)]
    p0 = points[max(0, segment_index - 1)]
    p3 = points[min(len(points) - 1, segment_index + 2)]
    span = max(1e-6, p2[0] - p1[0])
    local_t = max(0.0, min(1.0, (t - p1[0]) / span))
    return clamp_controller_value(_catmull_rom_1d(p0[1], p1[1], p2[1], p3[1], local_t))
