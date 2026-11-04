"""Pure controller-curve math shared by playback and offline export validation."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
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
    end_point: tuple[float, int] | None = None
    interior: list[tuple[float, int]] = []
    for position, value in normalized:
        if position <= epsilon:
            start_point = (0.0, value)
            continue
        if position >= 1.0 - epsilon:
            end_point = (1.0, value)
            continue
        if interior and abs(interior[-1][0] - position) <= epsilon:
            interior[-1] = (position, value)
        else:
            interior.append((position, value))

    if start_point is None:
        start_point = (0.0, 0)

    # Missing ends keep the historical closed-curve fallback; explicit ends are independent.
    if end_point is None:
        end_point = (1.0, start_point[1])
    return (start_point, *interior, end_point)


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


def sample_controller_curve_values(
    keypoints: tuple[tuple[float, int], ...],
    positions: Iterable[float],
) -> Iterator[int]:
    """Sample normalized keypoints at nondecreasing positions with scalar arithmetic."""
    if len(keypoints) <= 1:
        for _ in positions:
            yield 0
        return
    segment_index = -1
    upper = -1.0
    for position in positions:
        t = _clamp_controller_position(position)
        if t <= 0.0:
            yield clamp_controller_value(keypoints[0][1])
            continue
        if t >= 1.0:
            yield clamp_controller_value(keypoints[-1][1])
            continue
        if segment_index < 0 or t > upper:
            segment_index = max(0, segment_index)
            while segment_index < len(keypoints) - 2 and t > keypoints[segment_index + 1][0]:
                segment_index += 1
            p1 = keypoints[segment_index]
            p2 = keypoints[min(len(keypoints) - 1, segment_index + 1)]
            p0 = keypoints[max(0, segment_index - 1)]
            p3 = keypoints[min(len(keypoints) - 1, segment_index + 2)]
            origin, upper = p1[0], p2[0]
            span = max(1e-6, upper - origin)
            constant = 2.0 * p1[1]
            linear = -p0[1] + p2[1]
            quadratic = 2.0 * p0[1] - 5.0 * p1[1] + 4.0 * p2[1] - p3[1]
            cubic = -p0[1] + 3.0 * p1[1] - 3.0 * p2[1] + p3[1]
        local_t = max(0.0, min(1.0, (t - origin) / span))
        t2 = local_t * local_t
        t3 = t2 * local_t
        yield clamp_controller_value(0.5 * (constant + linear * local_t + quadratic * t2 + cubic * t3))


def compact_controller_events(points: tuple[tuple[float, int], ...], duration: int, quantum: int):
    """Exact sampled changes without visiting every quantum of a long song.

    Each Catmull–Rom segment has at most three monotone intervals. Within each
    interval the rounded/clamped MIDI value is monotone too, so binary searches
    find its (at most 127) changes. Boundary samples use the production sampler.
    """
    import math

    count = (duration + quantum - 1) // quantum
    if count <= 0:
        return ((0, points[0][1]),)
    cuts = {0, count}
    for index in range(len(points) - 1):
        x1, p1 = points[index]
        x2, p2 = points[index + 1]
        p0 = points[max(0, index - 1)][1]
        p3 = points[min(len(points) - 1, index + 2)][1]
        a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3)
        b = 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3)
        c = -p0 + p2
        roots = []
        if a:
            discriminant = b * b - 4 * a * c
            if discriminant >= 0:
                roots = [(-b - math.sqrt(discriminant)) / (2 * a), (-b + math.sqrt(discriminant)) / (2 * a)]
        elif b:
            roots = [-c / b]
        for position in [x1, x2, *(x1 + root * (x2 - x1) for root in roots if 0 < root < 1)]:
            sample = math.floor(position * duration / quantum)
            # Isolate both neighbours of extrema/segment boundaries, including
            # floating point rounding at an exactly aligned sample.
            cuts.update(max(0, min(count, sample + delta)) for delta in (-1, 0, 1, 2))
    events = []

    def value(index):
        return sample_controller_curve_value(points, index * quantum / float(duration))

    def append(index, current):
        if not events or events[-1][1] != current:
            events.append((index * quantum, current))

    boundaries = sorted(cuts)
    for lo, stop in zip(boundaries, boundaries[1:]):
        if stop <= lo:
            continue
        current = value(lo)
        append(lo, current)
        last = value(stop - 1)
        while current != last:
            left, right = lo + 1, stop - 1
            while left < right:
                middle = (left + right) // 2
                if value(middle) == current:
                    left = middle + 1
                else:
                    right = middle
            lo = left
            current = value(lo)
            append(lo, current)
    return tuple(events)
