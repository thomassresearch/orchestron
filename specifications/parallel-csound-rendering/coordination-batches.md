# Configurable process coordination batches

## Contract

Process coordination defaults to 128 engine frames, configured through
`VISUALCSOUND_PARALLEL_RENDER_BATCH_FRAMES` (integer 1–1024). Compose passes this setting
through. `RendererPolicy.coordination_frames` carries the immutable per-session choice;
`RendererDiagnostics.coordination_frames` reports the effective value while parallel is active.
Effective frames are `ksmps * max(1, configured_frames // ksmps)`. Requests shorter than the
target, including their final remainder, use smaller batches. Single remains the default and
fallback; canonical compilation, synthesis `ksmps`, browser queues, request limits and CSD
exports are unchanged. There is no live setting migration or song catalog.

This supersedes the one-synthesis-block coordination interval in T01/T05/T07. There is still
one outstanding command per worker and one globally sealed **coordination batch**. A batch
contains consecutive original synthesis steps. Independent workers run their steps concurrently;
dependent workers consume the matching stored steps after their predecessors publish the batch.
No additional audio delay or previous-batch bus is introduced. Resources with shared mutable
state remain owned by the same process.

The parent drains boundary actions, sequencers, MIDI and subscribed controls once per original
synthesis step, before sealing the batch. Callback sample indices and the scheduling cursor
retain those step boundaries. Already scheduled events keep their exact original k-block;
controllers are broadcast to all owning instances at that same step. Arrivals after preparation
cannot modify a sealed batch and target its end (with existing late-event ordering). At
48 kHz/K=32, a 128-frame interval spans 2.667 ms versus the former 0.667 ms; a 256-frame
interval spans 5.333 ms. This bounds additional live responsiveness cost, independently of the
much larger browser playback queue. The committed cursor is distinct from the scheduling cursor.

Each double-buffered audio bus contains `batch_blocks * ksmps` frames. Each worker's meter
region contains a row for every original synthesis step. All bytes are included in admission
and shared-memory limits before allocation. Native channel transfers bind per-step slices at
startup. The child still calls `performKsmps()` once per original step, applies its MIDI/control
delivery immediately before that call, and converts output to float32 on the native owner
thread. The parent preserves meter timestamps/cadence and resamples once per complete request.

Empty deliveries use the bootstrap-bound `RBL2`/`DBL2` compact record, now including the step
count. Eventful batches use validated `RENDER_BATCH` records containing ordered `RENDER` steps;
single-step eventful requests retain `RENDER`. Ownership, ranges, contiguous samples, revisions,
per-step event bounds, slots and exact acknowledgements are checked. Dense batches exceeding
the fixed mailbox capacity are split before dispatch without repeating scheduler drains or
dropping events. A single oversized step retains the existing diagnosed failure behavior.

The parent dispatches every worker before collecting. Workers wait once on each predecessor
per batch. No next batch is dispatched until all matching completions and dependency fences
have been validated. A failed or cancelled batch is not committed; the whole incomplete PCM
request is withheld. Completed earlier batches remain diagnostic only. Stop, watchdogs,
reaping and next-start fallback retain their bounded lifecycle rules.

## Verification

Tests cover compact and eventful capacity/ownership checks, timing/revision corruption,
per-step MIDI/CC/mixer changes, partial requests, exact audio and meter parity at 32/128/256
coordination frames, shared resources, Lake's original and Master-insert routing, late live
input, queued edits, cancellation, dense-command splitting and no partial publication.
Performance measurements are recorded below once the measured image and runs are complete.
