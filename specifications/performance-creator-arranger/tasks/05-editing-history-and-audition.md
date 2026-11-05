# Task 05 — Structural editing, interoperable history and audition

Status: implemented. Evidence: [implementation record](../implementation-record.md). Stage: 3 — Editing completeness. Depends on: [Task 03](03-song-specifications-and-transposition.md) and [Task 04](04-instrument-automation.md). Exit gate: **G5**. Next: [Task 06](06-skill-verification-and-packaging.md).

## Result

An agent can revise a song's structure and individual occurrences with the same musical consequences as the arranger, undo those edits across GUI/CLI round trips, and audition the selected context without corrupting playback or authored state.

Read [operations](../../../frontend/src/lib/clipArranger/operations.ts), [structure](../../../frontend/src/lib/clipArranger/structure.ts), [timed structure](../../../frontend/src/lib/clipArranger/timedStructure.ts), [history](../../../frontend/src/lib/clipArranger/history.ts), [runtime/audition projection](../../../frontend/src/lib/clipArranger/runtime.ts) and the latest [arranger implementation record](../../redesign-arranger/implementation-record.md). Capture current semantics in fixtures before porting them.

## Work

1. Extend the operation layer with explicit content insertion, timed move, reorder, linked copy, independent variation, removal, pattern/rest resizing, grouping, supergrouping and ungrouping. Keep occurrence selectors revision-aware. Distinguish operations that leave a source rest, close an internal position, leave an outer timeline gap or explicitly close song time.
2. Implement cross-clip copies on one lane and supported same-source cross-lane copies using destination timing. Validate drum-row/key mapping and controller-mode compatibility. Cross-lane definitions are independent, with complete identity/path/profile remapping; do not create invalid cross-lane references.
3. Support section copy/paste-overwrite/paste-insert, explicit insert/close time and selected-lane/all-lane scopes. Preview affected windows, removals and song end before a transactional application. Preserve independent legacy cycles until explicitly converted to song clips, with bounded conversion and original recovery.
4. Match structural growth and shortening rules: growth consumes silence or expands windows only when valid; shortening retains trailing space unless explicitly fitted; linked growth evaluates all uses; independent later clips never shift implicitly. Use exact rational span/phase calculations for partial loops and reject collisions with blocking clip IDs.
5. Implement local versus all-linked structural save and minimal ancestor forks. Local edits of generated passes preserve before/after windows and source offsets. Return old-to-new selectors when splits or forks invalidate occurrence paths, so a follow-up command can continue without guessing.
6. Implement cross-repeat grouping and loop duplication according to current app semantics. Materialize complete intersecting source passes into a Once clip only for these operations; preserve outer ID/window, hidden cropped content, fixed indices, placement paths and shared profile links. Duplicate-after-loop means append once after the final repetition. Preflight capacity and retain compact loops after a rejected operation.
7. Integrate the existing compact clip-history v2 format, 25 entries and cursor. One logical batch/split/fork/section operation is one history action. Preserve valid prior history, truncate redo on a new branch and replay exact identities. Source topology changes follow existing history reset rules; unrelated rack/mixer edits do not invalidate it. Invalid/stale optional history is handled without discarding music and with a reported reason.
8. Make CLI history interoperable with GUI edits, autosave recovery and native bundles. Include before/after transition validation and legacy-history conversion as required by current readers. Do not store full duplicate performance snapshots per small command. Replace Task 02's temporary conflicting-history invalidation with the final supported behavior.
9. Resolve stale local drafts and external edits through revision/fingerprint checks. CLI sessions cannot see unsaved GUI-only drafts; explain that boundary and protect saved state through conditional persistence. Do not claim to merge an invisible GUI draft. Explicit CLI structural drafts, if offered, must distinguish draft undo from committed arranger history and must never enter save/export implicitly.
10. Add selected-occurrence/pattern/container audition and stop/status commands using the current clip-aware protocol. Include original notes, selected repeat index, enclosing transposition, exact rests and explicit full-definition versus cropped-window scope. Audition is temporary and excluded from performance save, song-spec output and exports.
11. Preserve runtime ownership and transport. While the song runs, audition temporarily replaces the selected source; stop restores its current arrangement position. With the song stopped, audition does not move the song cursor. Song start/stop/seek, loop/end, arpeggiator incoming notes and preexisting engine ownership follow existing backend contracts. Starting a CLI-owned engine and stopping it differs from attaching to another client's running session.
12. Expose live accepted/preparing/pending/applied/failed states and target occurrence when available. Preserve current occurrence latching, coalesced latest edits and failure recovery. Do not equate an HTTP acknowledgment with audible application or restart transport for ordinary clip edits.
13. Verify actual playback and offline parity through existing projection/export services. Add export invocation/inspection support only where the CLI lacks the necessary existing backend operation; do not create another scheduler or pitch implementation.

## Regression tests

- Table-driven structural operation corpus across all source types, nesting levels and both scopes; assert exact intervals, references, IDs, hidden content and changed/unaffected windows.
- Collision, insufficient silence, invalid hierarchy, incompatible destination and capacity rejection leave config/history/revision unchanged. Returned conflicts name blockers and valid correction targets.
- Cross-repeat grouping/duplicate tests use the existing fixed-index fixture and verify effective pitches before/after subsequent edits to shared profiles. Include cropped first/last passes, exact rests and repeated children in a shared parent.
- Local note edit in one repeat creates one musical variation and minimal structural changes; shared edits update all uses. Existing unrelated automation remains intact.
- Twenty-five mixed operations, overflow eviction, undo/redo, redo branching, GUI-produced history import, CLI-produced history replay, topology resets and external conflicts. Save/load/autosave/native preserves cursor and music without exceeding existing persistence limits.
- Section tests cover selected/all lanes, partial clipped boundaries, insertion/overwrite and explicit cycle conversion. No omitted lane changes by accident.
- Real session API/service tests for full-definition and cropped audition, nested/parent/shared transforms, grouped fixed indices, rests, song seek/stop/restart, preparation failure, newer revisions and restoration of owned notes/CC state.
- Capture note attacks/releases and CC output, including sparse sustained-note chase, strums, deterministic arpeggiator input and MIDI-range omissions. Compare equivalent live, audition and MIDI/SCORE export contexts.

## Acceptance criteria — G5

- [A15–A19 and A21](../implementation-plan.md#5-cross-task-regression-and-acceptance-matrix) pass; no Stage 3 capability remains merely a proposed follow-up.
- The agent can make a scoped structural edit, inspect impact, apply, undo and redo it using only returned IDs/selectors.
- History round trips between CLI and GUI and retains the exact intended sharing and cursor.
- Audition uses the selected musical context, restores prior playback correctly and cannot enter saved music.
- Playback/export checks use real backend behavior and event evidence, with actual browser-clock/Csound verification distinguished from unit simulations.
- Long-loop work remains bounded except for explicitly materializing operations, which enforce capacity before allocation.

## Boundary

Retain current musical editors, source transport semantics and audio scheduling. Do not broaden generic session ownership privileges or overwrite unknown external drafts. Any unavailable runtime check remains an open acceptance item, not a simulated pass.
