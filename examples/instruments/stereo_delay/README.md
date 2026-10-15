# Stereo Delay

[Native instrument](../Stereo_Delay.orch.instrument.json) ·
[Editable raw patch](stereo_delay.patch.json) ·
[Controls and routing](../../../documentation/instrument_design/stereo_delay.md)

A continuous stereo insert with unchanged dry channels and repeating echoes.
Tempo **40–180 BPM (120)**, Beats **1–16 (4)**, Feedback **0–0.9 (0.5)** and
Stereo **0–1 (0.5)** are per-instance performance settings. Restart the rack to
apply changes. Tempo is entered manually. Defaults give an echo every two seconds.

At Stereo zero the echoes retain their channels. At one, odd echoes use the
L/R average on the left and even echoes on the right. Feedback scales the first
echo as well as subsequent repeats; zero is dry only.

## Reproduce

Run from the repository root:

```sh
PYTHONPATH=. uv run python examples/instruments/stereo_delay/build.py
uv run python -m backend.tools.stereo_delay_audio \
  examples/instruments/Stereo_Delay.orch.instrument.json \
  --out-dir output/stereo-delay/audio
```

The builder compiles before writing the native and raw files. It does not change
the library or test fixture. Import the native instrument to add it to a library.
The renderer uses synthetic stereo bursts through the real mixer insert compiler.
It renders defaults and each control's endpoints, with enough tail for echo gain
to fall below 0.00001. WAVs use 48 kHz stereo 32-bit float, with metrics in JSON.

```sh
uv run --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/stereo-delay/audio/stereo_max.wav \
  --out-dir output/stereo-delay/spectrograms --n-fft 2048
```

Open both generated Mel and log-STFT images. Echo timing/channel comparisons use
the same sample rate, FFT size, hop and fixed color scale. These measurements do
not substitute for listening.

## Regression checks

```sh
uv run --extra dev pytest backend/tests/test_stereo_delay.py
uv run --extra dev pytest backend/tests/test_api.py -k 'stereo_delay or continuous_effect_native'
npm --prefix frontend run build
docker build --target frontend-build .
```

Tests read the independent versioned `backend/tests/fixtures/patches/stereo_delay.patch.json`.
They cover dry passthrough, silence, L/R isolation and averaging, overlapping
input, geometric decay, fractional Beats, timing extremes, live/offline block
sizes, native round trips, saved overrides and both CSD export modes. The audio
oracle directly sums shifted input copies, independently of the graph topology.

The graph adds no limiter: a sustained source plus high feedback can exceed
full scale. Keep headroom. Opposite-phase stereo cancels in the mono-average
branch at Stereo one, while the dry channels remain unchanged.

## Verified on 2026-10-15

- 21 native Csound audio regressions and four focused API/round-trip cases passed.
- All nine range auditions contained finite samples and zero samples above full
  scale; the largest measured peak was 0.251406. The high-feedback audition ran
  for 221 seconds to include its decay.
- Both Mel and log-STFT plots were opened and visually inspected for the default
  and Stereo-one auditions. They showed decaying repeats every two seconds, with
  full left/right alternation at Stereo one and retained original-channel energy
  at the default blend. No unexpected persistent tone or abrupt tail was observed.
- These auditions were measured and visually inspected; subjective listening was
  not performed.
- Frontend production build and Docker `frontend-build` both passed.
