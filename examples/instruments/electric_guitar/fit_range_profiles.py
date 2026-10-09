"""Estimate per-partial attacks through the same analysis filter as the source."""

import json
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt
from scipy.ndimage import uniform_filter1d
from scipy.optimize import minimize_scalar

HERE = Path(__file__).resolve().parent / "work/range_fit"
sr = 48000
x, _ = sf.read(HERE / "reference.wav")
measurements = json.loads((HERE / "measurements.json").read_text())
profiles = []
for row in measurements:
    note = row["midi"]
    onset = row["onset_seconds"]
    fund = row["fundamental_hz"]
    duration = min(0.6, row["natural_fit_end_seconds"])
    start = round((onset - 0.15) * sr)
    clip = x[start : round((onset + duration + 0.15) * sr)]
    times = np.arange(len(clip)) / sr - 0.15
    use = (times >= 0) & (times < duration)
    weights = np.where(times[use][::240] < 0.13, 3, 1)
    levels = []
    early = []
    tail = []
    rise = []
    ratios = []
    residuals = []
    for partial in row["partials"]:
        h = partial["harmonic"]
        freq = partial["frequency_hz"]
        width = min(fund * 0.32, 100)
        sos = butter(3, [max(20, freq - width / 2), freq + width / 2], "bandpass", fs=sr, output="sos")

        def feature(y):
            z = sosfiltfilt(sos, y, axis=0)
            if z.ndim == 2:
                z = np.mean(z * z, axis=1)
            else:
                z = z * z
            e = np.sqrt(np.maximum(uniform_filter1d(z, size=round(max(0.006, 3 / fund) * sr)), 1e-20))
            return e

        reference = feature(clip)
        bg = np.median(reference[times < -0.05] ** 2)
        target = np.sqrt(np.maximum(reference[use][::240] ** 2 - bg, 0))
        unit = max(np.max(target), 1e-8)
        t60 = float(np.clip(partial["t60_seconds"] or 20, 0.6, 24))
        if partial["fit_residual_db"] > 2.5 or partial["fit_points"] < 8:
            t60 = min(t60, 8 / (1 + 0.06 * (h - 1)))
        positive = np.maximum(times, 0)
        decay = np.exp(-np.log(1000) * positive / t60)
        sine = np.sin(2 * np.pi * freq * times + h * 0.137 * 2 * np.pi)

        def test(logtau, save=False):
            tau = np.exp(logtau)
            source = (1 - np.exp(-positive / tau)) ** 2 * decay * sine
            f = feature(source)[use][::240]
            gain = float(np.dot(f * weights, target * weights) / max(np.dot(f * weights, f * weights), 1e-20))
            error = float(np.mean(((gain * f - target) * weights / unit) ** 2))
            return (gain, error) if save else error

        if partial["relative_db"] > -48:
            result = minimize_scalar(
                test, bounds=(np.log(0.0004), np.log(0.10)), method="bounded", options={"maxiter": 14, "xatol": 0.06}
            )
            tau = float(np.exp(result.x))
            gain, error = test(result.x, True)
        else:
            tau = 0.002
            gain = partial["level_rms"] * np.sqrt(2)
            error = None
        levels.append(gain)
        early.append(t60)
        tail.append(min(t60, 8 - 0.07 * (note - 40)))
        rise.append(tau)
        # Weak peaks are not reliable evidence of string stiffness.
        ratio = partial["ratio"] if partial["relative_db"] > -40 else h
        ratios.append(float(np.clip(ratio, h * 0.998, h * 1.015)))
        residuals.append(error)
    # Normalize excitation energy, not each partial separately. Recorded picking
    # strengths differ, so their absolute note volumes are not made into key gain.
    levels = np.asarray(levels)
    levels /= np.linalg.norm(levels)
    levels_db = 20 * np.log10(np.maximum(levels, 1e-5))
    profile = dict(
        midi=note,
        weights_db=levels_db.tolist(),
        early_t60=early,
        tail_t60=tail,
        rise_seconds=rise,
        ratios=ratios,
        early_seconds=min(0.7, max(0.4, row["natural_fit_end_seconds"] - 0.05)),
        attack_fit_errors=residuals,
    )
    profiles.append(profile)
    print(note, "rise", [round(v * 1000, 1) for v in rise[:4]], "T60", [round(v, 1) for v in early[:4]], flush=True)
(HERE / "profiles.json").write_text(json.dumps(dict(partials=24, profiles=profiles), indent=2) + "\n")
