# Tube Overdrive validation

Validated on 9 October 2026 using Csound 6.18 (double precision), 48 kHz.

- Saved and compiled in the local Orchestron library; diagnostics were empty.
- 14 patch/API regressions passed, plus 2 existing continuous-controller restart
  regressions. The patch tests cover the real mixer insert path, native import and
  export, stereo isolation, silence, release, controls, and both live (`ksmps=32`)
  and offline (`ksmps=1`) compilation with MIDI/score input modes.
- Scoped Ruff checks, local Markdown links, and `git diff --check` passed.
- Both `npm --prefix frontend run build` and
  `docker build --target frontend-build .` passed.

## Audio measurements

The reproducible renderer produced 45 float WAVs covering silence, sine, bass,
chords and bright synth material at the controls' defaults and endpoints. All
samples were finite. Default peak levels were 0.291 (sine), 0.389 (bass), 0.370
(chord) and 0.330 (bright). Silence remained below 1e-12; the unconnected right
channel remained below 1e-12 in the isolation test. Releases settled below 1e-8.

For the 250 Hz, 0.25-peak sine, using the settled one-second segment and harmonics
2–24, measured THD increased from **1.87% → 8.23% → 29.99%** at Drive
**0 → 12 → 24 dB**. Second harmonics were present, confirming asymmetry; the
settled signal mean stayed below 1e-7 in magnitude.

At Output +6 dB with other controls at defaults, bass and chord peaks reached
1.097 and 1.043. The float recordings preserve those excursions; this effect is
not an output limiter. Default Output retains headroom for these probes.

A separate 5 kHz, 0.5-peak sine probe measured a folded 3 kHz component at about
−126, −54 and −22 dBc for Drive 0, 12 and 24 dB. This confirms appreciable aliasing
at strong drive on high-frequency input. The graph intentionally retains the
planned non-oversampled 48 kHz design; reducing Tone cannot undo folded energy.

## Visual and listening checks

Both Mel and log-STFT spectrograms were opened and inspected for the sine and
bright-synth drive sweeps, bass and chord defaults, and the matched original/Tube
bright-synth comparison. Left/right plots agree. Harmonics increase with Drive,
output filtering reduces high-frequency energy, and gaps/tails settle to silence.
The strong-drive bright probe has dense intermodulation and alias products;
these checks do not establish an alias-free or subjectively pleasing sound.

RMS-matched original-then-Tube audio comparisons are in
`output/tube-overdrive/audio/` after running the renderer. Listening was not
performed during this validation. Use these previews to make the final tonal
judgment; numerical measurements and spectrograms do not replace listening.
