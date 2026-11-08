# Configurable process coordination batches

## Contract

Process coordination defaults to 256 engine frames. Config stores the integer 32–1024
workspace preference `parallelRenderBatchFrames` and sends `parallel_batch_frames` on opt-in
session creation. Apply is locked while running/starting; stopped session reuse includes the
batch choice in its signature. Reload restores the batch preference but not the parallel opt-in.
The optional API field is strictly validated; omitted/null uses the server default
`VISUALCSOUND_PARALLEL_RENDER_BATCH_FRAMES` (integer 32–1024), passed through by Compose.
The setting never enters patch/performance data or CSD exports.
`RendererPolicy.coordination_frames` carries the immutable per-session choice;
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
The measurements below distinguish synthetic render cost from saved-arrangement playback.

Config UI follow-up: all 1,401 frontend tests, lint and production build passed. All 60
selected backend checks and backend lint passed, including strict API bounds, per-session
overrides, default/fallback and native Lake/shared-table audio parity at 32/128/255/256/1024.
The 255-frame case checks rounding without changing synthesis timing. Browser validation
confirmed 1024 persists across reload; the default Config screenshot is in
`screenshots/config_parallel_batch.png`. This adds configuration coverage, not new performance
qualification at 1024. Existing ten-minute measurements below remain the performance evidence.

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

An initial browser baseline overlapped an independent rebuild/restart of the live application
and was interrupted after 420.23 seconds. Its 5,926 underrun increments are retained under
`contended-initial/`, not used as a matched baseline. After the user confirmed the live app
would remain idle, all browser arms were restarted for a clean comparison.

Validation before measurement: 504 focused backend checks passed, including canonical CSD
byte fixtures, default/fallback single behavior, native parity and process lifecycle. Frontend
lint, build and 1,384 tests passed. The Docker build and backend lint passed. The English
manual was regenerated and the changed settings page was visually checked in the PDF.

## Matched browser results and default selection

After the user reserved an idle window, the clean runs were:

- Single: 12:39:45–12:49:48 UTC (603.43 seconds).
- Parallel/128: 12:50:18–13:00:21 UTC (602.44 seconds).
- Parallel/256: 13:00:59–13:11:02 UTC (602.94 seconds).

All 43 live-app observations per arm show no active sessions, and live-container logs contain
no playback starts or browser-clock connections during the combined window. All three captures
retain running transport and nonzero audio. The parallel arms retain three workers, with
the requested effective coordination size, no failure and no fallback. Each arm uses the
same saved arrangement and browser settings, including the same ten-second startup warmup.

| Observed browser metric | Single | Parallel/128 | Parallel/256 |
| --- | ---: | ---: | ---: |
| Underrun callback increase | 10 | 92 | 10 |
| Overruns / stream errors | 0 / 0 | 0 / 0 | 0 / 0 |
| Median render/audio ratio | 0.873 | 0.868 | 0.834 |
| p95 render/audio ratio | 1.031 | 1.046 | 1.004 |
| p99 render/audio ratio | 1.095 | 1.142 | 1.062 |
| Maximum render/audio ratio | 1.922 | 2.310 | 1.159 |

These are 1,205–1,207 samples of the existing browser diagnostic per arm, with linear
percentile interpolation, not independent request-latency percentiles. Ratios above one mean
backend render service time exceeded the corresponding audio duration. Underruns count
AudioWorklet callbacks with insufficient PCM, not distinct audible glitches. No run is
underrun-free. Raw evidence and exact settings are in `browser-comparison.json` and the three
`*-soak.json` files under `output/coordination-batches/`.

**Choose 256 as the parallel coordination default.** It has the best short native timings,
matches single's underrun count in this saved-arrangement comparison, and reduces the median
observed render/audio ratio by approximately 4.5% versus single and 4.0% versus 128. Its observed
tail ratios are also lower. The actual song improvement is modest; the much larger native
synthetic speedup is not an arrangement speedup. This is one matched comparison, not a new G7
qualification or evidence that arbitrary performances will improve. The 128 setting remains
available for a shorter live-input scheduling horizon, and 32 restores the former coordination
interval for K=32. None of these changes selects parallel rendering by default.

Earlier Lake underrun counts came from different observation windows and should not be used
to attribute their entire reduction to batching. The interrupted baseline and variable
short-probe tails demonstrate that competing activity matters. This retest did not enlarge
browser or Csound I/O buffers. Larger browser queues can absorb brief stalls, but cannot make
a sustained render path faster. CPU footer percentages are approximately one-second logical
CPU activity observations; dependency and scheduling waits consume wall-clock time without
requiring a CPU to stay fully busy. They are not a measure of remaining audio-deadline headroom.

The measured image initially defaulted to 128; the 256 arm supplied the environment setting
explicitly. Final defaults select that already-measured 256 configuration. The batching DSP,
event timing and browser-buffer implementation were not changed after these measurements.
After Stop, all three final DSP PIDs and the shared audio allocation were gone. The isolated
browser and container were removed. This task did not rebuild, restart or reconfigure the live app.

After selecting 256, all 95 affected configuration, allocation, native-parity and public-API
checks passed again, as did backend lint and `git diff --check`. The final Docker build passed:
`sha256:7ae808c23f7c4b7b59b19e9320eb1eeadf6652b6ff48b52d4de04d046e15562e`.
The English manual was regenerated for the final default. The independently rebuilt live
container still reported a 128-frame setting at the final read-only check; this task did
not deploy the new default there.
