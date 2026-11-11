# Stereo Auto Wah Wah

Continuous stereo `moogvcf` effect with RMS envelope following, selectable stereo
linking, musical cutoff quantization, and separate envelope/transition times.

- [Native instrument](../Stereo_Auto_Wah_Wah.orch.instrument.json)
- [Editable graph](stereo_auto_wah_wah.patch.json)
- [User guide and controls](../../../documentation/instrument_design/stereo_auto_wah_wah.md)

Run from the repository root:

```bash
.venv/bin/python -m examples.instruments.stereo_auto_wah_wah.build
.venv/bin/python -m examples.instruments.stereo_auto_wah_wah.save
.venv/bin/python -m examples.instruments.stereo_auto_wah_wah.render
.venv/bin/python -m pytest backend/tests/test_stereo_auto_wah_wah.py -q
```

The builder compiles before writing the exports. The save command preflights a
temporary backend preview session, then creates the library entry or reuses an
identical one. It preserves a different instrument with the same name. Use
`--api-url` to select another backend. Tests use an independent committed fixture,
never this builder or the developer exports.

Auditions and numerical metrics go to `output/stereo-auto-wah-wah/`. All scenarios
use the same four-second stereo harmonic source and include a silent tail.
They cover continuous mode, 1/7/12/24-semitone steps, independent tracking and
each controller's endpoints. Use the patch skill's `render_spectrograms.py` to
generate and open both Mel and log-STFT images. Report numerical validation,
visual inspection and subjective listening separately.

## Signal contract

Each channel has one native `rms` detector with `ihp = 1000 / (2π × integration_ms)`.
Linked level is the square root of mean channel power; a protected `dbamp`/`ampdb`
conversion implements the square root using existing formula functions. A
1e-24 power floor is added and its 1e-12 amplitude removed, preserving silence.
Sensitivity scales that level; clipping to 0–1 sets a 0–`12 × range` semitone offset.
Positive quantization rounds to the nearest interval, then caps at the sweep's
upper endpoint. Zero quantization bypasses rounding without division by zero.

`portk` smooths the capped semitone target with the selected half-time. `k_to_a`
interpolates it before conversion to Hz, so the filter cutoff does not jump at
control-block boundaries. Both filters start at Base cutoff. Frequency is clamped
to 20–`min(18000, 0.4 × sr)` Hz. Two independent `moogvcf` states use the shared
resonance setting, `iscale=1` and cleared initialization. Stable `saw_` controller
IDs are part of saved per-instance overrides.

## Validation (2026-11-11)

- All 28 DSP cases passed across MIDI/SCORE and control blocks of 1, 32 and 64
  samples; all three new API round-trip/export cases and 62 existing effect
  regressions passed. The frequency assertion allows Csound 6.18's approximately
  1e-7 relative `ampdb` conversion error.
- All 22 auditions were finite and below full scale; maximum peak was 0.244871.
  Both Mel and log-STFT views were inspected for every audition, using matching
  48 kHz, FFT 2048, hop 256 and fixed -100–0 dB display settings. The plots show
  the expected continuous/stepped sweeps, stereo behavior and decaying tails.
  Subjective listening was not performed.
- Backend preview and Instrument Design compilation passed, and the instrument
  was saved through the API. Builder, native/raw exports and fixture match.
- Python lint, native frontend build, Docker frontend build, local documentation
  links and whitespace checks passed. The required raw drumkit input remains.
- The English manual was rebuilt (215 pages). The new chapter on pages 190–191,
  its graph screenshot, Standard Effects listing and table-of-contents entry were
  checked in the rendered PDF.
