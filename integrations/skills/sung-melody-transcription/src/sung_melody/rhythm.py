"""Clap pulse fitting and joint dynamic-programming rhythm quantization."""
from dataclasses import replace
import math

import numpy as np

from .notes import Note, edit


def parse_meter(text: str) -> tuple[int, int]:
    try:
        numerator, denominator = map(int, text.split("/"))
    except (ValueError, TypeError):
        raise ValueError("Meter must be numerator/denominator, e.g. 4/4 or 6/8") from None
    if numerator < 1 or numerator > 32 or denominator not in (1, 2, 4, 8, 16):
        raise ValueError("Meter numerator must be 1–32 and denominator a power of two up to 16")
    return numerator, denominator


def beat_fit(claps: np.ndarray, tempo: float | None = None, beat_zero: float | None = None) -> dict:
    claps = np.sort(np.asarray(claps, dtype=float))
    if tempo is not None and (not np.isfinite(tempo) or not 20 <= tempo <= 400):
        raise ValueError("Tempo must be 20–400 quarter notes per minute")
    warnings = []
    candidates = []
    if tempo is None and len(claps) >= 3:
        intervals = np.diff(claps)
        periods = np.unique(np.round(np.concatenate([intervals / n for n in (1, 2, 3, 4)]), 5))
        for period in periods:
            if not .25 <= period <= 1.5:
                continue
            # Robust regression allows missing claps without making every other clap a beat.
            indices = np.rint((claps-claps[0])/period)
            if len(np.unique(indices)) != len(claps):
                continue
            for _ in range(3):
                slopes = np.diff(claps)/np.maximum(1, np.diff(indices))
                period = float(np.median(slopes))
                intercept = float(np.median(claps-indices*period))
                indices = np.rint((claps-intercept)/period)
            residual = claps-(intercept+indices*period)
            error = float(np.sqrt(np.mean(np.minimum(residual**2, .1**2))))
            missing = max(0., float(np.mean(np.diff(indices))-1))
            if .25 <= period <= 1.5:
                candidates.append({"tempo": 60/period, "beat_zero_seconds": intercept,
                                   "residual_seconds": error, "score": error+.015*missing})
        candidates.sort(key=lambda c: c["score"])
    if tempo is None:
        if candidates and candidates[0]["residual_seconds"] <= .045:
            tempo = candidates[0]["tempo"]
            source = "claps"
            warnings.append("Claps identify a pulse, not a downbeat or meter; half/double-time remains possible.")
        else:
            tempo, source = 120., "default"
            warnings.append("No reliable clap pulse: 120 BPM is a review default; supply --tempo if known.")
    else:
        source = "supplied"
    period = 60/tempo
    if beat_zero is None:
        if len(claps):
            # Circular mean robustly aligns supplied tempo to claps crossing the phase wrap.
            phase = np.angle(np.mean(np.exp(2j*np.pi*claps/period))) * period/(2*np.pi)
            beat_zero = float(phase if phase <= 1e-7 else phase-period)
            alignment = "claps; beat at or immediately before recording start"
            residual = np.abs((claps-beat_zero+period/2) % period-period/2)
            if np.median(residual) > .045:
                warnings.append("Claps do not align reliably to the selected tempo; review --beat-zero.")
        else:
            beat_zero, alignment = 0., "recording start (assumed)"
    else:
        if not np.isfinite(beat_zero):
            raise ValueError("Beat zero must be finite")
        alignment = "supplied"
    return {"tempo": float(tempo), "source": source, "beat_zero_seconds": beat_zero,
            "alignment": alignment, "claps_seconds": claps.tolist(),
            "pulse_candidates": candidates[:8], "warnings": warnings}


def quantize(notes: list[Note], beat: dict, meter: tuple[int, int], bars: int | None,
             ending: str, log: list, grid: int = 16) -> tuple[list[dict], float]:
    if bars is not None and (not isinstance(bars, int) or bars < 1 or bars > 1024):
        raise ValueError("Bar count must be 1–1024")
    if grid not in (8, 16, 32) or ending not in ("preserve", "hold", "rest"):
        raise ValueError("Use grid 8, 16 or 32 and ending preserve, hold or rest")
    step = 4/grid  # All musical times use quarter-note beats, including compound meter.
    bar_beats = meter[0]*4/meter[1]
    factor, origin = beat["tempo"]/60, beat["beat_zero_seconds"]
    beats = [replace(n, start=(n.start-origin)*factor, end=(n.end-origin)*factor) for n in notes]
    length = bars*bar_beats if bars is not None else max(bar_beats, math.ceil(beats[-1].end/bar_beats)*bar_beats)
    limit = int(round(length/step))
    working = []
    for n in beats:
        if n.end <= 0 or n.start >= length:
            edit(log, "phrase_crop", [n], [], "Note outside requested phrase; times in quarter-note beats")
            continue
        clipped = replace(n, start=max(0, n.start), end=min(length, n.end))
        if clipped != n:
            edit(log, "phrase_clip", [n], [clipped], "Clip to requested phrase; times in quarter-note beats")
        working.append(clipped)
    if not working:
        raise ValueError("No notes inside the requested phrase; check beat zero and bar count")
    # DP states are (start,end) pairs for each note. Costs see both boundaries and
    # duration; transition constraints preserve order and every surviving rest.
    layers = []
    for i, n in enumerate(working):
        s, e = n.start/step, n.end/step
        starts = range(max(0, math.floor(s)-1), min(limit-1, math.ceil(s)+1)+1)
        ends = range(max(1, math.floor(e)-1), min(limit, math.ceil(e)+1)+1)
        states = {}
        rest = 1 if i and n.start-working[i-1].end > 1e-7 else 0
        for start in starts:
            for end in ends:
                if end <= start:
                    continue
                if i == 0 and n.start >= step/2 and start == 0:
                    continue
                if i == len(working)-1 and ending == "preserve" and length-n.end >= step/2 and end == limit:
                    continue
                # A small prior tips near-equivalent timings toward eighth-note boundaries.
                eighth = grid//8
                complexity = .09*((start % eighth != 0)+(end % eighth != 0))
                cost = (start-s)**2+(end-e)**2+.2*((end-start)-(e-s))**2+complexity
                parent = None
                if i:
                    valid = [(state_cost+cost, state) for state, (state_cost, _) in layers[-1].items()
                             if start >= state[1]+rest]
                    if not valid:
                        continue
                    cost, parent = min(valid)
                states[(start, end)] = (cost, parent)
        if not states:
            raise ValueError("Phrase cannot fit this grid while preserving notes and rests; use --grid 32 or more bars")
        layers.append(states)
    state = min(layers[-1], key=lambda k: layers[-1][k][0])
    path = []
    for layer in reversed(layers):
        path.append(state)
        state = layer[state][1]
    result = []
    for n, (start, end) in zip(working, reversed(path)):
        item = {"id": n.id, "start_beat": start*step, "end_beat": end*step,
                "midi_pitch": int(round(n.pitch)), "velocity": 88}
        if abs(n.start-item["start_beat"]) > 1e-8 or abs(n.end-item["end_beat"]) > 1e-8:
            edit(log, "joint_quantization", [{"id": n.id, "start_beat": n.start, "end_beat": n.end}], [item],
                 "Joint timing fit with positive durations, rests, non-overlap and a weak eighth-note preference")
        result.append(item)
    old = dict(result[-1])
    if ending == "hold":
        result[-1]["end_beat"] = length
    elif ending == "rest":
        result[-1]["end_beat"] = min(result[-1]["end_beat"], length-step)
        if result[-1]["end_beat"] <= result[-1]["start_beat"]:
            raise ValueError("A final rest would erase the last note; use more bars or ending preserve")
    if old != result[-1]:
        edit(log, "ending_preference", [old], [dict(result[-1])], f"Requested {ending} ending")
    if result[-1]["end_beat"] < length:
        edit(log, "phrase_trailing_rest", [], [{"start_beat": result[-1]["end_beat"], "end_beat": length}],
             "Keep phrase length, including its final silence")
    return result, length
