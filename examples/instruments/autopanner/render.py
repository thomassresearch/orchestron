"""Render a matched stereo source at defaults and all Autopanner endpoints."""

import json
from pathlib import Path

import numpy as np

from backend.tools.stereo_delay_audio import SAMPLE_RATE, compile_probe, render_probe
from backend.tools.tube_overdrive_audio import load_patch, metrics, write_float_wav


def main():
    patch = load_patch(Path(__file__).with_name("autopanner.patch.json"))
    output = Path("output/autopanner/audio")
    output.mkdir(parents=True, exist_ok=True)
    # 24 seconds covers three cycles of the slowest individual endpoint.
    t = np.arange(24 * SAMPLE_RATE) / SAMPLE_RATE
    center = sum(np.sin(2 * np.pi * frequency * harmonic * t) / harmonic
                 for frequency in (110, 138.5913, 164.8138) for harmonic in range(1, 9)) * 0.035
    envelope = np.minimum(t / 0.03, 1) * np.minimum((24 - t) / 0.2, 1)
    source = np.column_stack([
        (center + 0.04 * np.sin(2 * np.pi * 440 * t)) * envelope,
        (center + 0.04 * np.sin(2 * np.pi * 660 * t)) * envelope,
    ])
    settings = {"default": {}}
    for node in patch.graph.nodes:
        if node.opcode == "perf_controller":
            for endpoint in ("min", "max"):
                settings[f"{node.id}_{endpoint}"] = {node.id: node.params[endpoint]}
    write_float_wav(output / "source.wav", source)
    report = {}
    for name, values in settings.items():
        samples = render_probe(compile_probe(patch, values=values), source, 25)
        report[name] = dict(**metrics(samples), settings=values,
                            cycle_seconds=60 * values.get("ap_beats", 4) / values.get("ap_tempo", 120),
                            tail_peak=float(np.max(np.abs(samples[-SAMPLE_RATE:]))))
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) >= 1:
            raise RuntimeError(f"Invalid or clipped audition: {name}")
        write_float_wav(output / f"{name}.wav", samples)
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(renders=len(report), max_peak=max(r["peak"] for r in report.values()),
                          max_tail_peak=max(r["tail_peak"] for r in report.values()), output=str(output))))


if __name__ == "__main__":
    main()
