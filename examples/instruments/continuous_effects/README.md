# Continuous stereo effects

- [Stereo Widener](../Stereo_Widener.orch.instrument.json): mid/side width with optional mono widening; four controllers.
- [Bit Crusher](../Bit_Crusher.orch.instrument.json): stereo bit-depth and sample-rate reduction; five controllers.
- [Harmonizer](../Harmonizer.orch.instrument.json): two fixed spectral harmony voices; six controllers.

[Controls, routing, and DSP](../../../documentation/instrument_design/continuous_effects.md)

All three instruments are continuous stereo inserts. Restart the rack after changing performance controllers. Harmonizer has a measured 32 ms processing delay at 48 kHz, including the dry path. Bit Crusher intentionally aliases; high Stereo Widener settings may raise channel peaks.

Reproduce from the repository root:

```bash
.venv/bin/python -m examples.instruments.continuous_effects.build
.venv/bin/python -m examples.instruments.continuous_effects.render
.venv/bin/python -m pytest backend/tests/test_continuous_effects.py -q
```

The builder compiles before writing raw graphs and native exports. Tests load separate snapshots from `backend/tests/fixtures/patches/`, never these examples. Auditions and metrics are saved to `output/continuous-effects/audio/`.

## Validation — 2026-10-17

- 33 DSP regression tests, 52 API/opcode/export tests, and 490 compiler/catalog tests passed.
- Frontend build, Docker frontend-build, and the full local app image build passed; the shared drumkit build input remains intact.
- All 34 effect auditions were finite and unclipped. Controller comparisons include active mono widening for Delay endpoints. Peak across the matched previews was 0.501188 or less, with tails below 1e-6 in the final half-second.
- Mel and log-STFT spectrograms were inspected for defaults and every controller endpoint. Expected quantization harmonics, aliasing, fixed harmony intervals, and stereo differences were present. At 2 bits the quiet probe quantizes to zero; raise Drive for quiet sources.
- Harmonizer latency was measured as 1536 samples at 48 kHz on both the native and Docker Csound runtimes. Dry is aligned to this measured value, rather than the manual example's 1024 samples.
- Subjective listening was not performed.
