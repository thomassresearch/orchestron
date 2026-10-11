# Creation history

Each new candidate records its musical operations as they run. The audition
card's **How this melody was created** panel loads this history on demand.
Expand earlier candidates to follow the original-to-current chain; expand steps
for function names, resolved parameters, inputs and outputs. The JSON download
and `trace SESSION ID` return the same history.

Records include seeded starter construction, arvo calls, scale/register fitting,
rhythm projection, accompaniment, continuation and lock restoration. Starters
are seeded composition algorithms, not arvo calls. Environment versions describe
installed packages; only recorded calls establish which functions were used.

Sources have roles such as `pitch`, `rhythm` or an author-defined contribution.
Each includes the review and session revision used when the child was created.
Later reviews do not rewrite that record. Shared ancestors appear once. The
primary parent's locks govern built-in development; a rhythm source supplies
rhythm and dynamics, not additional lock constraints.

**Locks applied during creation** belong to the historical operation. **Saved
locks for future development** are the current candidate's review. Unsaved edits
are not applied locks. Ranges show one-based measure/beat positions plus exact
quarter-note coordinates. The end is excluded. Complete intersecting notes,
velocities and protected silence are recorded, along with generated notes
discarded during restoration. Continuation retains the whole original phrase;
it does not copy its locks onto the appended answer.

## Record custom scripts

Use `Recorder` while constructing custom material. Replace direct musical calls
with `recorder.call(...)`. It captures arguments, including defaults, before
execution, so in-place transforms cannot overwrite the recorded input. It records
the public function invoked, not every internal helper it calls.
Parameters show the non-stream arguments; input material includes all bound
arguments, including the complete input streams.

```python
from music21 import note, scale, stream
from orchestron_composition.trace import Recorder
from orchestron_composition.vendor.arvo import transformations

recorder = Recorder()
motif = stream.Stream([note.Note(p) for p in (66, 68, 71, 75)])
inverted = recorder.call(
    transformations.scalar_inversion,
    motif,
    motif.notes[0].pitch,
    scale.DorianScale("F#4"),
)
```

Record subsequent authored changes, such as applying a rhythm, replacing measures
or combining material. Pass actual before/after data, not just a description or
filename. Copy the input before modifying it.

```python
recorder.authored(
    "Project the inverted pitches onto the selected rhythm",
    inputs={"pitches": inverted, "rhythm": original_rhythm_events},
    output=revised_melody_events,
    parameters={"method": "cycle pitches over rhythmic slots"},
)
trace = recorder.finish(score, sources=[
    {"candidate_id": pitch_parent_id, "role": "pitch"},
    {"candidate_id": rhythm_parent_id, "role": "rhythm"},
])
```

Here `score` is the complete final canonical score and the other variables are
actual values from the authoring script. Save `trace` as JSON and import it:

```bash
uv run --locked orchestron_compose import-score SESSION score.json \
  --from ACCEPTED_PITCH_ID --trace trace.json
uv run --locked orchestron_compose trace SESSION CANDIDATE_ID
```

All declared local sources must exist and be Keep/Favourite. Import snapshots
their current reviews. `--from` remains the primary parent whose melody locks are
verified and inherited; other source roles do not alter lock enforcement. The
trace's final musical result must exactly match the imported score.

`call()` records executed operations. `authored()` marks an author-described edit.
Supplied traces are labelled as author-provided records: import validates their
structure, references and final material, but does not re-execute the operations
or certify authorship. Do not invent steps to fill gaps. Unrecorded imports are
allowed and show an incomplete-history notice. Partial custom records can include
a `gap` explanation.

For built-in operations in custom scripts, pass `trace=recorder` to `new_phrase`
or `develop` to record the whole pipeline. Arbitrary Python scripts are not
inspected automatically.

## Data and portability

Session and canonical score versions remain 1. Candidates gain an optional
`trace` object with its own version 1:

- `versions`: Python, music21, bundled arvo and Composition Creator versions.
- `sources`: candidate ID, contribution role and captured review/revision.
- `steps`: ordered records with `function`, `description`, `evidence`
  (`captured` or `declared`), `parameters`, `inputs` and `output`.
- `result`: final tempo, key, mode, meter, length and parts.
- Optional `gap` and imported portable `history`.

Music21 streams become explicit note/rest events: MIDI pitches, rational
quarter-note onsets/durations and velocity. Scales retain type and tonic;
enum arguments retain names and values. Inputs/outputs are snapshots.

`trace SESSION ID` and `GET /api/trace/ID` resolve a portable graph with `version`,
`roots` and an ancestor-first `nodes` list. Nodes include identity, title, meter,
sources and steps. UI session/review responses omit trace payloads. CLI `status`
stays compact; `show` includes the candidate's local record.

Export embeds this graph in `composition.json` under
`provenance.creation_history`, preserving earlier provenance fields. Its
`assembly` lists every candidate placement with exact onset/duration, including
repetitions; `result` captures the assembled score. Reimport preserves the graph
without the original session. Imported IDs are namespaced to avoid collisions.
Unrecorded edits to an exported score are flagged as a history gap.
`orchestron-score.json` and Performance Creator's score-v2 interface are unchanged:
creation history travels in the canonical composition, not a native performance.

Existing candidates are never regenerated to guess their past. Known parent
relationships remain visible; unavailable operations and inputs are marked.
Missing references and cycles produce explicit errors. Limits are 512 steps per
candidate, 512 candidates per resolved history, 128 ancestry levels, and the
existing 16 MiB JSON/session limit. Oversized records fail without replacing the
session. This is an explanation record, not a replay engine or per-note ancestry
browser.

## Verification

From the repository root:

```bash
uv run --locked --project integrations/skills/orchestron-composition-creator \
  pytest integrations/skills/orchestron-composition-creator/tests
node --test integrations/skills/orchestron-composition-creator/tests/audition.test.mjs
```

UI tests use the repository's existing frontend `jsdom` dependency; install the
frontend dependencies first. They are development checks, not runtime requirements
for the globally installed skill.
