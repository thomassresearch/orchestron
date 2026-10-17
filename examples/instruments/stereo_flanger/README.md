# Stereo Flanger

[Native instrument](../Stereo_Flanger.orch.instrument.json) ·
[Editable patch](stereo_flanger.patch.json) ·
[Controls and routing](../../../documentation/instrument_design/stereo_flanger.md)

A continuous stereo flanger with six per-instance controls: Rate, Delay, Depth,
Feedback, Stereo Phase and Mix. Independent left/right delay lines preserve
channel separation. Signed feedback changes the comb character, and compensated
wet gain limits feedback buildup. Restart the rack to apply changed settings.

## Reproduce

Run from the repository root:

```sh
PYTHONPATH=. uv run python examples/instruments/stereo_flanger/build.py
PYTHONPATH=. uv run python examples/instruments/stereo_flanger/render.py
```

The builder compiles before writing the raw graph and native export. It does not
modify the library or test fixture. Import the native file to add it to a library.
The renderer feeds an eight-second harmonic chord with a quiet noise bed through
the actual mixer insert compiler. All thirteen previews use the same stereo
source and a two-second tail: defaults plus each controller's minimum and maximum.
WAVs and numerical metrics are written to `output/stereo-flanger/audio/`.

```sh
uv run --locked --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/stereo-flanger/audio/default.wav \
  --out-dir output/stereo-flanger/spectrograms
```

Open both Mel and log-STFT images. Keep identical settings when comparing
controller previews; these checks do not substitute for listening.

## Regression checks

```sh
uv run --extra dev pytest backend/tests/test_stereo_flanger.py
uv run --extra dev pytest backend/tests/test_api.py -k continuous_effect
npm --prefix frontend run build
docker build --target frontend-build .
```

Tests use the independent versioned fixture in
`backend/tests/fixtures/patches/stereo_flanger.patch.json`. They compare signed
feedback with an impulse oracle and modulation with an independent fractional
delay calculation, and verify dry bypass, channel isolation, silence, extremes,
decay, native round trips, saved controls and both CSD export modes.

## Validation on 2026-10-17

- 24 native Csound audio regressions and all 11 shared continuous-effect API
  cases passed, including the Flanger's three persistence/export cases.
- Thirteen 48 kHz stereo previews were finite and unclipped. The largest peak
  was 0.141022; final-second tail peaks were below 1.2e-14.
- Both Mel and log-STFT views were opened and inspected for defaults and all
  control endpoints. They showed static notches at zero depth, matching sweeps
  at zero phase, opposite sweeps at 180 degrees, and faster modulation at 5 Hz.
  Both channels decayed after the source ended. Subjective listening was not performed.
- Frontend production build, Docker `frontend-build`, Python lint, local Markdown
  links and whitespace checks passed. The user documentation PDF was rebuilt and
  the new Flanger pages were visually inspected.
