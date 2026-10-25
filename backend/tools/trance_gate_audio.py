"""Render comparable stereo Trance Gate auditions from an explicit patch file."""

import argparse
import json
from pathlib import Path

import numpy as np

from backend.app.models.patch import PatchDocument
from backend.tools.granular_capture_audio import render_capture
from backend.tools.tube_overdrive_audio import write_float_wav


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("patch", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--stereo", action="store_true", help="Compare manual and LFO stereo depths")
    args = parser.parse_args()
    patch = PatchDocument.model_validate_json(args.patch.read_text())
    args.out_dir.mkdir(parents=True, exist_ok=True)
    t = np.arange(48000 * 12) / 48000
    source = np.column_stack([
        sum(.06 * np.sin(2 * np.pi * hz * t) for hz in (220, 277.1826, 329.6276)),
        sum(.06 * np.sin(2 * np.pi * hz * t) for hz in (330, 415.3047, 493.8833)),
    ])
    events = [(0, 16, 24, 0), (0, 16, 29, 0), (.5, 16, 29, 127), (1.5, 16, 29, 127),
              (2.5, 16, 29, 0), (3, 16, 29, 127), (5.5, 16, 29, 0)]
    settings = {"default": {}, "descending": {"tg_lfo_start": 16, "tg_lfo_end": 2}}
    for name, low, high in [("start", .1, 40), ("end", .1, 40), ("time", .01, 60), ("threshold", 0, 1)]:
        settings[name + "_min"] = {"tg_lfo_" + name: low}
        settings[name + "_max"] = {"tg_lfo_" + name: high}
    cases = {name: (values, events) for name, values in settings.items()}
    if args.stereo:
        manual = [(0, 16, 29, 0), (0, 16, 24, 0), (.5, 16, 24, 127),
                  (1, 16, 24, 127), (1.5, 16, 24, 64), (2, 16, 24, 0),
                  (2.5, 16, 24, 127), (3, 16, 24, 0), (3.5, 16, 24, 127),
                  (4, 16, 24, 0), (4.5, 16, 24, 127), (5.5, 16, 24, 0)]
        cases = {f"{source}_{depth}": ({"tg_stereo": depth}, commands)
                 for source, commands in [("lfo", events), ("manual", manual)]
                 for depth in (0, .5, 1)}
        cases["combined_1"] = ({"tg_stereo": 1}, sorted(events + [
            (.25, 16, 24, 127), (8.5, 16, 24, 0)]))
    report = {}
    write_float_wav(args.out_dir / "source.wav", source)
    for name, (values, commands) in cases.items():
        samples = render_capture(patch, source, commands, mode="midi", ksmps=32, values=values)
        assert np.isfinite(samples).all()
        assert np.max(abs(samples)) <= np.max(abs(source)) + 1e-12
        assert np.max(abs(samples[-48000:])) < 1e-12
        write_float_wav(args.out_dir / f"{name}.wav", samples)
        report[name] = dict(settings=values, events=commands, seconds=12,
                            peak=np.max(abs(samples), axis=0).tolist(),
                            final_second_peak=float(np.max(abs(samples[-48000:]))))
    (args.out_dir / "validation.json").write_text(json.dumps(dict(events=events, renders=report), indent=2) + "\n")
    print(json.dumps(dict(renders=len(report), output=str(args.out_dir), finite=True,
                         max_peak=max(max(r["peak"]) for r in report.values())), indent=2))


if __name__ == "__main__":
    main()
