# Piano — From Bass to Bells

A short solo for [Piano — prepiano](../instruments/Piano_prepiano.md), written for
two hands. It moves from a bass melody through the middle register to sustained
treble notes, with quiet chords underneath.

- [Native performance](Piano_From_Bass_to_Bells.orch.json), including the updated piano instrument.
- [Editable score specification](Piano_From_Bass_to_Bells.score.json) for the Performance Creator CLI.

Load **Piano — From Bass to Bells** from the performance library, or use
**Perform → Import** with the native performance file. Start the arranger at the
beginning. The score JSON is a CLI authoring file, not a native import file.

## Music and listening guide

The piece has 16 bars in C major, 4/4, at 76 BPM. Playing lasts 50.5 seconds;
four beats of closing silence make the finite arrangement 53.7 seconds. The
Csound export adds its render tail, producing a 55.7-second WAV. Playback does
not loop.

| Time | Bars | Listen for |
| --- | --- | --- |
| 0:00–0:13 | 1–4 | Left-hand bass melody against soft, held right-hand triads. |
| 0:13–0:25 | 5–8 | Right-hand melody; the left hand alternates bass notes and compact chords. |
| 0:25–0:38 | 9–12 | The melody climbs into the treble; shorter accompaniment leaves room for its decay. |
| 0:38–0:51 | 13–16 | C7 peaks, a descending answer, and the final held chord at 0:47.4. |

There are 110 notes from C2 to C7 (MIDI 36–96), with velocities 49–101. Melody
attacks receive more weight than accompaniment; phrase endings soften. Small
timing offsets and roughly 18 ms chord spreads keep attacks from being identical.
The final C7 remains held for about 3.13 seconds before note-off.

The six sequencers represent three editable voices per hand, all on the same
piano and MIDI channel 1. They are not six independent players. Each hand holds
at most three keys: the widest held span is an octave in the left hand and a
major sixth in the right. Bass notes release before the left hand moves to its
chords, leaving at least 194 ms for those leaps. The hands never need to sustain
a distant bass note while playing another chord with the same hand.

## Sound and controls

The included instrument uses pitch-tracked `prepiano` hammer excitation and
[reference-guided treble damping](../instruments/Piano_prepiano.md#acoustic-reference-comparison).
High notes lose their prominent ring sooner, even while their keys remain held.
All ten existing performance controls remain available at their
defaults, including String decay at 4 seconds and Damper release at 0.25 seconds.
The notes' held durations expose the physical model's decay; no pedal automation,
reverb, delay, rubber or rattle preparations are used.

Stereo Output routes to Master. The piano strip is +12 dB and Master is +8 dB
for a clear listening level. Those mixer gains are saved in the performance;
the WAV preview has no additional normalization or compression.

## Reproduction and validation

To recreate the arrangement with the Performance Creator CLI, start a new draft
at 76 BPM, bind **Piano — prepiano** to channel 1, route its `left` and `right`
ports to the corresponding `$master` ports, and apply the score file once.
Set the mixer levels above, validate, then commit. Applying a score appends its
tracks, so begin from an empty arrangement.

For audio, load the native performance and export a Csound project in MIDI or
SCORE mode. Extract the archive and run `csound Piano_From_Bass_to_Bells.csd`
from its directory. Both exports retain the saved piano, controls, mixer levels,
timing offsets and MIDI velocities.

Validation used the saved performance exported by the running application:

- Every authored attack was matched against the exported MIDI, including pitch,
  velocity and timing; all 110 notes release, with no overlapping same-pitch retriggers.
- Held-note counts, hand spans and bass-to-chord movement gaps were checked against
  the actual exported note-on/off times.
- MIDI and SCORE exports rendered at 48 kHz stereo with no Csound errors or
  clipping. Peaks after the treble-damping revision were −7.81 and −7.30 dBFS respectively.
- Mel and log-frequency STFT plots were inspected for the register progression,
  exposed treble decays and clean ending.
- The required frontend build and Docker `frontend-build` target passed.

Local authoring scripts, audit reports, both Csound archives, spectrograms and the
PCM16 listening preview are generated under `output/prepiano/register_study/`.
