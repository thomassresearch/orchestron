# Clip song workflow and command cookbook

Use `orchestron_cli --json` before the command, with an external `--session-file`.
The following command tails assume the skill's locked environment. `edit begin`
defaults to legacy compatibility; always choose `--arranger clips` for a new song.

```bash
orchestron_cli --json capabilities --offline
orchestron_cli --json edit begin --new --arranger clips --offline --name "Song sketch"
orchestron_cli --json edit schema
orchestron_cli --json edit apply-song --file /work/song.json --mode create --offline
orchestron_cli --json edit inspect
orchestron_cli --json edit inspect --view clips --lane bass
orchestron_cli --json edit inspect --view tree --lane bass --clip verse
orchestron_cli --json edit validate --offline
```

Copy the bundled [minimal song](../assets/minimal-song.json) or [128-bar song](../assets/complete-song.json)
to the music directory. Both run without patch UUIDs. Discover instruments with
`patches list`, add them using `edit add-instrument --patch NAME --channel N`,
and use `edit instruments list` for stable binding IDs and ports. Binding a patch
does not replace notes. Preserve accepted composition notes, dynamics and timing.
For a Composition Creator v1/v2 document use `edit adapt-score --file PATH --id
accepted-phrase` in a clip session. Retrying the same handoff is a no-op; changing
it under the same identity fails. Legacy `edit apply-score PATH` still appends to
legacy sessions and is not the song schema.

Create a small library of named musical definitions; place references in fixed
clip windows. `repeat` sets a compact Loop window. Groups join patterns on one
lane; supergroups join groups. A section is a coordinated range of lanes, not a
cross-lane group. Reuse a definition for repeated music, add a transposition plan
for pitch changes, and fork only for changed notes, rhythm, dynamics or sound controls.
Clip libraries are independent of the eight legacy pads.

The new `edit lanes|patterns|groups|clips ...` commands and `edit apply-song`
share the same operations. Use a song document for whole-song creation and a
small operation file for a focused edit. See [schema and time](song_schema.md),
[editing and history](song_editing.md), and [instrument automation](song_automation.md).

## Follow-up edits

Take a `target` object from `edit inspect --view tree --lane bass --clip chorus`.
Keep its `revision` and `fingerprint`; stale targets intentionally fail. Write it
inside `/work/transpose.json` with the operation fields:

```json
{"target":{"laneId":"bass","clipId":"chorus","path":["RETURNED_CHILD_ID"],"pass":0},
 "scope":"placement","offset":{"diatonicSteps":0,"chromaticSemitones":12}}
```

Run `edit transpose put --file /work/transpose.json`. This creates zero musical
patterns. `scope` is `shared` (definition profile), `parent` (child reference), or
`placement` (path inside this clip). Plans add along the hierarchy. An indexed
entry replaces that plan's base at that repetition; it does not accumulate.
Use `action: zero` with `index` for an explicit zero, `action: inherit` to remove
that override, or `reset-component`/`reset-plan`. Fixed repetition references
retain their original indexes after grouping. Out-of-range MIDI pitches are omitted.

For one local fill, save the returned target to `/work/target.json`, then write
`{"music":{"hits":"36@0:115 38@4:95 38@6:65"}}` for a drummer occurrence, or
`{"music":{"steps":"s0=C3/2s s4=G3/2s"}}` for a melodic occurrence:

```bash
orchestron_cli --json edit patterns edit --target /work/target.json --scope local --file /work/fill.json --dry-run
orchestron_cli --json edit patterns edit --target /work/target.json --scope local --file /work/fill.json
orchestron_cli --json edit undo
orchestron_cli --json edit redo
```

The result returns the new target after splitting/forking. Inspect again before
another operation. `--scope shared` changes the definition for every use. Use
`patterns cells` for selected timing, velocities, ratchets or strums without
replacing other stored cells; see [editing](song_editing.md).

For a collision, read `error.data.blockingClipId`, inspect clips on that lane,
then move or trim the proposed window. Rejected operations do not change staged
bytes. Repeat the same `apply-song` document to verify `state.changed: false`.

## Saved and audible state

`edit validate --offline` checks authored music only. Online `edit validate`
adds backend authored/routing validation and is read-only; neither prepares audio.
Run `edit commit` after online validation. Updating a saved clip performance
requires the backend's advertised conditional-write capability. A stale save
fails with HTTP 409: reopen the saved performance and reapply intended edits.
The CLI cannot see or merge unsaved GUI editor drafts.

`edit create-runtime --start` builds a matching runtime. `edit push-runtime`
prepares changes without a transport reset; rack/route changes require
`edit rebuild-runtime`. `edit transport play|stop|status` controls the arranger;
`seek --step N` uses transport steps of 2520 ticks. A CLI-started engine is
stopped by its matching stop command; an already-running engine remains running.

`edit audition start --target /work/target.json --scope full|cropped` previews
the selected musical context. Push the intended draft first: audition rejects a
runtime whose music differs, preventing replacement of another client's edits.
`edit audition status` reports backend state and `edit audition stop` releases
the temporary layer. Preview schedules never enter the performance file.
An HTTP acknowledgment is not proof that sound has reached the speaker.

`edit export --mode native|midi|score --output /work/new-file.orch.zip` exports the
staged authored music through the backend. MIDI and SCORE modes create CSD
archives with the existing render instructions; they do not render audio.
Their requests omit clip and legacy arranger Undo/Redo history to preserve the
request size budget for music. Staged drafts and native exports retain history.
Existing output files are preserved. Export does not commit or include auditions.

For a saved revision, run `edit begin --performance NAME_OR_ID`, inspect, make a
scoped edit, validate and commit. To migrate a legacy draft, first run
`edit migrate --dry-run`, then `edit migrate --recovery /work/original.json`.
Manual sources, live arpeggiators and multiple keyboards need explicit resolution;
failed migration preserves the original. No saved performance migrates automatically.
