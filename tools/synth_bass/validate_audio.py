"""Render MIDI/override scenarios and assert numerical audio behavior."""

import argparse
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np

from render import HERE, SR, render, riff, write_wav


def rms(samples):
    return float(np.sqrt(np.mean(samples ** 2)))


def segment(samples, start, stop):
    return samples[round(start * SR):round(stop * SR)]


def centroid(samples):
    mono = samples.mean(axis=1)
    power = abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    hz = np.fft.rfftfreq(len(mono), 1 / SR)
    return float(np.sum(hz * power) / max(float(power.sum()), 1e-30))


def suite_notes():
    notes = [(0.1 + i * 0.6, 0.16, 38, velocity)
             for i, velocity in enumerate((32, 64, 100, 127))]
    notes += [(2.5, 0.8, 33, 100), (3.5, 0.8, 41, 100),
              (4.5, 0.18, 38, 100), (4.62, 0.18, 41, 100), (4.74, 0.18, 36, 100)]
    notes += [(5.2 + i * 0.11, 0.065, 38, 100) for i in range(5)]
    notes += [(6.1, 0.8, 38, 100), (6.35, 0.4, 36, 100),
              (7.2, 0.3, 21, 100), (7.7, 0.3, 53, 100)]
    notes += [(8.3, 0.4, pitch, 127) for pitch in (33, 38, 41)]
    return notes


def validate(payload, out):
    scenarios = {"default": {}}
    ranges = {"bass_tone": (0.5, 2), "bass_decay": (0.04, 0.3), "bass_drive": (1, 3)}
    for key, limits in ranges.items():
        for label, value in zip(("min", "max"), limits):
            scenarios[f"{key}_{label}"] = {key: value}
    for index, values in enumerate(itertools.product(*ranges.values())):
        scenarios[f"corner_{index}"] = dict(zip(ranges, values))
    results = {}
    for name, values in scenarios.items():
        audio = render(payload, suite_notes(), 9.5, values)
        path = out / f"{name}.wav"
        write_wav(path, audio)
        velocity = [rms(segment(audio, 0.1 + i * 0.6, 0.31 + i * 0.6)) for i in range(4)]
        result = {
            "overrides": values, "finite": bool(np.isfinite(audio).all()),
            "peak": float(abs(audio).max()), "rms_left": rms(audio[:, 0]),
            "rms_right": rms(audio[:, 1]), "stereo_difference_peak": float(abs(audio[:, 0] - audio[:, 1]).max()),
            "tail_peak_after_release": float(abs(segment(audio, 9.0, 9.5)).max()),
            "velocity_rms_32_64_100_127": velocity,
            "held_note_centroid_hz": centroid(segment(audio, 2.9, 3.2)),
            "decay_window_centroid_hz": centroid(segment(audio, 2.65, 2.75)),
            "retriggers_rms": [rms(segment(audio, 5.21 + i * 0.11, 5.25 + i * 0.11)) for i in range(5)],
        }
        assert result["finite"] and 0 < result["peak"] < 0.9, (name, result)
        assert result["rms_left"] > 0.005 and result["rms_right"] > 0.005
        assert result["stereo_difference_peak"] < 1e-10
        assert result["tail_peak_after_release"] < 1e-6
        assert all(a < b for a, b in zip(velocity, velocity[1:]))
        assert min(result["retriggers_rms"]) > 0.005
        results[name] = result
    assert results["bass_tone_max"]["held_note_centroid_hz"] > results["bass_tone_min"]["held_note_centroid_hz"]
    assert results["bass_decay_max"]["decay_window_centroid_hz"] > results["bass_decay_min"]["decay_window_centroid_hz"]

    a, b = (0.1, 0.4, 38, 100), (0.25, 0.4, 41, 100)
    together = render(payload, [a, b], 1)
    separate = render(payload, [a], 1) + render(payload, [b], 1)
    overlap_error = float(abs(together - separate).max())
    assert overlap_error < 1e-10, overlap_error

    audition = render(payload, riff() + [(3.0, 0.7, 38, 100), (4.0, 0.55, 33, 100)], 5.0)
    write_wav(HERE / "audition.wav", audition)
    report = {
        "patch_sha256": hashlib.sha256((HERE / "patch.json").read_bytes()).hexdigest(),
        "sample_rate": SR, "ksmps": 32, "duration_seconds_per_scenario": 9.5,
        "notes_start_duration_pitch_velocity": suite_notes(), "scenarios": results,
        "overlapping_notes_vs_independent_attacks_peak_error": overlap_error,
        "preview_peak": float(abs(audition).max()), "listened_to": False,
        "spectrogram_inspection": "Pending; run the skill renderer and open both views after these numerical checks.",
    }
    (HERE / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"scenarios": len(results), "highest_peak": max(r["peak"] for r in results.values()),
                      "overlap_error": overlap_error, "preview": str(HERE / "audition.wav")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("/tmp/orchestron-synth-bass-validation"))
    args = parser.parse_args()
    validate(json.loads((HERE / "patch.json").read_text()), args.out)
