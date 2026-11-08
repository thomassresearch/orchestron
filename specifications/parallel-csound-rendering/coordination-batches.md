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

## Native measurements (2026-11-08)

The measured image is
`sha256:41942ce29ac1aeae9f6721b0f585e150bf9fdfa58db1244d5bc2a3c87d58a176`.
The isolated Linux Docker container uses 12 logical CPUs, 2 GiB memory and 64 MiB shared
memory. It has no live-library volume. The Master-insert Lake fixture is identical across
all arms, with 48 kHz/K=32 and unchanged 1024/512 Csound buffers. Ordinary graph selection
admits three workers; every parallel arm reports its actual coordination interval.

The short native probe sends the same nine-channel event sequence, initializes the canonical
mixer and requests 74 synthesis blocks (49.33 ms audio) per call. Each arm runs 256 requests,
excluding 64 warmup requests from timing statistics. A fresh admission observer per arm reads
real container capacity; pressure cooldown from a preceding arm does not suppress the next
measurement. No mock capacity, qualification catalog or changed synthesis program is used.

| Median request time | Single | 32-frame coordination | 128-frame coordination | 256-frame coordination |
| --- | ---: | ---: | ---: | ---: |
| Forward order | 61.87 ms | 55.27 ms | 46.60 ms | 40.67 ms |
| Reverse order | 60.62 ms | 47.04 ms | 40.62 ms | 39.27 ms |

All six parallel captures are byte-identical to their single reference (maximum float32
sample difference zero). The first 32-frame arm had substantial variability: p95 208.44 ms,
p99 238.51 ms and maximum 270.11 ms. Its reverse-order p95/p99 were 50.32/52.98 ms. This
variability is retained; the short probe alone cannot establish sustained arrangement
performance or attribute those spikes precisely. In reverse order, 128 reduced the median
by 13.7% relative to 32, and 256 reduced it by 16.5%.

Raw timings and scripts are under `output/coordination-batches/`, including
`native-benchmark.json` and `native-benchmark-reverse.json`. Matched saved-arrangement browser
runs use the same Listening-mode buffers for all arms: effective steady low/high targets
750/1500 ms, startup 1000/1800 ms, a 288,000-frame ring and up to 512 synthesis blocks per
request. These effective Listening minima override the smaller saved Live preferences.
The arrangement loops only in the isolated test browser. Live-app state is sampled during
every arm to record possible overlapping playback; no task-launched build or native regression
test runs during a timed browser measurement.

Validation before measurement: 504 focused backend checks passed, including canonical CSD
byte fixtures, default/fallback single behavior, native parity and process lifecycle. Frontend
lint, build and 1,384 tests passed. The Docker build and backend lint passed. The English
manual was regenerated and the changed settings page was visually checked in the PDF.
