# Tube Overdrive

[Native instrument](../Tube_Overdrive.orch.instrument.json) ·
[Editable raw patch](tube_overdrive.patch.json) ·
[Controls, graph and routing guide](../../../documentation/instrument_design/tube_overdrive.md) ·
[Validation results](VALIDATION.md)

A separate, fully processed stereo continuous insert using gently biased `tanh`,
input filtering, DC removal, adjustable output filtering, and partial gain
compensation. No external samples or additional opcodes are needed. The original
[Overdrive](../Overdrive.orch.instrument.json) is preserved.

Drive: **0–24 dB, default 12**. Tone: **2–12 kHz, default 6.5 kHz**.
Output: **−18 to +6 dB, default −3**. Restart the rack to apply changed performance
settings. Drive at zero is not bypass; output boost can clip.

## Reproduce the patch and auditions

Run from the repository root:

```sh
PYTHONPATH=. uv run python examples/instruments/tube_overdrive/build.py
uv run python -m backend.tools.tube_overdrive_audio \
  examples/instruments/Tube_Overdrive.orch.instrument.json \
  --original examples/instruments/Overdrive.orch.instrument.json \
  --out-dir output/tube-overdrive/audio
```

The builder compiles before writing the raw and native artifacts. It does not
modify the library or test fixture. Import the native file to add it to a library.
The renderer compiles the supplied patch through the actual mixer insert path,
using synthetic sources independent of developer examples.

Auditions cover silence, a 250 Hz sine, a 55 Hz saw bass, a three-note chord, and
bright high-register saws. Each runs at defaults, combined minimum/maximum, and
each individual control's endpoints: 45 float WAVs plus `metrics.json`. Each clip
contains a two-second source with a 50 ms release and time for the effect to settle.

`*_original_then_tube_matched.wav` plays the original followed by Tube Overdrive,
with a short silent gap and both active passages matched to −20 dBFS RMS. This
controls level bias during listening; it is not perceptual loudness normalization.

Generate both spectrogram views, using identical settings for comparisons:

```sh
uv run --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/tube-overdrive/audio/bright_original_then_tube_matched.wav \
  --out-dir output/tube-overdrive/spectrograms --n-fft 4096
```

Open both the `.mel.png` and `.stft.png` files. The effect has no oversampling:
the output filter softens brightness but cannot guarantee alias-free distortion.

## Regression checks

```sh
uv run --extra dev pytest backend/tests/test_tube_overdrive.py
uv run --extra dev pytest backend/tests/test_api.py -k tube_overdrive
npm --prefix frontend run build
docker build --target frontend-build .
```

Tests load `backend/tests/fixtures/patches/tube_overdrive.patch.json`, an independent
versioned snapshot. Update that snapshot deliberately with any future sound
revision; tests never read this example or import its builder.
