# Parametric Equalizer

[Native instrument](../Parametric_Equalizer.orch.instrument.json) ·
[Editable patch](parametric_equalizer.patch.json) ·
[Original three-band backup](original_3_band.patch.json) ·
[Controls and rationale](../../../documentation/instrument_design/parametric_equalizer.md)

Seven cascaded stereo peaking bands at **63, 160, 400, 1000, 2500, 6300, 16000 Hz**.
Each performance control is linear, **−20 to +20 dB**, default **0 dB**.
`ampdb(db)` supplies the linear filter gain. Nominal Q is 1.05;
`pareq.kq = 1.05 * ampdb(db / 2)` gives symmetric boost/cut shapes.
Continuous settings take effect after a rack restart.

The original graph is retained as evidence and a recovery source. Its parallel
sum produced 3× neutral amplitude. The new series routing fixes this error.
The original controller IDs remain assigned to the nearest new centers (63,
400, 1000 Hz); stored overrides require `20 * log10(amplitude)` conversion.
Native import alone does not migrate old performance overrides. The library
upgrade on 2026-10-16 converted the affected saved performances and current draft
through the API, after compile preflight, with local recovery snapshots under
`output/parametric-equalizer/library-backup/`. Reload open sessions after updating.

## Reproduce

From the repository root:

```sh
PYTHONPATH=. uv run python examples/instruments/parametric_equalizer/build.py
PYTHONPATH=. uv run python examples/instruments/parametric_equalizer/validate_audio.py \
  examples/instruments/Parametric_Equalizer.orch.instrument.json \
  --out-dir output/parametric-equalizer/audio
uv run --extra dev pytest backend/tests/test_parametric_equalizer.py
uv run --extra dev pytest backend/tests/test_api.py -k 'continuous_effect_native or continuous_effect_create_save'
npm --prefix frontend run build
docker build --target frontend-build .
```

The builder compiles before writing the example exports; it does not update the
library or regenerate fixtures. Tests use independent versioned snapshots under
`backend/tests/fixtures/patches/` and do not import developer examples.

The renderer exercises the real mixer insert compiler with sequential, gated
stereo tones, default controls, every band's endpoints, and all controls at both
extremes. It saves 48 kHz float WAVs, numerical metrics and measured frequency
responses. The input is deliberately quiet to leave boost headroom.

```sh
uv run --locked --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/parametric-equalizer/audio/default.wav \
  --out-dir output/parametric-equalizer/spectrograms --n-fft 8192
```

Repeat for `all_min.wav` and `all_max.wav`, keeping identical analysis settings,
then open both Mel and log-STFT images for every comparison.

## Validation on 2026-10-16

- 31 native Csound audio checks: the original 3× fault, new neutral unity,
  every band's center gain and full complex response against independent RBJ
  coefficients, silence, stereo isolation, reciprocal boosts/cuts, extremes and
  live/offline equivalence at `ksmps` 1, 32 and 64.
- Eight API cases across the shared continuous-effect suite cover native
  round trips, controls, saved performances and both CSD export modes.
- 17 audition renders contained only finite samples, with no samples over full
  scale at the chosen input level. Maximum peak: **0.188050**.
- Both Mel and log-STFT plots were opened for default, all-cut and all-boost
  auditions. They showed the seven expected tone steps, retained stereo timing
  and level differences, attenuation/boost, and decay to silence without
  unexpected persistent components. The all-cut Mel plot falls mostly below
  its fixed −100 dB display floor; the matching STFT retains the tone traces.
- Listening was not performed; numerical and spectral checks do not establish
  subjective sound quality.
- Frontend production build and Docker `frontend-build` passed. The instrument
  graph and seven linear dB controls were verified in the browser.
