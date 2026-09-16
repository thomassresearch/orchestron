#!/usr/bin/env python3
"""Generate the skill's Mel/STFT views plus readable comparison review sheets.

Run with the patch skill's optional audio dependencies. Never marks images as
inspected: that requires opening and reviewing the generated files separately.
"""

from __future__ import annotations
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
import math
from pathlib import Path
import sys

PACK = Path(__file__).resolve().parent
ROOT = PACK.parents[2]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))


def render_atlases(slug, selected):
    """Compact overviews of every stereo plot; retain originals for close review."""
    from PIL import Image, ImageDraw, ImageFont
    from matplotlib.font_manager import findfont

    font_path = Path("/System/Library/Fonts/Helvetica.ttc")
    font = ImageFont.truetype(str(font_path) if font_path.exists() else findfont("DejaVu Sans"), 14)
    paths = []
    for idx, kind in enumerate(("mel", "stft")):
        canvas = Image.new("RGB", (1600, math.ceil(len(selected) / 4) * 265 + 35), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text(
            (15, 8),
            slug + " — " + kind + " — Left/Right in every panel; consistent scales within instrument",
            font=font,
            fill="black",
        )
        for number, (name, item) in enumerate(selected.items()):
            x, y = (number % 4) * 400, (number // 4) * 265 + 35
            draw.text((x + 8, y), name, font=font, fill="black")
            with Image.open(PACK / item["spectrograms"][idx]) as im:
                im = im.convert("RGB")
                im.thumbnail((400, 240))
                canvas.paste(im, (x, y + 23))
        path = PACK / "validation" / "review" / f"{slug}__{kind}.png"
        canvas.save(path)
        paths.append(str(path.relative_to(PACK)))
    return paths


def process_instrument(report_path):
    import soundfile as sf
    from PIL import Image, ImageDraw
    from render_spectrograms import Settings, analyze_audio, render_images

    report = json.loads(report_path.read_text())
    slug = report_path.stem
    out = PACK / "validation" / "spectrograms" / slug
    settings = Settings(n_fft=4096, hop_length=512)
    selected = {k: v for k, v in report["results"].items() if not k.startswith("velocity_")}
    for name, item in selected.items():
        audio = PACK / item["file"]
        samples, sr = sf.read(audio, always_2d=True)
        result = analyze_audio(samples, sr, settings)
        images = render_images(result, settings, audio, out)
        item["spectrograms"] = [str(p.relative_to(PACK)) for p in images]
        del samples, result
    # Keep full-resolution originals. Each sheet contains min/default/max for one
    # control and one spectral view, with both stereo channels visible in every tile.
    review = PACK / "validation" / "review" / slug
    review.mkdir(parents=True, exist_ok=True)
    controls = [k[:-4] for k in selected if k.endswith("_min")]
    sheets = []
    for kind, idx in [("mel", 0), ("stft", 1)]:
        for control in controls:
            names = [control + "_min", "probe_default", control + "_max"]
            canvas = Image.new("RGB", (1800, 3 * 1120), "white")
            draw = ImageDraw.Draw(canvas)
            for row, name in enumerate(names):
                p = PACK / selected[name]["spectrograms"][idx]
                with Image.open(p) as im:
                    im = im.convert("RGB")
                    im.thumbnail((1800, 1080))
                    canvas.paste(im, (0, row * 1120 + 40))
                draw.text((25, row * 1120 + 10), f"{slug} | {control} | {name} | {kind}", fill="black")
            path = review / f"{control}.{kind}.png"
            canvas.save(path)
            sheets.append(str(path.relative_to(PACK)))
    report["spectrogram_settings"] = {
        "n_fft": 4096,
        "hop_length": 512,
        "n_mels": 128,
        "fmin": 20,
        "fmax": 24000,
        "vmin": -100,
        "vmax": 0,
    }
    report["review_sheets"] = sheets
    report["review_atlases"] = render_atlases(slug, selected)
    report["spectrograms_inspected"] = False
    report.pop("visual_review", None)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return f"{slug}: {len(selected) * 2} spectral images, {len(sheets)} comparison sheets"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--only", nargs="+")
    p.add_argument("--workers", type=int, default=2)
    args = p.parse_args()
    paths = [
        p
        for p in sorted((PACK / "validation").glob("*.json"))
        if (not args.only or p.stem in args.only) and "results" in json.loads(p.read_text())
    ]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(process_instrument, paths):
            print(result, flush=True)


if __name__ == "__main__":
    main()
