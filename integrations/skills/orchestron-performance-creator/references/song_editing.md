# Discovery, transactions, structure and history

Use `edit inspect` for a bounded summary, then `--view definitions|usage|clips|tree|window|effective`.
Specify `--lane`, `--clip`, `--definition` or `--target PATH` as relevant.
`window` requires `--start` and `--end`; `--offset`/`--limit` page through results
(maximum 100). `payload` is an explicit full-definition detail response.
`tree` includes containers and gives targets with IDs, path, pass, revision and
fingerprint. `effective` explains additive pitch contributions and note omissions.
Never edit legacy shadow pads to change clip music.

All new local mutations support `--dry-run` and `--expected-revision N`.
They operate on a copy, validate the result, then atomically replace the staged
file. Another writer gets `session_busy`. One batch is one transaction and one
history action. Use `edit batch --file PATH` with
`{"operations":[{"op":"clips.put","laneId":"bass","value":{...}}]}`.
Operation names are the command families joined with a dot. Pattern occurrence
editing adds `target` and `scope` to the operation; other fields go in `value`.
External files and remote API side effects are separate from the staged transaction.

Success JSON has `schemaVersion: 1`, `ok: true`, `result`. Mutation results give
the summary, changed state, edit and arrangement revisions, fingerprint, count
deltas, affected IDs, warnings and validation layers. `changed: false` is a
no-op. Dry runs report `stage: preview`; saved/runtime flags remain false.
Failures use stderr only, `ok: false`, code, message, path and retry hints.
Exit codes: 0 success, 1 input/domain/I/O/backend failure, 2 argument failure.
Local rejected transactions leave staged bytes unchanged. Remote errors may
require runtime/status inspection, especially after an interrupted connection.

## Content and timeline operations

`edit clips put --lane ID --file PATH` updates a clip window or its references.
`clips trim --lane ID --id CLIP --file PATH` changes the explicit start/length/offset;
`clips fit --lane ID --id CLIP` fits content. `clips remove` leaves a timeline gap.
`song fit` explicitly removes trailing song silence. `song put` accepts `end`,
`tempo`, `loop` and `loopSelection: {start,end}` (or null); loop endpoints must
lie on 2520-tick transport boundaries.

`edit structure edit --file PATH` takes:

```json
{"laneId":"bass","clipId":"verse","pass":0,"scope":"local",
 "command":{"kind":"group","parent":[],"ids":["FIRST_ID","SECOND_ID"],"level":"group","name":"Phrase"}}
```

`parent` selects a container path; `ids` are consecutive children in that row.
Supported kinds: `insert` (`definitionId`), `rest` (`ticks`), `rename` (`name`),
`remove`, `group` (`level: group|supergroup`), `ungroup`, `duplicate`, `move`,
`timed`, `resize`, `resize-rest`, `group-repetitions`. A destination `target`
uses `{path,index}` for reordering, or `{path,ticks}` for placement into silence.
Timed movement leaves an equivalent source rest; it does not push occupied
neighbors. Resize uses exact whole local beats, or independent ticks for owned
curves. `resize-rest` selects a trailing rest. Structural removal closes content
inside the clip while retaining the outer window; closing song time is explicit.

Local structural saves fork changed ancestors only. Shared saves update all
linked definitions and check other windows for collisions. Later independent
clips stay in place. Shortening retains outer silence unless fitted. Duplicate
appends once after the last sounding content, even when the selection is inside
a loop. Grouping across passes takes `range: {first:{pass,id},last:{pass,id}}`;
it materializes complete intersecting passes into a Once clip with fixed indexes,
retaining hidden cropped content and transposition paths. Ordinary edits retain loops.

`structure copy` accepts `laneId`, `clipId`, `destinationLaneId`, new `id`, `start`.
Same-lane copies share definitions. Same-source cross-lane copies are independent
and use destination timing; missing/ambiguous used drum keys and incompatible
controller modes fail. `structure convert-cycle` accepts `laneId` and explicitly
converts an independent legacy cycle through song end. Undo retains the original.

`sections paste` takes `lanes`, `from`, `length`, `at`, `mode: insert|overwrite`.
`sections insert-time|close-time` takes `lanes`, `start`, `length`. Supply every
desired lane explicitly; omitted lanes retain their clips. Preview with
`--dry-run`, inspect affected windows, then apply.

For detailed melodic/drum edits, `patterns cells --lane ID --file PATH` accepts:

```json
{"definitionId":"riff","edits":[{"step":4,"values":{"timingOffsetPercent":-20,"velocity":90}}]}
```

Use `target` plus `scope: local|shared` instead of `definitionId` for one
occurrence. Drum edits add `key` or `rowId`. `values` may set `note`, `chord`,
`hold`, `active`, `velocity`, `ratchets`, `ratchetEndVelocity`, `strumDirection`,
`strumSpreadPercent`, or `timingOffsetPercent`. Preserve inactive cells unless
activation is explicitly requested. Strumming and multiple ratchets conflict.

## Undo and external changes

`edit undo`/`redo` replay compact GUI-compatible clip history (25 entries).
New edits truncate redo. Source topology changes reset clip history; unrelated
mixer/rack edits preserve it. Invalid optional history is reported and reset
without discarding music. Stale targets fail; inspect again. History preserves
IDs and sharing through native/performance save and GUI reload. It does not
recover unsaved GUI drafts, reverse external exports, or undo remote sessions.
