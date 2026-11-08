"""Pure analysis of T07c browser probes; never registers renderer evidence.

Audio output timestamps are browser estimates, not physical loopback readings.
Keep censored and invalid observations distinct from zero latency or zero loss.
"""
from __future__ import annotations

import math

import numpy as np


def distribution(values):
    data = np.sort(np.asarray(values, dtype=np.float64))
    if data.ndim != 1 or not len(data) or not np.isfinite(data).all():
        raise ValueError("Expected nonempty finite observations")
    return {"count": len(data), "mean": float(data.mean()), "median": float(np.median(data)),
            "p95": float(data[math.ceil(len(data) * .95) - 1]),
            "p99": float(data[math.ceil(len(data) * .99) - 1]), "max": float(data[-1])}


def bootstrap_difference(single, parallel, *, replicates=10000, seed=70703):
    """Independent empirical bootstrap, parallel minus single, nearest-rank p95."""
    a, b = np.asarray(single, dtype=float), np.asarray(parallel, dtype=float)
    distribution(a)
    distribution(b)
    if min(len(a), len(b)) < 2:
        raise ValueError("Repeated observations required")
    if type(replicates) is not int or replicates < 1:
        raise ValueError("Positive integer bootstrap count required")
    rng = np.random.default_rng(seed)
    left = a[rng.integers(len(a), size=(replicates, len(a)))]
    right = b[rng.integers(len(b), size=(replicates, len(b)))]
    mean = right.mean(axis=1) - left.mean(axis=1)
    p95 = np.sort(right, axis=1)[:, math.ceil(len(b) * .95) - 1] - np.sort(left, axis=1)[:, math.ceil(len(a) * .95) - 1]
    return {"replicates": replicates, "seed": seed, "confidence": .95,
            "mean_delta_ms_ci": np.quantile(mean, [.025, .975]).tolist(),
            "p95_delta_ms_ci": np.quantile(p95, [.025, .975]).tolist()}


def compare_latency(single, parallel, *, block_ms=32 / 48):
    if not math.isfinite(block_ms) or block_ms <= 0:
        raise ValueError("Positive finite block duration required")
    for run in (single, parallel):
        if (run["state"] != "complete" or run["errors"] or len(run["trials"]) != 128
                or len(run["warmupTrials"]) != 4 or len(run["calibration"]) != 16
                or any(not math.isfinite(c["frameError"]) or abs(c["frameError"]) > 1
                       for c in run["calibration"])):
            raise ValueError("Incomplete or uncalibrated MIDI latency evidence")
    if single["settings"] != parallel["settings"] or single["specification"] != parallel["specification"]:
        raise ValueError("Unmatched MIDI latency conditions")
    a = [t["outputLatencyMs"] for t in single["trials"]]
    b = [t["outputLatencyMs"] for t in parallel["trials"]]
    if min(*a, *b) < 0:
        raise ValueError("Negative latency estimate")
    intervals = bootstrap_difference(a, b)
    upper = max(intervals[k][1] for k in ("mean_delta_ms_ci", "p95_delta_ms_ci"))
    lower = max(intervals[k][0] for k in ("mean_delta_ms_ci", "p95_delta_ms_ci"))
    result = "pass" if upper <= block_ms else "regression" if lower > block_ms else "inconclusive"
    losses = {}
    for name, run in (("single", single), ("parallel", parallel)):
        losses[name] = {"entire_phase": run["end"]["ring"][2] - run["start"]["ring"][2],
                        "measured_bursts_and_gaps": run["trials"][-1]["after"]["ring"][2]
                        - run["trials"][0]["before"]["ring"][2]}
        if min(losses[name].values()) < 0:
            raise ValueError("Audio ring counters reset during latency probe")
    return {"single_ms": distribution(a), "parallel_ms": distribution(b), "difference": intervals,
            "single_first_second_64": bootstrap_difference(a[:64], a[64:]),
            "block_ms": block_ms, "decision": result, "underruns": losses,
            "scope": "Browser estimated output time; no physical speaker latency claim"}


def _offset_ms(snapshot):
    stamp = snapshot["outputStamp"]
    if (not all(math.isfinite(v) for v in (snapshot["atEpochMs"], snapshot["atPerfMs"],
                                          stamp["performanceTime"], stamp["contextTime"]))
            or stamp["performanceTime"] <= 0 or stamp["contextTime"] <= 0):
        raise ValueError("Audio output clock is not initialized")
    return snapshot["atEpochMs"] - snapshot["atPerfMs"] + stamp["performanceTime"] - stamp["contextTime"] * 1000


def analyze_recovery(trial, telemetry, *, sample_rate=48000, stable_seconds=10):
    if not all(math.isfinite(v) and v > 0 for v in (sample_rate, stable_seconds)):
        raise ValueError("Positive finite recovery timing required")
    rows = np.asarray(telemetry["data"], dtype=np.float64).reshape(-1, 4)
    if (len(rows) != telemetry["count"] or len(rows) < 2 or not np.isfinite(rows).all()
            or not np.equal(rows, np.floor(rows)).all() or telemetry.get("overflow", False)):
        raise ValueError("Invalid recovery telemetry")
    frame_steps = np.diff(rows[:, 0])
    if not np.all(frame_steps == 128):
        raise ValueError("Recovery telemetry missed an audio quantum")
    advances = (np.diff(rows[:, 1]).astype(np.int64) % (2 ** 32))
    if np.any(advances > 128) or np.any(np.diff(rows[:, 3]) < 0):
        raise ValueError("Ring reset or invalid counters during recovery")
    # Two observed clock mappings bound drift over this short diagnostic interval.
    offsets = [_offset_ms(telemetry[k]) for k in ("started", "ended")]
    time_min = rows[:, 0] * 1000 / sample_rate + min(offsets)
    time_max = rows[:, 0] * 1000 / sample_rate + max(offsets)
    resume_lo = trial["resume_command_start_epoch"] * 1000
    resume_hi = trial["resume_completed_epoch"] * 1000
    pause_lo = trial["pause_command_start_epoch"] * 1000
    if not all(math.isfinite(v) for v in (pause_lo, resume_lo, resume_hi)) or not pause_lo < resume_lo <= resume_hi:
        raise ValueError("Invalid pause/resume timestamps")
    before = rows[time_max < pause_lo]
    clean_before = bool(len(before) and before[-1, 3] == before[0, 3])
    underruns = int(rows[-1, 3] - rows[0, 3])
    stable_frames = stable_seconds * sample_rate
    candidate = None
    for i in range(1, len(rows)):
        if time_max[i] < resume_lo or advances[i - 1] != 128:
            continue
        end = int(np.searchsorted(rows[:, 0], rows[i, 0] + stable_frames))
        if end >= len(rows):
            break
        if rows[end, 3] == rows[i, 3] and np.all(advances[i:end] == 128):
            candidate = i
            break
    status = ("unclean_baseline" if not clean_before else "no_dropout_induced" if not underruns
              else "recovered" if candidate is not None else "censored")
    return {"status": status, "underruns": underruns, "missing_frames": int(np.sum(128 - advances)),
            "minimum_queue_frames": int(np.min((rows[:, 2].astype(np.int64) - rows[:, 1].astype(np.int64)) % 2 ** 32)),
            "clock_mapping_spread_ms": max(offsets) - min(offsets),
            "observed_seconds": (rows[-1, 0] - rows[0, 0]) / sample_rate,
            "post_resume_observed_seconds": max(0., time_min[-1] - resume_hi) / 1000,
            "recovery_ms_bounds": None if candidate is None else [max(0., time_min[candidate] - resume_hi),
                                                                    max(0., time_max[candidate] - resume_lo)],
            "stable_seconds_required": stable_seconds}


def compare_recovery(single, parallel):
    """Compare total losses and worst recovery bounds across three matched pulses."""
    fields = ("pulse_seconds", "recovery_observation_seconds", "stability_window_seconds")
    if any(single[k] != parallel[k] for k in fields):
        raise ValueError("Unmatched recovery conditions")
    analyzed = {}
    for name, run in (("single", single), ("parallel", parallel)):
        if len(run["trials"]) != 3 or len(run["telemetry"]) != 3:
            raise ValueError("Incomplete recovery evidence")
        if [t["id"] for t in run["trials"]] != [t["id"] for t in run["telemetry"]]:
            raise ValueError("Mismatched recovery trial identities")
        analyzed[name] = [analyze_recovery(t, rows, stable_seconds=run["stability_window_seconds"])
                          for t, rows in zip(run["trials"], run["telemetry"], strict=True)]
        duration = run["recovery_observation_seconds"]
        if (not math.isfinite(duration) or duration <= 0
                or any(t["post_resume_observed_seconds"] < duration for t in analyzed[name])):
            raise ValueError("Incomplete recovery observation window")
    totals = {name: sum(t["underruns"] for t in trials) for name, trials in analyzed.items()}
    if any(t["status"] != "recovered" for trials in analyzed.values() for t in trials):
        return {"trials": analyzed, "total_underruns": totals, "decision": "inconclusive",
                "reason": "Every matched pulse requires a clean baseline, a dropout and observed recovery"}
    bounds = {name: [max(t["recovery_ms_bounds"][i] for t in trials) for i in range(2)]
              for name, trials in analyzed.items()}
    decision = ("regression" if totals["parallel"] > totals["single"] or bounds["parallel"][0] > bounds["single"][1]
                else "pass" if bounds["parallel"][1] <= bounds["single"][0] else "inconclusive")
    return {"trials": analyzed, "total_underruns": totals, "worst_recovery_ms_bounds": bounds,
            "decision": decision}
