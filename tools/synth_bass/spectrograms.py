"""Generate final Mel/STFT images with the patch skill's fixed-reference analyzer."""

import argparse
from pathlib import Path
import sys

from PIL import Image
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
from render_spectrograms import Settings, analyze_audio, render_images  # noqa: E402


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validation-dir", type=Path, default=Path("/tmp/orchestron-synth-bass-validation"))
    args = parser.parse_args()
    settings = Settings(n_fft=4096, hop_length=128, n_mels=128, fmin=20, fmax=8000, vmin=-100, vmax=0)
    paths = [HERE / "audition.wav", *sorted(args.validation_dir.glob("*.wav"))]
    for path in paths:
        samples, sr = sf.read(path, always_2d=True)
        out = HERE / "spectrograms" if path.parent == HERE else args.validation_dir / "spectrograms"
        render_images(analyze_audio(samples, sr, settings), settings, path, out)
    # Full images remain available; these contact sheets ease side-by-side review.
    names = ["default", "bass_tone_min", "bass_tone_max", "bass_decay_min",
             "bass_decay_max", "bass_drive_min", "bass_drive_max"]
    for kind in ("mel", "stft"):
        for page in range(2):
            sheet = Image.new("RGB", (1800, 1080), "white")
            for index, name in enumerate(names[page * 4:(page + 1) * 4]):
                with Image.open(args.validation_dir / "spectrograms" / f"{name}.{kind}.png") as picture:
                    sheet.paste(picture.resize((900, 540), Image.Resampling.LANCZOS),
                                ((index % 2) * 900, (index // 2) * 540))
            output = args.validation_dir / f"review-{kind}-{page + 1}.png"
            sheet.save(output)
            print(output)
    print(f"Generated both views for {len(paths)} stereo auditions. Open the images to inspect them.")
