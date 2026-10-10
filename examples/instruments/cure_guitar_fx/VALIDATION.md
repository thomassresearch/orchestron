# Cure Guitar FX validation

Validated on 10 October 2026 with Csound 6.18, double precision, 48 kHz.

## Persistence and build checks

- Created **Cure Guitar FX** in the local library with compile preflight and no
  diagnostics; patch ID `6e334908-1dab-444e-8d3d-13dbf50990be`.
- Read back the saved Continuous type, always-on flag, graph, and 11 controls.
- Native bundle serialization/deserialization preserved the complete graph,
  stereo interface, controller definitions and Continuous type.
- Scoped Ruff, local Markdown links, and `git diff --check` passed.
- The shared analog drumkit build input remains present.
- `npm --prefix frontend run build` passed.
- `docker build --target frontend-build .` passed (cached frontend layers).

## Audio measurements

Native Csound rendered the effect through the actual stereo mixer insert path.
Twenty-six 50-second chord auditions covered defaults, bypass, each control's
minimum and maximum, and combined minima/maxima. Every render was finite and
below full scale. The largest peak was **0.449281** in dry bypass; the default
effect peak was **0.225397**. The largest final-second tail peak was **5.85e-7**
at the longest delay/high-feedback combination.

Every controller changed the rendered signal: endpoint difference relative to
the louder endpoint's signal norm ranged from **0.167 to 1.551**. This measures
signal differences, not perceived loudness or musical quality.

Dry bypass nulled against a plain inlet-to-outlet reference within **1.49e-8**,
consistent with retaining the audition as float32 WAV. Silence produced zero,
and left-only input produced zero on the right. A short burst first echoed at
350 ms; its first three echo peaks were **0.25, 0.0875, 0.030625**, confirming
35% feedback. Both MIDI and SCORE compiler modes rendered at `ksmps=1`; live
checks used `ksmps=32`.

The existing **E-Guitar — Warm Electric** supplied an original arpeggio/chord/
retrigger passage. Dry and processed peaks were **0.786059** and **0.291515**;
neither clipped, and both settled to silence. All results and controller settings
are retained in `output/cure-guitar-fx/metrics.json` after validation. The dry/FX
comparison uses the same −3 dB output gain on both passages, not independent
loudness normalization.

## Visual inspection and listening

Opened and inspected both Mel and logarithmic STFT spectrograms for
`guitar_effect.wav` and `control_comparison.wav`, at FFT 4096 / hop 256 with a
fixed −100 to 0 dB spectral power scale. Both stereo channels contain the
expected notes, modulation and decaying echoes. The guitar tail fades before
the end of its 22-second recording. The extreme modulation setting shows the
expected large pitch sweep. The comparison montage intentionally contains only
the first five seconds of each selected 50-second render; full tail checks use
the complete recordings.

Listening was **not performed**. These numerical and visual checks do not claim
an exact match to a Cure recording. High feedback/wet settings can still amplify
other inputs; the output stage is not a limiter.
