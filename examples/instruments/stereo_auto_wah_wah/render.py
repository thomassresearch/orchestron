"""Render matching continuous/stepped wah auditions and controller extremes."""

import json
from pathlib import Path

import numpy as np

from backend.tools.granular_capture_audio import render_capture
from backend.tools.tube_overdrive_audio import metrics, write_float_wav
from examples.instruments.stereo_auto_wah_wah.build import build


def main():
    folder = Path("output/stereo-auto-wah-wah")
    folder.mkdir(parents=True, exist_ok=True)
    sr = 48000
    t = np.arange(4 * sr) / sr
    source = np.column_stack([
        sum(.18 / n * np.sin(2 * np.pi * 110 * n * t) for n in range(1, 60)),
        sum(.16 / n * np.sin(2 * np.pi * 165 * n * t) for n in range(1, 45)),
    ])
    for side, phase in ((0, 0), (1, .3)):
        source[:, side] *= np.exp(-4 * ((t + phase) % 1))
    source[t >= 3.5] = 0
    write_float_wav(folder / "source.wav", source)
    settings = {
        "continuous": {},
        **{f"steps_{q}": {"saw_quantization": q} for q in (1, 7, 12, 24)},
        "independent": {"saw_link": 0, "saw_quantization": 12},
    }
    patch = build()
    for node in patch.graph.nodes:
        if node.opcode == "perf_controller":
            for end in ("min", "max"):
                settings[f"{node.id}_{end}"] = {node.id: node.params[end]}
    report = {}
    for name, values in settings.items():
        audio = render_capture(patch, source, values=values)
        write_float_wav(folder / f"{name}.wav", audio)
        report[name] = dict(**metrics(audio), settings=values)
    (folder / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
