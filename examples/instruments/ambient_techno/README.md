# Ambient Techno authoring

See the [instrument guide](../../../documentation/instrument_design/ambient_techno.md)
for the controller maps, ranges, sound recipes and rack routing.

From the repository root:

```bash
.venv/bin/python -m examples.instruments.ambient_techno.build
.venv/bin/python -m examples.instruments.ambient_techno.render
.venv/bin/python -m examples.instruments.ambient_techno.save
```

`build` uses the Patch Creator's base graph and invariant validation, extends it
with supported opcodes and input formulas, and compile-checks both patches.
It writes raw patches here and native JSON exports to the parent folder.
`save` compile-preflights temporary preview sessions before adding instruments
through the API. It preserves an existing instrument if the same name has a
different graph. Override the default API with `--api-url`.

`render` writes 48 kHz float WAV auditions and numerical metrics to
`output/ambient-techno/`. It preserves gain across comparison renders. The
default phrases, five sound recipes, eight-note chord, and CC0/64/127 comparisons
include full note-off tails.

The graph uses stable controller IDs prefixed `ars_` (sub) and `awc_` (cloud).
Tables are normalized GEN10 waveforms generated through `ftgenonce`.
Pitch-dependent binary harmonic masks reuse a finite set of table variants.
The four wave oscillators within each voice share a starting phase and pitch;
adjacent linear weights sum to one. Slow deterministic oscillators with different
rate ratios drive independent scanning and drift. The cloud has 20 wavetable
oscillators across its five voices; no per-note reverb is allocated.

Fixture updates are deliberate: `build --fixtures` writes independent snapshots
under `backend/tests/fixtures/patches`. Tests load those snapshots and never read
the examples or import this generator:

```bash
.venv/bin/python -m pytest backend/tests/test_ambient_techno.py -q
.venv/bin/python -m pytest backend/tests/test_api.py -q -k ambient_techno
```

After numerical validation, generate and open both spectrograms for the final
auditions using the Patch Creator's `render_spectrograms.py` utility. Fixed
analysis settings and power scales allow meaningful comparisons.

```bash
uv run --locked --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/ambient-techno/rounded_sub.wav --out-dir output/ambient-techno/spectrograms --n-fft 8192
```

Repeat for each WAV, retaining the same analysis settings.

## Validation recorded on 2026-10-20

- 29 native Csound DSP cases and four API cases passed. These cover control
  endpoints and smoothing, channel isolation, CC20–23 independence, pre-note
  automation, same-pitch retriggers, overlap and release modulation, tuning,
  velocity, mono compatibility, combined extremes, saved overrides, and native,
  MIDI-file and SCORE exports.
- Host MIDI was injected through the Csound worker's timestamped scheduler at
  `ksmps=32` and `64`; offline MIDI/SCORE runs used `ksmps=1`. No external MIDI
  hardware was exercised.
- Fourteen 48 kHz stereo float WAVs were rendered with finite samples and no
  full-scale overs. The default sub phrase peaks at −26.9 dBFS, the default
  four-note cloud at −22.3 dBFS, and the eight-note cloud at −16.8 dBFS.
- Both Mel and log-STFT images for all fourteen auditions were opened and
  inspected after the final sound change, using FFT 8192, hop 256, 128 Mel bands
  and fixed −100–0 dB spectral color limits. The sub retains a stable fundamental;
  Warmth adds upper harmonics. Cloud recipes and CC values change the harmonic
  balance, with gradual movement and complete tails in both channels.
- Frontend and Docker `frontend-build` builds passed, as did Ruff and the diff
  whitespace check. The guide's controls were captured in the running UI.
- Validation was numerical and visual. Actual listening was not performed.
