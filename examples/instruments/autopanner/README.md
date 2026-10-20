# Autopanner

[Native instrument](../Autopanner.orch.instrument.json) ·
[Editable patch](autopanner.patch.json) ·
[Controls and routing](../../../documentation/instrument_design/autopanner.md)

A continuous stereo insert with **Tempo (BPM)**, **Beats per cycle**, and **Depth**.
It keeps channels separate and applies complementary sine modulation at audio
rate. Depth zero is exact bypass; full depth sweeps each channel's gain from zero
to one. The cycle starts centered, moving right. Tempo is entered manually;
restart the rack to apply any changed setting.

## Reproduce

Run from the repository root:

```sh
.venv/bin/python -m examples.instruments.autopanner.build
.venv/bin/python -m examples.instruments.autopanner.render
```

The builder validates and compiles before writing the raw graph and native
export. It does not modify the library or test fixture. Import the native file
to add it to a library.

The renderer feeds the same 24-second stereo harmonic source through the actual
mixer insert compiler, followed by one second of silence. The channels share a
chord and have distinct upper tones. Seven previews cover defaults and every
controller endpoint, with enough time for three cycles at the slowest individual
endpoint. WAVs and numerical metrics are saved to `output/autopanner/audio/`.

```sh
uv run --locked --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/autopanner/audio/default.wav --out-dir output/autopanner/spectrograms
```

Generate and open both Mel and log-STFT images after numerical validation.
Compare previews with identical analysis settings. These checks do not substitute
for listening.

## Regression checks

```sh
.venv/bin/python -m pytest backend/tests/test_autopanner.py -q
.venv/bin/python -m pytest backend/tests/test_api.py -k autopanner -q
npm --prefix frontend run build
docker build --target frontend-build .
```

Tests load the independent snapshot in
`backend/tests/fixtures/patches/autopanner.patch.json`, never the authoring files.
They compare samples to an independent mathematical oracle, covering cycle
duration, fractional beats, phase restart, channel isolation, complementary
gains, exact bypass, silence, bounds, live block sizes, native round trips,
saved instance settings and both CSD export modes.

## Validation — 2026-10-20

- All 25 native Csound DSP cases and all 29 shared continuous-effect API cases
  passed, including the three Autopanner persistence and export cases.
- Seven matched 48 kHz stereo previews were finite and unclipped. The highest
  peak was 0.214915; the final second was exactly silent in every preview.
- Both Mel and log-STFT images were opened and inspected for defaults and every
  controller endpoint. They show opposite channel fades, unchanged levels at
  Depth zero, slower cycles at long beat lengths, and faster modulation at short
  beat lengths. Subjective listening was not performed.
- The native instrument was saved to the local library and compiled through its
  API without diagnostics. Frontend production and Docker `frontend-build`
  builds passed; the shared drumkit build input remains intact.
- The graph and control screenshots come from a separate preview database.
  Integrated help covers EN/DE/FR/ES.
