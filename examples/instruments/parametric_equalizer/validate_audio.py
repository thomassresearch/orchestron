"""Render the exported EQ through real mixer inserts, with reproducible probes."""

import argparse
import json
from pathlib import Path

import numpy as np

from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe
from backend.tools.tube_overdrive_audio import load_patch, metrics, write_float_wav


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("patch", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    patch = load_patch(args.patch)
    controls = [n.id for n in patch.graph.nodes if n.opcode == "perf_controller"]
    frequencies = [63, 160, 400, 1000, 2500, 6300, 16000]
    # Sequential, smoothly gated tones make each band's gain and stereo behavior
    # visible. A deliberately low source level leaves room for combined boosts.
    source = np.zeros((8 * SAMPLE_RATE, 2))
    t = np.arange(SAMPLE_RATE) / SAMPLE_RATE
    gate = np.minimum(1, t / 0.02) * np.minimum(1, (1 - t) / 0.02)
    for band, hz in enumerate(frequencies):
        tone = 0.005 * np.sin(2 * np.pi * hz * t) * gate
        start = band * SAMPLE_RATE
        source[start:start + SAMPLE_RATE, 0] = tone
        source[start + 2400:start + 2400 + SAMPLE_RATE, 1] = tone * 0.5
    scenarios = {"default": {}, "all_min": dict.fromkeys(controls, -20), "all_max": dict.fromkeys(controls, 20)}
    for hz, control in zip(frequencies, controls):
        for db in (-20, 20):
            scenarios[f"{hz}Hz_{db:+d}dB"] = {control: db}
    report = {}
    impulse = np.zeros((2 * SAMPLE_RATE, 2), dtype=np.float32)
    impulse[0] = 0.01
    responses = {}
    for name, values in scenarios.items():
        artifact = compile_probe(patch, values=values)
        output = render_probe(artifact, source, 8)
        write_float_wav(args.out_dir / f"{name}.wav", output)
        report[name] = dict(**metrics(output), settings=values,
                            tail_peak=float(np.max(np.abs(output[-SAMPLE_RATE // 2:]))))
        ir = render_probe(artifact, impulse, 2)
        responses[name] = 20 * np.log10(np.maximum(abs(np.fft.rfft(ir[:, 0]) / impulse[0, 0]), 1e-12))
    (args.out_dir / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    np.savez(args.out_dir / "responses.npz",
             frequency=np.fft.rfftfreq(len(impulse), 1 / SAMPLE_RATE), **responses)
    print(json.dumps(dict(renders=len(report), finite=all(r["finite"] for r in report.values()),
                          peak=max(r["peak"] for r in report.values()),
                          over_full_scale=sum(r["over_full_scale"] for r in report.values()),
                          output=str(args.out_dir))))


if __name__ == "__main__":
    main()
