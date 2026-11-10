"""Render note/velocity/controller checks without touching live playback."""

import hashlib
import itertools
import json
from pathlib import Path

import numpy as np

from render import HERE, SR, render, riff, write_wav

OUT = Path("/tmp/orchestron-gleissendes-licht-validation")


def segment(audio, start, end):
    return audio[round(start * SR):round(end * SR)]


def rms(audio):
    return float(np.mean(audio ** 2) ** 0.5)


def spectrum(audio, pitch):
    mono = audio.mean(axis=1)
    power = abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    hz = np.fft.rfftfreq(len(mono), 1 / SR)
    fundamental = 440 * 2 ** ((pitch - 69) / 12)
    base = power[abs(hz - fundamental) < 12].sum()
    upper = power[(hz > 1.5 * fundamental) & (hz < 20000)].sum()
    return {"centroid_hz": float(np.sum(hz * power) / power.sum()),
            "upper_vs_fundamental_db": float(10 * np.log10(upper / max(base, 1e-30)))}


def notes():
    sequence = [(0.2 + i * 1.6, 0.35, 64, velocity)
                for i, velocity in enumerate((32, 64, 100, 127))]
    sequence += [(6.5, 0.6, 48, 100), (7.8, 0.6, 84, 100)]
    sequence += [(8.9 + i * 0.13, 0.075, 67, 105) for i in range(5)]
    sequence += [(10.2, 2, 64, 100)]
    sequence += [(12.8, 0.5, pitch, 127) for pitch in (60, 64, 67, 71)]
    return sequence


if __name__ == "__main__":
    payload = json.loads((HERE / "patch.json").read_text())
    ranges = {"light_brilliance": (1.4, 4.8), "light_motion": (0, 0.65),
              "light_release": (0.06, 0.9)}
    scenarios = {"default": {}}
    for key, limits in ranges.items():
        for label, value in zip(("min", "max"), limits):
            scenarios[f"{key}_{label}"] = {key: value}
    for i, corner in enumerate(itertools.product(*ranges.values())):
        scenarios[f"corner_{i}"] = dict(zip(ranges, corner))
    results = {}
    for name, overrides in scenarios.items():
        audio = render(payload, notes(), 15, overrides)
        write_wav(OUT / f"{name}.wav", audio)
        velocities = [rms(segment(audio, 0.22 + i * 1.6, 0.52 + i * 1.6)) for i in range(4)]
        result = {
            "overrides": overrides, "finite": bool(np.isfinite(audio).all()),
            "peak": float(abs(audio).max()), "rms_left": rms(audio[:, 0]),
            "rms_right": rms(audio[:, 1]), "channel_difference_peak": float(abs(audio[:, 0] - audio[:, 1]).max()),
            "tail_peak": float(abs(segment(audio, 14.7, 15)).max()),
            "velocity_rms_32_64_100_127": velocities,
            "held_note": spectrum(segment(audio, 10.7, 11.9), 64),
            "retriggers_rms": [rms(segment(audio, 8.91 + i * 0.13, 8.96 + i * 0.13)) for i in range(5)],
        }
        assert result["finite"] and 0 < result["peak"] < 0.98, (name, result)
        assert result["rms_left"] > 0.005 and result["rms_right"] > 0.005
        assert result["channel_difference_peak"] < 1e-10
        assert result["tail_peak"] < 1e-6
        assert all(a < b for a, b in zip(velocities, velocities[1:])), (name, velocities)
        assert min(result["retriggers_rms"]) > 0.005
        results[name] = result
    assert results["default"]["held_note"]["upper_vs_fundamental_db"] > 6
    assert results["light_brilliance_max"]["held_note"]["centroid_hz"] > results["light_brilliance_min"]["held_note"]["centroid_hz"]
    first, second = (0.1, 0.6, 64, 100), (0.35, 0.5, 71, 95)
    simultaneous = render(payload, [first, second], 2)
    independent = render(payload, [first], 2) + render(payload, [second], 2)
    overlap_error = float(abs(simultaneous - independent).max())
    assert overlap_error < 1e-10
    preview = render(payload, riff(), 9)
    write_wav(HERE / "audition.wav", preview)
    report = {
        "patch_sha256": hashlib.sha256((HERE / "patch.json").read_bytes()).hexdigest(),
        "sample_rate": SR, "duration_seconds_per_scenario": 15,
        "notes_start_duration_pitch_velocity": notes(), "scenarios": results,
        "overlap_error": overlap_error, "preview_peak": float(abs(preview).max()),
        "listened_to": False, "spectrogram_inspection": "Pending",
    }
    (HERE / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"scenarios": len(results), "maximum_peak": max(r["peak"] for r in results.values()),
                      "default_spectrum": results["default"]["held_note"],
                      "preview": str(HERE / "audition.wav")}, indent=2))
