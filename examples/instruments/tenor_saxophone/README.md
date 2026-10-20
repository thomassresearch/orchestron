# Expressive Tenor Saxophone

[Tenor Saxophone — Expressive Legato](Tenor_Saxophone_Expressive_Legato.orch.instrument.json)
is an editable, sample-free Melody instrument built around Csound's STK reed model.
The balanced acoustic revision combines a stronger upper-harmonic spectrum with
velocity-sensitive reed stiffness and breath pressure. Its four controls and
playing gestures retain their original ranges and defaults.
Import the native file in **Instrument Design → Import**, or select its name from
the local library after publishing. In Perform, route **Stereo Output → Master**.
The instrument is dry and centered, with equal left and right channels; add a
shared room effect in the performance if desired.

The intended register is **concert A♭2–E5 (MIDI 44–76)**. There is no automatic
B♭ tenor transposition. Notes outside this range are accepted but not calibrated.

## Playing

Overlapping and touching notes share one breath. The newest held note takes
priority; releasing it returns to the previous note **and its velocity**. Pitch
changes without a portamento slide. Gaps restart the tongued attack, including
when the preceding release is still fading. Repeating a connected pitch changes
its velocity without another tongue attack.

| MIDI velocity | Response |
| --- | --- |
| 1–95 | Soft, breathy through full-bodied normal playing |
| 96–114 | Increasing growl, reed edge and breath noise |
| 115–127 | Increasing sustained overblown octave squeal; strongest at 127 |

Velocity changes during a legato phrase use Orchestron's 10 ms smoothing
half-time. A hard connected note can therefore provoke a squeal; a softer note
settles back into the normal register. Velocity changes pressure, reed stiffness,
noise, level, filtering and the overblown register blend. Its timbral response is
nonlinear: the transition into overblowing need not get louder at every value.
The tongue contour rises in 10–35 ms depending on the phrase's initial velocity,
settles over 80 ms, and uses a 100 ms note-off envelope.

## Performance controls

All four knobs range from **0 to 1**. They are read at the start of a phrase;
connected notes retain that phrase's knob settings. Insert a gap to hear a new
setting. These are per-instance settings, not MIDI CC controls.

| Label | Stable node ID | Default | Effect |
| --- | --- | --- | --- |
| Tone | `sax_tone` | 0.5 | Darker to brighter output filtering |
| Growl | `sax_growl` | 0.35 | High-velocity throat modulation and reed/noise edge; 0 disables this added growl |
| Squeal | `sax_squeal` | 0.65 | Overblown register blend above velocity 114; 0 disables it |
| Vibrato | `sax_vibrato` | 0.2 | Delayed 5.6 Hz pitch/breath vibrato, up to ±15 cents (±3 cents by default) |

**DE:** Monophones Tenorsaxofon in klingender Tonhöhe. Verbundene Noten teilen
einen Atemzug; die zuletzt gedrückte Taste hat Vorrang. Velocity 96–114 fügt
Growl hinzu, 115–127 zunehmend überblasenes Quietschen. Eine Lücke beginnt eine
neue Artikulation. Stereo Output mit Master verbinden.

**FR :** Saxophone ténor monophonique en hauteur réelle. Les notes liées
partagent un souffle ; la dernière note jouée est prioritaire. Vélocité 96–114 :
son rauque croissant ; 115–127 : suraigu soufflé croissant. Une interruption
relance l'articulation. Relier Stereo Output à Master.

**ES:** Saxofón tenor monofónico en tono real. Las notas ligadas comparten una
respiración; la última nota tiene prioridad. Velocidad 96–114: rugido creciente;
115–127: chillido sobreagudo creciente. Una pausa reinicia la articulación.
Conectar Stereo Output a Master.

## Listening previews

- [Before tuning, level matched](auditions/comparison_before.wav) and
  [after tuning, level matched](auditions/comparison_after.wav) play the same
  7.2-second phrase. Each complete performance receives one constant gain so
  both previews have equal RMS while preserving their internal dynamics.
  [Before, original level](auditions/comparison_before_raw.wav) and
  [after, original level](auditions/comparison_after_raw.wav) retain the measured levels.
- [Velocity and overblowing](auditions/velocity.wav): A♭2, C4 and E5, each at
  velocities 32, 64, 96, 108, 115, 120 and 127. Notes start at 0.15 s, spaced 0.75 s.
- [Legato phrase](auditions/legato_host.wav): connected notes, a hard accent,
  a wide leap with held-note fallback, then a repeated-pitch velocity change.
- [Register check](auditions/registers.wav): MIDI 44, 48, 55, 60, 67, 72 and 76.
- [Control comparisons](auditions/controls.wav): nine 2.5-second segments:
  default, Tone min/max, Growl min/max, Squeal min/max, Vibrato min/max.
  Each segment plays connected C4 notes at velocities 96, 127 and 64.

## Synthesis and reproduction

[build_saxophone.py](build_saxophone.py) constructs the full graph using the
patch-creator's graph builder and invariant validation. The high-level template
is only the MIDI/envelope/output scaffold; the saved graph uses an
[STKSaxofony](https://csound.com/docs/manual/STKSaxofony.html) physical reed source,
not the scaffold oscillator. The source needs **Csound's STK plugin** and
`RAWWAVE_PATH` pointing to its installed rawwave directory. Orchestron's Docker
image already includes both. The STK sinewave table is used for modulation;
there are no saxophone recordings or bundled samples.

STKSaxofony initializes its pitch once per phrase. Two cubic delay readouts,
with complementary windows one bore period apart, transpose its continuous
output to the current legato pitch. A second readout of the **same reed** shifts
it one octave up for the velocity-controlled squeal blend. Pressure and aperture
also change with that blend. This is a modeled overblown sound, not an additional
independently played note. The model's upper-register tuning is compensated
before synthesis. Single-layer, peak-normalized resonances at **850 Hz / 600 Hz
bandwidth** and **2,400 Hz / 1,200 Hz bandwidth** shape the body and presence after
transposition. Their input mix is `0.8 × reed + 0.3 × body + 1.5 × presence`;
the final high-pass removes DC and sub-bass.

The reed-model blow-position value is **46** (previously 50), with reed aperture
25 and velocity-sensitive stiffness `116 − 10 × velocity`. Breath pressure is
`86 + 6 × velocity` before the phrase and tongue envelopes, plus the small existing
growl/squeal adjustments. Here velocity is the MIDI value divided by 128.
More extreme blow positions were rejected because they weakened the fundamental
or jumped registers after phrase restarts. Lower breath-noise levels and a lower
output gain balance the stronger excitation and presence response. The original
10–35 ms tongue attack and 100 ms release remain intact.

The [comparison measurements](validation/audio.json) cover 21 normal notes across
seven pitches and three velocities. Harmonics 3–10 are measured separately from
inter-harmonic noise, so increased gain or added hiss cannot count as richer
harmonics. These measurements describe spectral change, not perceived realism.

The readout introduces up to two source periods of delay (about 19 ms at A♭2).
Wide connected leaps can color the timbre. The resulting sound is a synthesized
tenor approximation; use the previews to judge its character.

From the repository root, with `RAWWAVE_PATH` set for the local Csound installation:

```sh
.venv/bin/python examples/instruments/tenor_saxophone/build_saxophone.py build
.venv/bin/python examples/instruments/tenor_saxophone/build_saxophone.py preflight
.venv/bin/python -m pytest backend/tests/test_tenor_saxophone.py backend/tests/test_midi_legato.py -q
.venv/bin/python examples/instruments/tenor_saxophone/validate_audio.py render
MPLCONFIGDIR=/tmp/orchestron-sax-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/tenor_saxophone/validate_audio.py analyze
```

Open all eight generated Mel/log-STFT images, inspect them against their MIDI
timings, plus the four before/after comparison images, then record
`spectrograms_inspected: true` in `validation/audio.json`.
Publish with `.venv/bin/python examples/instruments/tenor_saxophone/build_saxophone.py publish`.
The publisher requires the validated graph hash, runs compile preflight, saves
through the API, reads back the result and checks a native import preview. Its
manifest prevents later runs from replacing unexpected library edits. Rendering
intermediates default to `/tmp/orchestron-tenor-saxophone`; use `--work-dir` to
change that location. Tests use a separate versioned fixture and never load this
example folder.

The [raw graph](Tenor_Saxophone_Expressive_Legato.patch.json),
[audio measurements](validation/audio.json) and
[library verification](validation/library.json) accompany the native export.
The [original patch](baseline/original.patch.json) and
[original validation report](baseline/original_validation.json) remain available
for reproduction; the updated tests use separate versioned snapshots of both sounds.
Listening was not performed by the agent; numerical measurements and inspected
spectrograms do not establish subjective realism.
