"""Render the authored dry instruments and independent Csound source references.

Run: .venv/bin/python tools/altamax/audition.py
Output WAVs and measurements go to output/altamax (not test fixtures).
"""

import argparse
import json
from pathlib import Path
import sys
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.tests.altamax_audio_support import reference  # noqa: E402
from backend.tests.guitar_audio_support import compile_guitars, note_events, render, rms  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "output/altamax")
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    notes = [(.1, 48, 96, .18), (.45, 55, 96, .18), (.8, 60, 96, .18), (1.2, 60, 127, 6)]
    notes += [(8, note, 64, 1) for note in [48, 55, 60]]
    measurements = {}
    for name in ["enough", "logan"]:
        patch = PatchDocument.model_validate(json.loads(
            (ROOT / f"examples/instruments/altamax/{name}.patch.json").read_text()))
        artifact, targets = compile_guitars([patch], mode="host", ksmps=32)
        audio, _ = render(artifact, targets, note_events(notes), 10, mode="host")
        original = reference(name, notes, 10, ksmps=32)
        assert np.isfinite(audio).all() and abs(audio).max() < 1
        assert abs(audio[-2400:]).max() < 1e-10
        for suffix, signal in [("", audio), ("_source", original)]:
            with wave.open(str(args.out_dir / (name.title() + suffix + ".wav")), "wb") as wav:
                wav.setnchannels(2)
                wav.setsampwidth(2)
                wav.setframerate(48000)
                wav.writeframes(np.rint(signal * 32767).astype("<i2").tobytes())
        measurements[name] = dict(peak=float(abs(audio).max()), rms=rms(audio),
                                  stereo_difference_peak=float(abs(audio[:, 0] - audio[:, 1]).max()),
                                  tail_peak=float(abs(audio[-2400:]).max()),
                                  source_difference_rms=rms(audio - original),
                                  sample_rate=48000, ksmps=32, seconds=10,
                                  notes=notes, listened=False)
    (args.out_dir / "measurements.json").write_text(json.dumps(measurements, indent=2) + "\n")
    print(json.dumps(measurements, indent=2))


if __name__ == "__main__":
    main()
