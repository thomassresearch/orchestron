# Score contract and Performance Creator handoff

## Working score

`composition.json` uses schema `orchestron.composition`, version **1**. It is an
explicit note score; silence comes from gaps and `length_qn`, including trailing
rests. Every onset and duration is an exact rational **quarter-note** string.
For example, `1/3` is an eighth-note triplet, independently of the local meter.
Use MIDI pitches 0..127 and attack velocities 1..127. Programs are zero-based
General MIDI preview programs; channels are 1-based and later identify Orchestron
instrument bindings. Channel 10 follows the renderer's percussion convention.

```json
{
  "schema": "orchestron.composition",
  "version": 1,
  "title": "Modal phrase",
  "tempo": 108,
  "key": "D",
  "mode": "dorian",
  "meter": [4, 4],
  "length_qn": "4",
  "parts": [{
    "id": "lead", "name": "Melody", "channel": 1, "program": 0,
    "events": [
      {"pitch_midi": 62, "onset_qn": "0", "duration_qn": "1/3", "velocity": 94},
      {"pitch_midi": 65, "onset_qn": "2/3", "duration_qn": "2/3", "velocity": 76},
      {"pitch_midi": 62, "onset_qn": "2", "duration_qn": "1", "velocity": 82}
    ]
  }]
}
```

Part IDs are unique. Simultaneous distinct pitches and independently sustained
voices are allowed. Same-pitch overlaps on the same channel are rejected, since
MIDI retrigger ownership can change their duration. Pitch spelling is derived
for the target editor; the canonical pitch remains numeric. Optional `sections`
and export `provenance` preserve phrase placement and accepted candidate recipes.
Import custom scores using `import-score SESSION FILE`; they become pending
candidates and need a listening decision before export/development.
For a revision of an accepted idea, include `--from ACCEPTED_ID`; this records
lineage, inherits melody locks, and rejects changes to locked notes or silence.
Add `--trace FILE` with the creation record produced by the tracing helper for
custom scripts. See [creation history](creation_history.md) for its schema,
source roles and validation. Export's `provenance.creation_history` carries the
complete recorded ancestry, repeated phrase placements and final material; it
survives canonical-score reimport into a different session. This metadata does
not change score-spec v2 or add history to native performance bundles.

Limits: fixed integer tempo 30..300, seven diatonic modes, meter numerator 2..7
and denominator 4/8, 1..16 parts, 8192 events, length at most 1024 quarter notes.
Preview audio is limited to ten minutes. Microtones, changing tempo/meter, pedal
and arbitrary controller envelopes are not part of this first score schema.

## Exact Orchestron conversion

The exporter produces **score-spec v2**. The updated Performance Creator reads
v1 and v2. Its v2 event checks reject overlap, out-of-pad durations and unknown
event fields rather than dropping musical information. The performance
configuration remains v19; these are independent version numbers.

Conversion chooses an exact local grid from 1, 2, 3, 4, 6 or 8 subdivisions.
Quarter-note times convert using `4 / meter_denominator` quarter notes per local
beat. Independent voices become separate melodic tracks on the part's channel,
using normal root-note/HOLD cells; no arbitrary pitch arrays are added to the
GUI's persisted model. Instrument mapping therefore stays by channel.

The exporter splits phrases at whole local beats without cutting a sustained
note, within 16 local beats and 128 steps per pad. Identical pads are reused.
More than eight distinct pads create additional tracks with leading/trailing
rests so every track retains the same song position and finite closing time.
The exporter caps output at 64 tracks and 256 pad/rest tokens per track.

Unrepresentable rhythms, a note longer than available pad capacity, fractional
final local beats and capacity overruns fail explicitly. Revise the score after
explaining the limitation; do not quantize or retrigger a held note silently.
The MIDI previews use the same exact symbolic note events. Regression tests
compare the exported score after the real Performance Creator importer and
runtime conversion with the canonical notes, onsets, durations and velocities.

## Realise the song

Give Performance Creator the absolute path to `orchestron-score.json` and the
channel-to-part mapping from `composition.json`. Follow that skill to check
backend health, discover/create suitable instruments, start a staged performance,
bind channels and connect outputs to Master. Then, from its directory:

```bash
uv run --locked orchestron_cli --json edit apply-score /absolute/path/orchestron-score.json
uv run --locked orchestron_cli --json edit validate
uv run --locked orchestron_cli --json edit commit
```

Apply once: this command appends tracks. Use a new staged draft when importing
a replacement whole song. Arrange instrument selection/routing before validation.
MIDI programs describe preview timbres only; they do not identify Orchestron
patches. The composition score is not imported with the app's native bundle
Import button. Performance Creator creates that full performance separately.
