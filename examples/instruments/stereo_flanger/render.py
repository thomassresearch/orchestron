"""Render a matched source through every Flanger control endpoint and defaults."""

import json
from pathlib import Path

import numpy as np

from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe
from backend.tools.tube_overdrive_audio import load_patch, metrics, write_float_wav


def main():
    patch = load_patch(Path(__file__).with_name("stereo_flanger.patch.json"))
    output = Path("output/stereo-flanger/audio")
    output.mkdir(parents=True, exist_ok=True)
    t = np.arange(8 * SAMPLE_RATE) / SAMPLE_RATE
    # Harmonic chords expose the moving comb; a quiet noise bed reveals notches.
    mono = sum(np.sin(2 * np.pi * frequency * harmonic * t) / harmonic
               for frequency in (110, 138.5913, 164.8138) for harmonic in range(1, 17)) * 0.025
    mono += np.random.default_rng(23).uniform(-0.025, 0.025, len(t))
    envelope = np.minimum(t / 0.03, 1) * np.minimum((8 - t) / 0.2, 1)
    source = np.column_stack([mono * envelope, mono * envelope])
    settings = {"default": {}}
    for node in patch.graph.nodes:
        if node.opcode == "perf_controller":
            for endpoint in ("min", "max"):
                settings[f"{node.id}_{endpoint}"] = {node.id: node.params[endpoint]}
    report = {}
    write_float_wav(output / "source.wav", source)
    for name, values in settings.items():
        samples = render_probe(compile_probe(patch, values=values), source, 10)
        report[name] = dict(**metrics(samples), settings=values,
                            tail_peak=float(np.max(np.abs(samples[-SAMPLE_RATE:]))))
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) >= 1:
            raise RuntimeError(f"Invalid or clipped audition: {name}")
        write_float_wav(output / f"{name}.wav", samples)
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(renders=len(report), max_peak=max(r["peak"] for r in report.values()),
                          max_tail_peak=max(r["tail_peak"] for r in report.values()), output=str(output))))


if __name__ == "__main__":
    main()
