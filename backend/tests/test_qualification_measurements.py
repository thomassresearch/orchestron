"""Synthetic measurement controls, never renderer qualification evidence."""
import numpy as np
import pytest

from backend.tools.qualify_partition_browser import (
    analyze_recovery, bootstrap_difference, compare_latency, compare_recovery, distribution,
)


def latency(value):
    snapshot = {"ring": [0, 0, 0]}
    return {"state": "complete", "errors": [], "trials": [
                {"outputLatencyMs": value, "before": snapshot, "after": snapshot}] * 128,
            "warmupTrials": [{}] * 4, "calibration": [{"frameError": 0}] * 16,
            "settings": {"buffer": "unchanged"}, "specification": {"id": "fixture"},
            "start": snapshot, "end": snapshot}


def test_latency_gate_detects_added_whole_block_and_retains_incomplete_trials():
    assert compare_latency(latency(100), latency(99))["decision"] == "pass"
    assert compare_latency(latency(100), latency(101))["decision"] == "regression"
    incomplete = latency(100)
    incomplete["trials"] = incomplete["trials"][:-1]
    with pytest.raises(ValueError, match="Incomplete"):
        compare_latency(incomplete, latency(100))
    uncalibrated = latency(100)
    uncalibrated["calibration"] = [{"frameError": 128}] * 16
    with pytest.raises(ValueError, match="uncalibrated"):
        compare_latency(uncalibrated, latency(100))
    uncalibrated["calibration"] = [{"frameError": float("nan")}] * 16
    with pytest.raises(ValueError, match="uncalibrated"):
        compare_latency(uncalibrated, latency(100))
    changed = latency(100)
    changed["settings"] = {"buffer": "enlarged"}
    with pytest.raises(ValueError, match="Unmatched"):
        compare_latency(changed, latency(100))


def test_latency_bootstrap_is_reproducible_and_nonfinite_samples_are_not_dropped():
    assert bootstrap_difference([1, 2, 3], [2, 3, 4]) == bootstrap_difference([1, 2, 3], [2, 3, 4])
    with pytest.raises(ValueError, match="finite"):
        distribution([1, float("nan"), 2])
    with pytest.raises(ValueError):
        distribution([])


def test_latency_uncertainty_and_audio_losses_are_preserved():
    single, parallel = latency(100), latency(100)
    for run in (single, parallel):
        run["trials"] = [{**t, "outputLatencyMs": 100 + i % 2 * 100} for i, t in enumerate(run["trials"])]
    single["end"] = {"ring": [0, 0, 17]}
    result = compare_latency(single, parallel)
    assert result["decision"] == "inconclusive"
    assert result["underruns"]["single"]["entire_phase"] == 17


def recovery_fixture(*, forever=False, dropout=True):
    frames = np.arange(0, 20 * 48000, 128, dtype=float)
    starving = (frames >= 2 * 48000) & ((frames < 4 * 48000) | forever) & dropout
    read = np.cumsum(np.where(starving, 0, 128))
    under = np.cumsum(starving)
    rows = np.column_stack((frames, read, read + np.where(starving, 0, 1024), under))
    # Output clock offset = 100000 ms; resume at audio time 3 seconds.
    snapshot = {"atEpochMs": 100100, "atPerfMs": 100, "outputStamp": {"performanceTime": 1000, "contextTime": 1}}
    telemetry = {"started": snapshot, "ended": snapshot, "count": len(rows), "data": rows.reshape(-1).tolist()}
    trial = {"pause_command_start_epoch": 101.5, "resume_command_start_epoch": 103,
             "resume_completed_epoch": 103.01}
    return trial, telemetry


def test_recovery_requires_real_dropout_followed_by_full_quanta_and_stable_window():
    result = analyze_recovery(*recovery_fixture())
    assert result["status"] == "recovered"
    assert result["underruns"] == 750
    assert result["missing_frames"] == 96000
    assert result["recovery_ms_bounds"] == [990, 1000]
    assert analyze_recovery(*recovery_fixture(forever=True))["status"] == "censored"
    assert analyze_recovery(*recovery_fixture(dropout=False))["status"] == "no_dropout_induced"


def test_recovery_rejects_clock_gaps_counter_resets_and_unclean_baseline():
    trial, telemetry = recovery_fixture()
    telemetry["data"][4] += 128
    with pytest.raises(ValueError, match="quantum"):
        analyze_recovery(trial, telemetry)
    trial, telemetry = recovery_fixture()
    telemetry["data"][5] -= 512
    with pytest.raises(ValueError, match="reset"):
        analyze_recovery(trial, telemetry)
    trial, telemetry = recovery_fixture()
    trial["pause_command_start_epoch"] = 102.5
    assert analyze_recovery(trial, telemetry)["status"] == "unclean_baseline"


def recovery_run():
    run = {"pulse_seconds": 1.2, "recovery_observation_seconds": 15, "stability_window_seconds": 10,
           "trials": [], "telemetry": []}
    for i in range(3):
        trial, telemetry = recovery_fixture()
        trial["id"] = telemetry["id"] = f"recovery-{i}"
        run["trials"].append(trial)
        run["telemetry"].append(telemetry)
    return run


def test_recovery_comparison_keeps_overlapping_bounds_and_censored_results_inconclusive():
    assert compare_recovery(recovery_run(), recovery_run())["decision"] == "inconclusive"
    single, parallel = recovery_run(), recovery_run()
    for trial in single["trials"]:
        trial["resume_command_start_epoch"] -= .1
        trial["resume_completed_epoch"] -= .1
    assert compare_recovery(single, parallel)["decision"] == "pass"
    assert compare_recovery(parallel, single)["decision"] == "regression"
    single["recovery_observation_seconds"] = parallel["recovery_observation_seconds"] = 60
    with pytest.raises(ValueError, match="observation window"):
        compare_recovery(single, parallel)
    single["recovery_observation_seconds"] = parallel["recovery_observation_seconds"] = 15
    single["telemetry"][0] = recovery_fixture(forever=True)[1]
    single["telemetry"][0]["id"] = "recovery-0"
    assert compare_recovery(single, parallel)["decision"] == "inconclusive"
    single["telemetry"].pop()
    with pytest.raises(ValueError, match="Incomplete"):
        compare_recovery(single, parallel)
