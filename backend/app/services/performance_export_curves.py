"""Bounded piecewise-linear SCORE automation; MIDI capture stays unchanged."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from backend.app.models.session import SessionControllerSequencerTrackConfig
    from backend.app.services.performance_export_service import ScoreControllerEvent

SCORE_CURVE_INSTRUMENT = 8999  # Before ordinary CC setters (9000), after note readers.
MAX_SEGMENTS_PER_EVENT = 16
DEFAULT_CURVE_TOLERANCE = 1  # Units on the original 0–127 MIDI scale.


def curve_controller_indices(tracks: list[SessionControllerSequencerTrackConfig], default_channels: tuple[int, ...]) -> set[int]:
    """Only a single curve lane may own an approximated destination.

    Step lanes and competing lanes retain their exact event ordering, including
    when currently disabled (an arrangement can contain their activation).
    """
    owners = defaultdict(list)
    for track in tracks:
        for channel in track.target_channels or default_channels:
            owners[(channel - 1) * 128 + track.controller_number].append(track)
    return {index for index, sources in owners.items()
            if len(sources) == 1 and sources[0].enabled and sources[0].controller_mode == "curve"}


def linear_breakpoints(points: list[tuple[int, int]], tolerance: float = DEFAULT_CURVE_TOLERANCE) -> list[tuple[int, int]]:
    """Bounded-window Ramer-Douglas-Peucker with vertical (CC-value) error.

    Callers supply both ends of each sample-held step. Between those endpoints
    both reference and approximation are linear, so the bound also holds there.
    """
    if len(points) < 3:
        return points[:]
    data = np.asarray(points, dtype=np.float64)
    # Limit worst-case work on adversarial zigzags. Windows share their boundary
    # vertex, so chunking cannot introduce a discontinuity or weaken the bound.
    retained = set(range(0, len(points) - 1, 1024)) | {len(points) - 1}
    boundaries = sorted(retained)
    pending = list(zip(boundaries, boundaries[1:]))
    while pending:
        first, last = pending.pop()
        if last - first < 2:
            continue
        start, initial = data[first]
        end, final = data[last]
        expected = initial + (data[first + 1:last, 0] - start) * (final - initial) / (end - start)
        errors = np.abs(data[first + 1:last, 1] - expected)
        split = int(np.argmax(errors))
        if errors[split] > tolerance:
            split += first + 1
            retained.add(split)
            pending.extend(((first, split), (split, last)))
    return [points[index] for index in sorted(retained)]


def curve_orchestra_lines(tolerance: int = DEFAULT_CURVE_TOLERANCE) -> list[str]:
    lines = [f"; Piecewise linear MIDI curves: maximum error {tolerance:g}/127 at 48 kHz."]
    for count in range(1, MAX_SEGMENTS_PER_EVENT + 1):
        fields = ", ".join(f"p{index}" for index in range(5, 6 + 2 * count))
        lines.extend([f"instr {SCORE_CURVE_INSTRUMENT - count + 1}", "  iindex = int(p4)",
                      f"  kvalue linseg {fields}", "  gk_vcs_score_cc[iindex] = kvalue", "endin"])
    return lines


def is_curve_score_line(line: str) -> bool:
    fields = line.split(maxsplit=2)
    return len(fields) > 1 and fields[0] == "i" and fields[1].isdigit() and (
        SCORE_CURVE_INSTRUMENT - MAX_SEGMENTS_PER_EVENT < int(fields[1]) <= SCORE_CURVE_INSTRUMENT)


def approximate_controller_events(
    events: list[ScoreControllerEvent], eligible: set[int], sample_rate: int,
    *, tolerance: int = DEFAULT_CURVE_TOLERANCE,
) -> tuple[list[ScoreControllerEvent], list[tuple[float, str]]]:
    """Replace only profitable runs; keep startup, jumps and final resets exact."""
    streams = defaultdict(list)
    for position, event in enumerate(events):
        index = (event.midi_channel - 1) * 128 + event.controller_number
        if index in eligible:
            # Match the original six-decimal SCORE timestamp, then Csound's
            # sample grid. Durations below are exact integer sample differences.
            sample = round(float(f"{event.time_seconds:.6f}") * sample_rate)
            streams[index].append((sample, event.value, position))
    removed = set()
    lines = []

    def emit_run(index, run):
        if len(run) < 4:
            return
        points = [run[0][:2]]
        for (previous_sample, previous_value, _), (sample, value, _) in zip(run, run[1:]):
            if sample - 1 > previous_sample:
                points.append((sample - 1, previous_value))
            points.append((sample, value))
        reduced = linear_breakpoints(points, tolerance)
        # Keep both endpoints as ordinary setters, including all startup writes.
        candidates = [position for sample, _, position in run[1:-1] if sample > 0]
        replacements = []
        for offset in range(0, len(reduced) - 1, MAX_SEGMENTS_PER_EVENT):
            chunk = reduced[offset:offset + MAX_SEGMENTS_PER_EVENT + 1]
            start, first = chunk[0]
            end = chunk[-1][0]
            time = start / sample_rate
            fields = " ".join(f"{(right[0] - left[0]) / sample_rate:.10f} {right[1]}"
                              for left, right in zip(chunk, chunk[1:]))
            instrument = SCORE_CURVE_INSTRUMENT - (len(chunk) - 2)
            replacements.append((time, f"i {instrument} {time:.10f} "
                                 f"{(end - start) / sample_rate:.10f} {index} {first} {fields}"))
        original_bytes = sum(len(f"i 9000 {events[p].time_seconds:.6f} 0.000021 {index} {events[p].value}\n")
                             for p in candidates)
        if sum(len(line) + 1 for _, line in replacements) >= original_bytes:
            return
        removed.update(candidates)
        lines.extend(replacements)

    for index, stream in streams.items():
        run = []
        for sample, value, position in stream:
            # A jump is an explicit reset/pad transition, not a smooth ramp.
            # Coincident writes retain capture order and are never interpolated.
            if run and (sample <= run[-1][0] or abs(value - run[-1][1]) > 1):
                emit_run(index, run)
                run = []
            run.append((sample, value, position))
        emit_run(index, run)
    return [event for position, event in enumerate(events) if position not in removed], lines
