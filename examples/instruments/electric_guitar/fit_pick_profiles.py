"""Refine high-register contact timing without changing the fitted ringing tone.

The original 100 Hz partial filters smeared the first milliseconds. Demodulate
at a wider, pitch-dependent bandwidth and fit both model and source through the
same filter. A delayed fast rise and short harmonic excess model pick contact.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.optimize import least_squares
from scipy.signal import butter, sosfiltfilt

HERE = Path(__file__).resolve().parent
SR = 48000


def main():
    recording, sr = sf.read(HERE / "work/range_fit/reference.wav", always_2d=True)
    assert sr == SR
    measurements = json.loads((HERE / "validation/range_reference.json").read_text())["measurements"]
    tuning = json.loads((HERE / "range_tuning.json").read_text())
    profiles = []
    for note in [71, 76, 80, 83]:
        row = next(r for r in measurements if r["midi"] == note)
        profile = next(p for p in tuning["profiles"] if p["midi"] == note)
        first = round((row["onset_seconds"] - 0.15) * SR)
        audio = recording[first : first + 24000]
        t = np.arange(len(audio)) / SR - 0.15
        positive = np.maximum(t, 0)
        baseband = butter(3, row["fundamental_hz"] * 0.24, fs=SR, output="sos")
        steady = (t >= 0.08) & (t < 0.20)
        fit = (t >= -0.006) & (t < 0.075)
        # One sample per 0.5 ms; filtering remains at the full 48 kHz rate.
        indices = np.flatnonzero(fit)[::24]
        weight = np.where(t[indices] < 0.03, 1.5, 1)
        delays, rises, boosts, precursors, errors = [], [], [], [], []
        for h in range(24):
            old_rise = profile["rise_seconds"][h] if h < len(profile["rise_seconds"]) else 0.002
            delay, rise, boost, precursor, error = 0.00002, old_rise, 0.0, 0.0, None
            if h < len(row["partials"]) and profile["weights_db"][h] > -42:
                partial = row["partials"][h]
                demodulated = 2 * audio * np.exp(-2j * np.pi * partial["frequency_hz"] * t[:, None])
                target = np.sqrt(np.mean(abs(sosfiltfilt(baseband, demodulated, axis=0)) ** 2, axis=1))
                target = np.sqrt(np.maximum(target**2 - np.median(target[t < -0.03] ** 2), 0))
                decay = np.exp(-np.log(1000) * positive / profile["early_t60"][h])
                scale = np.sqrt(np.mean(decay[steady] ** 2) / max(np.mean(target[steady] ** 2), 1e-20))
                target *= scale

                def model(params):
                    d, tau, excess, initial = params
                    elapsed = np.maximum(t - d, 0)
                    excitation = (1 - np.exp(-elapsed / tau)) ** 2
                    contact = (1 - np.exp(-elapsed / 0.00035)) ** 2
                    initial_contact = (1 - np.exp(-positive / 0.0004)) ** 2 * np.exp(-positive / 0.004)
                    return decay * (
                        excitation + excess * contact * np.exp(-positive / 0.012) + initial * initial_contact
                    )

                def objective(params):
                    envelope = abs(sosfiltfilt(baseband, model(params)))
                    return (envelope[indices] - target[indices]) * weight

                candidates = []
                for initial_delay in [0.0001, 0.005, 0.010]:
                    result = least_squares(
                        objective,
                        [initial_delay, min(old_rise, 0.003), 0.4, 0.2],
                        bounds=([0.00002, 0.00015, 0, 0], [0.018, 0.015, 4, 1]),
                        x_scale=[0.005, 0.003, 1, 0.3],
                        max_nfev=65,
                    )
                    candidates.append(result)
                best = min(candidates, key=lambda r: np.linalg.norm(r.fun))
                delay, rise, boost, precursor = map(float, best.x)
                error = float(np.sqrt(np.mean(best.fun**2)))
            delays.append(delay)
            rises.append(rise)
            boosts.append(boost)
            precursors.append(precursor)
            errors.append(error)
        profiles.append(
            dict(
                midi=note,
                delay_seconds=delays,
                rise_seconds=rises,
                excess=boosts,
                precursor=precursors,
                residual=errors,
            )
        )
        print(
            note,
            "delay ms",
            [round(v * 1000, 2) for v in delays[:9]],
            "rise ms",
            [round(v * 1000, 2) for v in rises[:9]],
            "boost",
            [round(v, 2) for v in boosts[:9]],
            flush=True,
        )
    result = dict(
        reference_recording="MyEGuitarWholePitchRange.m4a",
        first_full_strength_note=71,
        transition_from_note=70,
        transient_tau_seconds=0.012,
        analysis_demodulation_cutoff_fraction=0.24,
        analysis_frame_seconds=0.0005,
        profiles=profiles,
    )
    (HERE / "pick_tuning.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
