# Task 03 — Clip playback, audition and export parity

Status (reviewed 2026-11-05): Scheduling, audition integration and exports implemented. Exact auditions work for v3/v4 but v1/v2 retain fractional-rest/256-token limitations; all versions lack headroom at 512 authored definitions. Remaining stress/parity work is narrowed by existing regression and real-runtime evidence. See [priorities 1, 2 and 4](../remaining-work-review.md#recommended-order). Depends on: [Task 02](02-clip-model-and-migration.md). Gate: G3. Audio integration with Tasks 04/05 is already implemented.

Evidence and remaining work: [implementation record](../implementation-record.md).

## Result

The real audio runtime and offline exports play the new authored model correctly, and editor audition safely coexists with song transport and human input. No scheduling is driven by the mockup or React animation.

Read [contracts sections 2 and 5–8](../data-and-playback-contracts.md), [BACKEND.md](../../../BACKEND.md) and source-specific playback references. Primary seams: runtime config/models, source transport, sequencer playback/preparation, arpeggiator/score/controller services, runtime controller hook, browser-clock input policy and export services.

## Work

1. Resolve clip windows, source offsets, Once/Loop, nested references, gaps and exact timing in runtime preparation. Avoid expanding a long loop into an unbounded event list. Keep Python/compiled playback paths aligned where both exist.
2. Apply source-specific cut/seek/end behavior: release only owned notes, chase supported score notes, cancel pending strums/ratchets correctly, preserve continuous same-pattern arp rhythm where required and retain effect tails.
3. Implement the Task 01 transport matrix through explicit commands and generation IDs. Prepare before switching; one editor overlay replaces its lane while other lanes continue. Song transport and audition retain their defined phases. Stop/edit target changes cannot be undone by late responses.
4. Keep drafts as temporary runtime input. Coalesce live changes through the existing preparation pipeline, preserve working sound on failure, and separate musical edits from status-only updates. Show queued/applied/failed state based on audible runtime status.
5. Make engine startup idempotent and lifetime ownership explicit across song, editor, speaker previews, keyboard/controllers and explicit engine start. Keep buffer selection in the existing Auto/Live/Listening policy; no duplicated buffer logic in the arranger.
6. Preserve arp input dependencies, Live clock/hold/restart/processing, controller curve/step reset and channel behavior, mute/solo dependency gates, selected song loops and global Stop/Panic semantics.
7. Use the same source resolution in MIDI and both CSD modes. Preserve whole-rack native export, offline instrument selection, Master/routes, enabled manual-controller initialization and deterministic arp variation. Keep runtime/drafts out of export.

## Validation

Use deterministic event traces for clip start/end, crop, partial loop, offset, rational timing, negative timing shifts and nested content transitions. Compare migrated legacy fixture output with the baseline from Task 01. Compare online event output with offline output, allowing only already-documented export compaction differences.

Exercise stop during preparation, rapid target changes, cancel before launch, seek during audition, Song Play/Stop/end with audition active, failed preparation, removal and reconnect. Confirm no duplicate notes, stuck notes, lost controller reset, stale restart or cursor drift.

Extend `backend/tests/test_api.py` and relevant runtime/source-transport/score/arp/controller/export service tests; run runtime-hook and browser playback policy tests. Perform actual Csound/browser-clock playback with melodic, drum, score, arp and controller sources together. Measure preparation/render behavior against baseline and use `make benchmark-runtime` when scheduler changes warrant it.

## Acceptance

- Runtime and offline output obey fixed clip windows and exact source timing.
- The complete reviewed audition matrix works, including failure/race cases and restoration at current song position.
- Human inputs and explicit engine ownership survive unrelated song/editor stops.
- Existing musical generation, controller rules, buffer policy and routing remain intact.
- No new-format write path is enabled until every supported exporter can consume it correctly.

## Stop and rollback boundary

Keep the new runtime gated if parity, ownership or cancellation tests fail. Do not conceal failure by resetting the engine or seeking the song on every edit. Retain the old-format path and recoverable originals; do not approximate unsupported new clips as old pad sequences on rollback.
