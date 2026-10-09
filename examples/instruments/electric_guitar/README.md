# E-Guitar — Warm Electric

An entirely synthesized, polyphonic picked electric guitar fitted to
`MyEGuitarWholePitchRange.m4a`. The fit uses 18 notes from **E2 to B5**. Each MIDI
note starts a pick and then decays to silence independently of key duration.
Holding the key introduces delayed pitch vibrato; MIDI note-off fades that
vibrato without muting the ringing string.

Import [E_Guitar.orch.instrument.json](../E_Guitar.orch.instrument.json), add it to
the Perform rack, and route **Stereo Output → Master**. The authoring script
updates the existing Orchestron library instrument. No samples, SoundFonts,
external plugins or new backend opcodes are required. Every source, envelope,
filter and formula remains editable in Instrument Design.

## String tone and decay

The voice has 24 sine partials. Their strengths, small inharmonic offsets, attack
times and decay rates vary with pitch using continuous interpolation between
the measured notes. Low notes emphasize the recording's strong second and third
harmonics; higher notes use their own measured balance. Partials approaching
Nyquist are faded out. Recorded tuning offsets are removed so MIDI pitches stay
in equal temperament.

The player confirmed an ascending progression through low E, A, D, G, B and high
E strings. Exact changes between strings were not recalled. Six approximate
register zones document that progression; the sound interpolates the measured
notes instead of imposing abrupt string switches. MIDI pitch alone cannot
identify an alternative string or fingering for the same note.

Each partial uses its own audio-rate `expsega` attack and exponential decay.
The unmuted portion of each recording estimates early decay. Abrupt hand-muted
endings are excluded. Unobserved late tails use a bounded exponential damping
stage rather than extrapolating a nearly flat short segment into indefinite
ringing. The **String decay**, **Tail length** and **Palm mute** controls change
this per-pick behavior; they do not depend on a later MIDI note-off.

**Decay at B4 (factor)** adds a smooth shortening with pitch. Low E2 and notes
below it keep the previous duration. At **B4 (MIDI 71)**—the open B3 string at
its 12th fret—the default **0.5** halves the existing decay time. Higher notes
shorten further. The factor follows `factor ^ (max(0, MIDI note - 40) / 31)`;
it scales each partial's early and late exponential time constants and the
silence deadline. Pick attack timing and vibrato timing are independent.

The control ranges from **0.25** (quarter time at B4) to **1.0** (previous decay
at every pitch). This is a pitch-based approximation: without string assignment,
the patch cannot distinguish an open string from the same note played fretted
on a lower string. It retains the fitted register differences underneath this
additional factor. The original recording fits remain unchanged as source data.

`xtratim` gives short MIDI notes enough processing time to finish the same natural
tail. A time-based gate reaches exact zero after the exponential tail has fallen
below −120 dB relative to its initial envelope. This deliberately replaces the
patch helper's default MIDI-sensitive `madsr`, as requested. No app-wide envelope
or MIDI behavior changes. Overlapping picks remain separate polyphonic voices.

Filtered noise models the pick, and gentle `tanh`, cabinet filtering, `pan2`
and a small stereo offset finish the voice. The patch retains `cpsmidi`, velocity
from `ampmidi` and the mapped Stereo Output.

From **B4 upward**, the first milliseconds use a separately fitted contact
model: a fast edge, a brief harmonic burst, and filtered pick noise. The wider
analysis bandwidth preserves the sharp rise that the original narrow partial
filters blurred. The correction interpolates across A-sharp4–B4; lower keys keep
their previous attack at the default setting. The ringing partial balance and
natural decay remain unchanged. [pick_tuning.json](pick_tuning.json) contains
the four high-register contact profiles, without recorded audio.

## Delayed vibrato

Vibrato begins only if the key is still held after **0.5 seconds**. Its depth
rises from zero to **±20 cents** over **0.8 seconds**, while its rate increases
from **4 to 6 Hz**. Depth then fades to zero over **1.2 seconds**, so the
vibrato finishes at about **2.5 seconds** even if the key remains held.

Releasing a key during vibrato smoothly returns pitch to the played note.
Keys released before the delay never develop vibrato during their natural tail.
Each polyphonic note has independent timing. The existing fitted attack,
partial balance and decay envelopes use the original pitch and are preserved.

The five `eg_vibrato_*` nodes use existing `linseg`, `release`, `lfo` and `portk`
opcodes. Edit `eg_vibrato_depth` for delay/rise/depth/fade, and
`eg_vibrato_rate` for the rate contour. The `portk` half-time is 4 ms and smooths
the pitch offset after note-off. No new opcodes or engine changes are required.

## Controls

| Per-instance control | Range | Default |
| --- | --- | --- |
| Pickup colour | 0.08–0.42 | 0.28 |
| Tone | 700–5000 Hz | 4200 Hz |
| Amp drive | 0–18 dB | 0 dB |
| String decay | 1–12, relative scale | 9 |
| Palm mute | 0–1 | 0 |
| Stereo width | 0–0.6 | 0.36 |
| Tail length | 0.04–0.8, relative scale | 0.16 |
| Output | −18–0 dB | −6 dB |
| Pick strength | 0–2 | 1 |
| Decay at B4 (factor) | 0.25–1 | 0.5 |

Settings apply at the next pick. Lower Pickup colour values brighten upper
partials. String decay scales early and late time constants; Tail length scales
the later damping. Palm mute shortens and darkens the whole pick. Width zero
produces identical centered channels. The eight existing controller IDs are
preserved; `eg_release` is now **Tail length**, not a MIDI note-off release.
The new `eg_pick` **Pick strength** control changes the brief contact sound:
0 removes the added pick noise and harmonic burst, 1 is the reference fit, and
2 emphasizes the pluck. It affects the next note and does not extend its decay.
The corrected high-register string attack remains active even at 0.
Existing performance overrides still apply; use patch defaults to hear the fit.

## Evidence and limits

[range_tuning.json](range_tuning.json) contains synthesis coefficients, not audio.
[validation/range_reference.json](validation/range_reference.json) records source
identity, note locations, measured frequencies, natural fit windows and partial
statistics. The analysis source and recording remain local.

The fit was checked against all 18 reference notes using per-note constant level
matching. Significant partials are compared by harmonic order so recorded tuning
errors do not contaminate the tone measurement. The median per-note harmonic
level error is about **1.11 dB** within the comparison window with the additional
pitch-dependent shortening enabled. This is a fit
measurement, not an independent listening or realism score.

The **104 range auditions** cover every semitone from D2 to E6, short versus
held-note attacks and amplitude decay, natural silence, velocity response, all ten controller extremes,
stereo output, rapid retriggers, six-note stress chords, parent control block
sizes 1/16/64, and live MIDI/MIDI-file/SCORE consistency. Pick strength was also
checked at 0/1/2 on B4, E5 and B5, plus a high-register chord at maximum strength.
The reference directly
supports E2–B5; pitches outside it use the nearest measured profile. Exact
string boundaries and the unseen ends of muted notes remain approximations.

Final plots include 42.67 ms harmonic-resolution windows, 5.33 ms attack
windows, and **2.67 ms contact windows with 0.25 ms frame spacing**, plus complete held-note tails. Mel and
log-STFT plots are opened and inspected after the final sound changes. Numerical
and visual checks are recorded separately from listening, which has not been
performed by the assistant. See [validation/audio.json](validation/audio.json)
and [validation/range_comparison.json](validation/range_comparison.json).
The fitted high-register contact coefficients are retained; the additional
decay scaling intentionally changes the sound's falloff against the recording. See
[validation/pick_comparison.json](validation/pick_comparison.json) for matched-gain
reference/previous/updated measurements; these are fit metrics, not listening scores.

[validation/vibrato.json](validation/vibrato.json) adds native checks for keys
released at 30/490/499/500 ms, held notes, release during vibrato, independent
polyphonic timing and a held stress chord. Pitch measured from the rendered
audio verifies increasing depth/rate and the return to steady pitch in host
MIDI, MIDI-file and SCORE modes. `validation/vibrato_pitch.png` shows the pitch
curves, alongside Mel and log-STFT images of both audio channels.

[validation/pitch_decay.json](validation/pitch_decay.json) checks the new control
at 0.25/0.5/1 across E2, E3, E4, B4, B5 and E6. Measured fundamental decay slopes
verify the requested time ratios. Factor 1 restores the prior sound and E2
remains unchanged at every setting. The new stable controller ID is
`eg_pitch_decay`; the existing nine controller IDs and defaults are preserved.

Local ignored `auditions/full_range_reference_then_synth.wav` alternates the
reference and synth at E2, G3, B4, E5, G-sharp5 and B5. These excerpts have equal
duration and end fades for comparison; fades are not part of the instrument.
`auditions/picked_note_held_to_silence.wav` retains the full untruncated decay.
`auditions/high_pick_reference_then_synth.wav` compares reference then updated
synth at B4, E5, G-sharp5 and B5. `auditions/pick_strength_0_1_2.wav` demonstrates
the three knob positions at B4, then B5, using identical gain for each position.
`auditions/delayed_vibrato.wav` plays B4 held for 0.49, 1 and 4 seconds, each
with four seconds of ringing audio and the same playback gain.
`auditions/pitch_decay_B4.wav` compares B4 with decay factors 1, 0.5 and 0.25,
using the same velocity and playback gain.
The earlier B4 reference, coefficients and analysis are retained as history;
the new whole-range recording governs this revision.

## Reproduce

Run from the repository root. Native rendering requires Csound. Analysis uses
the patch skill's optional audio dependencies.

```sh
.venv/bin/python examples/instruments/electric_guitar/build_guitar.py build
.venv/bin/python examples/instruments/electric_guitar/build_guitar.py preflight
.venv/bin/python examples/instruments/electric_guitar/validate_range.py
.venv/bin/python examples/instruments/electric_guitar/validate_vibrato.py render
.venv/bin/python examples/instruments/electric_guitar/validate_pitch_decay.py render
MPLCONFIGDIR=/tmp/orchestron-eg-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/electric_guitar/validate_pitch_decay.py analyze
MPLCONFIGDIR=/tmp/orchestron-eg-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/electric_guitar/validate_vibrato.py analyze
MPLCONFIGDIR=/tmp/orchestron-eg-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/electric_guitar/compare_range.py --reference /absolute/path/decoded-range-reference.wav
MPLCONFIGDIR=/tmp/orchestron-eg-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/electric_guitar/compare_pick.py
```

The comparison input must be the complete supplied recording decoded to 48 kHz
stereo WAV, without trimming or level changes. To repeat source measurements,
place it at `work/range_fit/reference.wav` under this directory and run
`measure_reference_range.py`, then `fit_range_profiles.py` with the audio Python
environment. These analysis scripts reproduce the measured profiles; synthesis
coefficients are versioned in `range_tuning.json`.
Run `fit_pick_profiles.py` in the same audio environment to reproduce the
high-register contact fit in `pick_tuning.json`. The pick comparison also uses
the prior-revision auditions retained locally in `work/pick_revision/before/`.
The pitch-decay compatibility check uses the previous published patch saved as
`work/pitch_decay/before.patch.json` before this revision.

Inspect the generated plots and record `spectrograms_inspected: true` in
`validation/audio.json`, `validation/range_comparison.json`,
`validation/pick_comparison.json`, `validation/vibrato.json`, and
`validation/pitch_decay.json`, then publish:

```sh
.venv/bin/python examples/instruments/electric_guitar/build_guitar.py publish
```

Publication compiles the exact validated graph through the backend, saves via
its API, reads it back and verifies native import preview. It reuses the recorded
library ID and rejects unexpected library graph edits. Before finishing an
instrument change, verify the shared drumkit input and run both
`npm --prefix frontend run build` and `docker build --target frontend-build .`.
No backend or frontend application behavior is changed.
