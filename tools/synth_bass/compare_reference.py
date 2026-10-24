"""Compare bounded filter candidates against harmonic peaks in the private reference.

This is a tuning aid, not a perceptual quality score: speaker/room response and
other sounds contaminate the reference. The source recording is never copied.
"""

import argparse
import copy
import json
from pathlib import Path
import subprocess

import numpy as np

from render import HERE, SR, render


def profile(x, start, stop, f0):
    y = x[int(start * SR):int(stop * SR)]
    power = np.abs(np.fft.rfft(y * np.hanning(len(y)), 65536)) ** 2
    hz = np.fft.rfftfreq(65536, 1 / SR)
    peaks = []
    for harmonic in range(2, min(22, int(2200 / f0))):
        around = power[abs(hz - harmonic * f0) < 7]
        floor = power[(abs(hz - harmonic * f0) > 14) & (abs(hz - harmonic * f0) < 24)]
        peaks.append(max(float(around.max() - np.median(floor)), 1e-12))
    db = 10 * np.log10(peaks)
    return db - np.mean(db[:4])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--out", type=Path, default=HERE / "reference_comparison.json")
    args = parser.parse_args()
    payload = json.loads((HERE / "patch.json").read_text())
    reference = np.frombuffer(subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(args.reference),
        "-f", "f32le", "-ac", "1", "-ar", str(SR), "-",
    ]), dtype="<f4")
    segments = [(0.30, 0.39, 41), (0.63, 0.71, 36), (0.79, 0.87, 33)]
    targets = [profile(reference, a, b, 440 * 2 ** ((p - 69) / 12)) for a, b, p in segments]
    results = []
    for floor in (650, 900, 1200):
        for peak in (3000, 4200):
            for decay in (0.08, 0.12, 0.18):
                candidate = copy.deepcopy(payload)
                for node in candidate["graph"]["nodes"]:
                    if node["id"] == "filter_envelope":
                        node["params"].update(ia=peak, ib=floor, idur2=0.01, ic=floor)
                notes = [(0.1 + i * 0.5, 0.28, pitch, 100)
                         for i, (_, _, pitch) in enumerate(segments)]
                x = render(candidate, notes, 1.5, {"bass_decay": decay})[:, 0]
                errors = []
                for i, (_, _, pitch) in enumerate(segments):
                    got = profile(x, 0.18 + i * 0.5, 0.26 + i * 0.5, 440 * 2 ** ((pitch - 69) / 12))
                    # Limit the influence of room notches and unrelated spectral peaks.
                    errors.append(float(np.mean(np.minimum(abs(got - targets[i]), 12))))
                results.append({"floor_hz": floor, "peak_hz": peak, "decay_s": decay,
                                "robust_harmonic_error_db": float(np.mean(errors))})
    results.sort(key=lambda value: value["robust_harmonic_error_db"])
    args.out.write_text(json.dumps({
        "method": "Harmonics 2-21 below 2.2 kHz; local background subtraction; low-harmonic normalization; 12 dB loss cap.",
        "limitation": "Spectral tuning aid only; the phone recording has unknown speaker/room response.",
        "segments_seconds_midi_note": segments, "candidates": results,
    }, indent=2) + "\n")
    print(json.dumps(results[:6], indent=2))
