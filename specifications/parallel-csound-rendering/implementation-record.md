# Parallel rendering implementation record

Current playback selection is defined by [whole-instrument graph partitioning](whole-instrument-partitioning.md).
It supersedes the historical per-song catalog and mandatory cost-profile gates below; timing,
ownership, lifecycle and export contracts remain in force.

Updated: 2026-11-07. T01–T08 delivered. G7 and G8 pass for the measured Linux ARM64, four-CPU, 48 kHz/K=32 scope; see the [T08 release summary](t08-qualification-summary.md). Single remains the default and fallback. Public opt-in requires the explicit operator catalog and capacity admission; no catalog is installed into an existing deployment and no default cutover is made.

## T01 delivered work

- [Typed protocol and policy contracts](../../backend/app/models/render_protocol.py), with a frozen [JSON schema](protocol.schema.json). These are internal, stateless models only. Default policy is single; one in-flight block and two slots per bus are fixed. Settings are not wired into deployment configuration.
- [Worker, timing, resource and build inventory](contracts.md), including the half-open MIDI block contract, original-deadline ordering after late-event clamping, current cursor behavior and direct-binding audio-bridge gap.
- [Versioned workloads](../../backend/tests/fixtures/parallel_render/workloads.json) and a bounded synthetic LIVE-mixer builder. Six cases cover tiny, independent 2/4/8, shared-delay and serial-heavy processing at K=1/32, with private effects, direct output, Master, MIDI and a prepared edit.
- [Native baseline command](../../backend/tools/benchmark_parallel_render.py), with fresh-process trials, separate tracing, mock refusal, source/fixture/runtime provenance, raw timings, deterministic fingerprints and comparison checks. It rejects source changes during measurement.
- [Regression tests](../../backend/tests/test_render_baseline.py) plus a session/API baseline regression. No current renderer, scheduler, compiler, native wrapper or selection behavior was changed.

G1 establishes a repeatable **single-renderer baseline and contracts**, not a qualified parallel workload or a claim of speedup. Resource categories are deliberately conservative; T03/T04 must prove partition eligibility. T01 does not enable any currently unknown opcode/plugin family.

## Verification

Executed locally with the existing Python 3.13 environment and real Csound:

| Check | Result |
| --- | --- |
| Baseline/protocol, worker, MIDI scheduler, PCM, Csound loader and browser-clock runtime suites with Python sequencer | 138 passed |
| Same suites with explicit Cython sequencer | 138 passed |
| API single-worker/default restart, native K=1 live edit and queued-pad PCM-boundary regressions | 3 passed |
| Ruff across `backend/app`, `backend/tests`, `backend/tools` | Passed |

Focused suite command:

```bash
VISUALCSOUND_SEQUENCER_IMPLEMENTATION=python .venv/bin/python -m pytest \
  backend/tests/test_render_baseline.py backend/tests/test_csound_worker.py \
  backend/tests/test_midi_scheduler.py backend/tests/test_browser_audio_pcm.py \
  backend/tests/test_ctcsound_loader.py backend/tests/test_browser_clock_runtime.py -q
```

Repeat with `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython`. The API selection was `renderer_baseline or native_ksmps_one_live_edit_arriving_during_render or selected_playback_kernel_preserves_queued_pad_boundary`. The existing Starlette/httpx deprecation warning appeared in the API run; it did not affect results.

The timing tests assert native PCM levels at block boundaries and exercise deterministic post-drain injection. One additional regression verifies that two overdue events with reversed insertion order retain their original deadline order after both timestamps are clamped to the same block start. The protocol accepts this valid delivery order without deduplication or resorting.

## Native baseline

Primary report: [single native baseline](measurements/t01-single-native.json). Host: macOS 15.7.9 ARM64, 12 reported CPUs, Python 3.13.2, Csound 6.18.1, `DirectCsound`, float64 output, Cython sequencer. Exact source/fixture hashes and repository state are embedded in the report; use these together with the revision to identify the measured sources.

Each of 12 case/rate combinations uses two separate trace runs and three uninstrumented fresh-process trials. The trace runs match exactly; all timed runs match their canonical PCM, marker, meter, edit/control and final-state fingerprints. Each timed trial renders 24,576 frames after a 2,048-frame warmup, in 48 requests of 512 frames. A request represents 10.667 ms of audio.

| Workload | K=1 p95 render ms | K=32 p95 render ms |
| --- | ---: | ---: |
| Tiny single source | 4.227 | 0.978 |
| Two independent sources | 9.609 | 4.822 |
| Four independent sources | 16.413 | 9.336 |
| Eight independent sources | 30.007 | 18.082 |
| Four sources with shared delay | 18.180 | 9.895 |
| Serial-heavy single source | 10.671 | 7.258 |

These timings include sequencing, native DSP, control handling, copying and encoding inside the worker render call. They exclude API/WebSocket/browser transport, compilation/startup, audio-device latency and trace instrumentation. The heavier cases exceed their audio duration on this single engine; this supplies stress workloads for future work, not evidence that process splitting will solve them. In particular, serial-heavy work may remain single.

Tails/maxima and raw wall/CPU samples are retained. Short local trials do not establish an underrun rate, a statistically stable 5% regression threshold, or a deployment CPU budget. The baseline leaves all release thresholds unchanged.

The [repeat report](measurements/t01-single-native-repeat.json), produced with `--compare`, matches all 12 cases' trace, PCM/state and canonical CSD fingerprints. Median timing differences range from -0.55% to +3.20%, p95 from +0.97% to +4.27%, and p99 from -15.33% to +6.16%. The tail variation is a reason to retain raw measurements and require longer paired qualification, not a renderer regression: both runs use the same single implementation.

## Isolated container smoke check

[Container report](measurements/t01-container-smoke.json): existing image `sha256:7789d5dafd9fc26574b2aea726ca89a4184a4ba62909ac970c4ad9678d95845c`, Linux ARM64 under Docker Desktop, Python 3.13.18, Csound 6.18.1, stock `Csound` binding. Ran tiny, four independent and shared-delay cases at K=1/32, with two trace repetitions and one timed trial per combination. All deterministic checks passed with nonzero finite audio.

The container had no network, a read-only repository mount, a temporary results mount, a four-CPU quota and 2 GiB memory. No application data volume or running application session was accessed. Observed `cpu_count=12`, affinity 0–11 and `cpu.max=400000 100000` show that visible CPU count alone would overestimate the quota. `memory.max` was 2,147,483,648 bytes.

The stock binding exposes `audioChannel`, `setAudioChannel`, `spin`, `spout`, `sizeOfMYFLT` and `setControlChannel`; the report records the method-level probe. This establishes availability, not working inter-process bridge semantics. The container used the explicit Python sequencer with the mounted source tree; it does not qualify the image's Cython kernel or provide a direct performance comparison with the macOS/Cython runs. Git was absent in this runtime image, so revision is null and source/fixture hashes identify the mounted inputs. No full image rebuild or AMD64 test was performed.

Reproduction uses the image's `/app/.venv/bin/python`, repository mounted at `/workspace`, workdir `/workspace`, `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=python`, `--cpus 4 --memory 2g --network none`, and `--cases tiny_1 independent_4 shared_4 --ksmps 1 32 --frames 12288 --rounds 1`. Pass the known image digest through `ORCHESTRON_BASELINE_IMAGE_DIGEST` and direct output to a temporary results mount.

## T02 renderer interface

- [RealtimeRenderer](../../backend/app/engine/realtime_renderer.py) is a structural Python protocol covering lifecycle, engine format/readiness, committed cursor, PCM rendering, MIDI, lane releases, panic, controls, meters and render-boundary actions. Controller and lane state remain in the parent.
- [create_realtime_renderer](../../backend/app/engine/renderer_factory.py) is the construction point used by both `RuntimeSession` defaults and `SessionService`. It always returns the original `CsoundWorker` and forwards the existing asset-directory/logging settings. Native availability and explicit mock mode retain the existing behavior. Native compile/start errors still propagate.
- Start/render result dataclasses moved beside the interface. Existing imports through `csound_worker` remain valid; fields, defaults, slots and mutability are preserved. There are no public API, WebSocket, frontend or saved-format changes.
- Structural conformance avoids a forwarding adapter in the audio path. All 58 existing worker method bodies remain unchanged (AST comparison against the T01-hash-matching source). No scheduling, locking, resampling, event acceptance or numerical DSP code changed. The single renderer remains independently constructible and the future compatibility fallback.
- The baseline command now exercises the same factory and refuses any implementation other than the original single native worker. Protocol checks occur only in tests. Parallel selection, process allocation, capability/admission decisions and active-session migration are not introduced by T02.

### Behavior verification

The new [renderer tests](../../backend/tests/test_realtime_renderer.py) cover isolated per-session defaults, explicit mock mode, missing-binding fallback, shared result imports, callback/cursor semantics, idle boundary results/errors, stop/restart and native startup error propagation. [API regressions](../../backend/tests/test_api.py) inject an adapter exposing only declared protocol members, for both native and mock sessions, through compile/start, sequencer configuration, WebSocket PCM, panic, stop/restart and deletion. The existing logging-setting test still verifies forwarding. The admission regression now intercepts the factory and continues to require quota rejection before allocating a renderer.

| Check | Result |
| --- | --- |
| Full selected API/runtime suites with Python sequencer | 688 passed initially; the quota test's old constructor interception was updated and its rerun passed |
| Same complete selection with explicit Cython sequencer after the test update | 689 passed |
| Ruff across `backend/app`, `backend/tests`, `backend/tools` | Passed |

The selection includes native K=1 live-edit boundaries and queued-pad PCM timing. Reproduction (replace `cython` with `python` for the other kernel):

```bash
VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython .venv/bin/python -m pytest \
  backend/tests/test_realtime_renderer.py backend/tests/test_render_baseline.py \
  backend/tests/test_csound_worker.py backend/tests/test_midi_scheduler.py \
  backend/tests/test_browser_audio_pcm.py backend/tests/test_ctcsound_loader.py \
  backend/tests/test_browser_clock_runtime.py backend/tests/test_browser_clock_policy.py \
  backend/tests/test_session_lifecycle.py backend/tests/test_session_performance_runtime.py \
  backend/tests/test_lane_output.py backend/tests/test_performance_controllers.py \
  backend/tests/test_api.py backend/tests/test_api_sessions.py -q
```

The existing Starlette/httpx deprecation warning remains. No tests/builds ran concurrently with the timing measurements below.

### Performance and trace comparison

Three full host reports use the same T01 workload parameters, binding and Cython kernel: [T02 A](measurements/t02-single-native.json), [fresh T01 control](measurements/t02-t01-control.json), then [T02 B](measurements/t02-single-native-repeat.json). Each includes two trace processes and three timed fresh processes per case/rate. All 12 cases match the original T01 canonical CSD, PCM, MIDI ordering, block/cursor trace, transport markers, meters, edit/control samples and final-state fingerprints exactly. T02 B also compares directly with the fresh control.

The original T01 artifacts remain unchanged. The fresh control used a temporary source snapshot: **every recorded source hash equals the original T01 report**, including the native extension. Its source stamp was copied and validated by the existing loader. No working-tree production files were reverted. The snapshot has no Git repository, so its revision is null; source hashes establish identity.

The control was necessary because T02 A's wall-time tails exceeded the old baseline in several cases. Re-running the exact T01 sources also shifted medians by +1.42% to +7.31%, p95 by +1.55% to +17.70%, and p99 by -5.96% to +47.90% relative to the saved T01 baseline. Historical wall-time differences alone would therefore misidentify current host variation as a renderer change.

Compared with the fresh T01 control, T02 A medians range from -0.59% to +2.43%; T02 B medians range from -2.98% to +0.85%. Request p95 values (512 frames, 10.667 ms of audio) are:

| Case / ksmps | Fresh T01 p95 ms | T02 A p95 ms | T02 B p95 ms |
| --- | ---: | ---: | ---: |
| tiny_1 / 1 | 4.504 | 4.445 | 4.339 |
| independent_2 / 1 | 11.310 | 10.162 | 9.829 |
| independent_4 / 1 | 18.232 | 17.193 | 16.969 |
| independent_8 / 1 | 32.493 | 31.762 | 30.768 |
| shared_4 / 1 | 19.702 | 18.930 | 19.251 |
| serial_1 / 1 | 10.837 | 11.114 | 11.065 |
| tiny_1 / 32 | 1.054 | 1.209 | 1.050 |
| independent_2 / 32 | 5.009 | 5.029 | 4.869 |
| independent_4 / 32 | 9.600 | 10.144 | 9.312 |
| independent_8 / 32 | 18.599 | 20.386 | 18.303 |
| shared_4 / 32 | 10.117 | 10.531 | 9.941 |
| serial_1 / 32 | 7.379 | 7.440 | 9.370 |

Tail spikes are retained, not discarded. For example, tiny K=32 p99 was 3.929 ms in A and 1.205 ms in B versus the control's 1.162 ms; serial K=32 p95 was 7.440 ms in A but 9.370 ms in B versus 7.379 ms in the control. No case's p95 or p99 exceeded the fresh control by more than 5% in **both** T02 runs. No repeatable performance regression was observed in this comparison. These short, noisy runs are not a statistical guarantee of a 5% tail budget or a claim of speedup; longer deployment/browser qualification remains required by the later gates.

Reproduce T02 with the T01 command and `--compare specifications/parallel-csound-rendering/measurements/t01-single-native.json`. T02 B used `--compare specifications/parallel-csound-rendering/measurements/t02-t01-control.json`. Recreating the control requires matching all T01 `provenance.source_hashes` in a separate source tree, retaining the verified extension source stamp and fixture, and using the same Python environment and parameters. Do not substitute the current source tree and label it T01.

The [T02 container smoke report](measurements/t02-container-smoke.json) matches all six T01 container cases exactly. It uses the same image digest, stock native binding, Python sequencer, 12,288 frames and one timed trial per case. The observed CPU quota remains four CPUs (`cpu.max=400000 100000`) and memory limit two GiB, despite 12 visible/affinity CPUs. Against the T01 smoke report, medians range from -4.48% to -0.22%, p95 from -4.88% to -0.16%, and p99 from -8.73% to +6.21%. This is a compatibility smoke check, not container tail-latency qualification. No network, application-data mount, full image rebuild or AMD64 execution was involved.

G2 is satisfied for this interface extraction by API/runtime behavior, exact native trace parity and no observed repeatable regression. Single remains the only selected implementation. No parallel execution or default cutover gate is satisfied by these results.

## T03 pure planner and resource analysis

Delivered 2026-11-07. [Compiler graph analysis](../../backend/app/services/compiler_render_graph.py)
and [resource analysis](../../backend/app/services/compiler_render_resources.py) feed the
[pure planner](../../backend/app/services/render_partition_plan.py). The public session/API,
canonical compiler, offline exports and renderer factory retain their existing paths.
`CompilerService.analyze_realtime_graph()` is an explicit internal analysis entry point;
session compile/start does not call it. No child renderer, shared-memory allocation or CPU
capacity probe is introduced.

The graph snapshot preserves canonical stage order and all LIVE port connections, including
implicit direct output, custom ports, pre/post send inputs and bypass dry/wet paths. Resource
declarations are derived from structured compiler inputs. The narrow versioned audit pins
opcode semantic definitions; unknown definitions, table lifetimes and asset/native handles
produce stable single-layout reasons. Legato collectors, the shared panic listener, allocation
caps and host performance controls have explicit ownership. MIDI initialization conservatively
co-locates dependent readers/writers; MIDI deliveries remain full-stream subscriptions.

The planner closes grouping-induced cycles, propagates independent origins, keeps whole
private branches, and assigns joins, Master/inserts, output and disconnected work to one
shared suffix. Stable cost/identity tie breaks assign branches within the caller's worker
limit, counting the suffix. Unmeasured or insufficient work, dominant serial cost and excessive
boundary memory fall back to one complete partition. Mutable records and invalid costs are
rejected. An independent validator checks ownership, local/cut coverage, dependency order,
helpers, controls/meters, estimates, buffer formats and the hash.

Every result still selects **single** and is **ineligible for execution**, even when its
diagnostic layout is coarse. A candidate does not qualify an opcode, asset, native binding,
CPU budget or speedup. The [T03 contract](contracts.md#8-t03-pure-planning-contract) records
precise limits, canonical-reference semantics and remaining validation requirements.

### Fixture and regression evidence

[Versioned cases](../../backend/tests/fixtures/parallel_render/planner_cases.json) and
[34 snapshots](../../backend/tests/fixtures/parallel_render/planner_snapshots.json) cover 17
variants at K=1/32. They reuse the six T01 workloads and add bypass/Master inserts, sidechain
routing, custom/multiple outputs, unknown opcodes, numbered/dynamic tables, legato/allocation
helpers, MIDI initialization, disconnected work, legacy fallback and asset exclusions.
Additional tests cover actual feedback/invalid ports, host-controller ownership, mutable inputs,
altered plan metadata, missing/duplicate ownership, nonadjacent co-location closure and 16
deterministically generated DAGs. No examples or user data are read.

The fixture cost profile is explicitly **synthetic**, with a four-worker limit and an eight-byte
sample estimate. Representative K=32 diagnostic results are:

| Case | Stages | Proposed partitions | Cut buses | Estimated shared audio bytes |
| --- | ---: | ---: | ---: | ---: |
| Two independent sources | 23 | 3 | 8 | 4,096 |
| Four independent sources | 41 | 4 | 16 | 8,192 |
| Eight independent sources | 77 | 4 | 32 | 16,384 |
| Four sources with shared delay | 49 | 4 | 20 | 10,240 |
| Private/Master insert bypass | 55 | 4 | 16 | 8,192 |
| Sidechain routing | 47 | 4 | 18 | 9,216 |

Tiny, serial, unclassified, table, asset, legacy and coupled MIDI-initialization cases produce
single-layout plans. All cases preserve complete stage coverage. The shared audio counts are
estimates for two mono slots per cut; they exclude IPC metadata, native instances and assets.

| Check | Result |
| --- | --- |
| Full backend suite with explicit Cython sequencer | 2,937 passed |
| Final focused planner/baseline/renderer/runtime/API selection with Python sequencer | 177 passed |
| Same final focused selection with explicit Cython sequencer | 177 passed |
| Final planner suite within those selections | 96 tests, including 34 exact snapshots |
| Canonical T01 CSD hashes after sharing fixture inputs | All 12 case/rate combinations unchanged |
| LIVE connection/port order, references and meters compared with canonical compiler | 15 fixture variants passed |
| Ruff across backend app/tests/tools; diff whitespace and local documentation links | Passed |

Full suite command: `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython .venv/bin/python -m pytest backend/tests -q`.
Final focused suites were rerun after tightening immutable-input/estimate validation and adding
host-control ownership and independently enforced resource-scope regressions. They include `test_render_partition_plan.py`,
`test_render_baseline.py`, `test_realtime_renderer.py`, `test_csound_worker.py`,
`test_browser_clock_runtime.py`, `test_session_performance_runtime.py`, plus API checks for
planner non-activation, single default/restart, interface-only native/mock sessions, native K=1
live edits and queued-pad boundaries. The existing Starlette/httpx deprecation warning remains.

G3 is satisfied for pure planning and resource exclusion. This task makes no new native
parallel performance claim and does not rerun the historical wall-time benchmarks: planning
is absent from the rendering path, canonical CSD hashes are identical, and existing native
audio/runtime regressions pass. No T03 Docker rebuild, multi-process native audio or browser
soak was performed; these remain later qualification gates.

## T04 shared lowering and internal realtime programs

Delivered 2026-11-07. [Structured stage lowering](../../backend/app/services/compiler_stage_lowering.py)
now feeds canonical mixer compilation and the [internal partition compiler](../../backend/app/services/compiler_partitioned.py).
The optional `CompilerService.compile_realtime_partitions()` entry point emits programs for
future **realtime playback** instances. It is never called by session startup or export.
Offline MIDI/SCORE exports remain single and unchanged. No child renderer, process pool,
shared-memory allocation, runtime mode flag or default cutover was introduced.

Connections are expanded once by shared lowering functions, preserving port/contribution
order. Structured setup entries retain controller/maxalloc/helper ownership. Partition
programs use one ingress before local stages and one summed-outlet egress after them,
with separate native audio channels for every cut. Both adapters read all inputs before
publishing outputs. Numeric stage/note references are remapped and verified against native
`nstrnum`; named MIDI assignments and scoped legato helpers retain correct note ownership.
Canonical and internal artifacts are bound to the plan and full program metadata by a digest;
changed or mismatched artifacts are rejected before the harness starts native instances.

The direct Csound binding now supports the three optional qualification methods:
`audioChannel`, `setAudioChannel`, and `sizeOfMYFLT`. Copies require exact native-width,
contiguous ksmps arrays; incorrect length/dtype, unaligned/read-only output buffers and ABI
mismatches are rejected. Missing optional symbols do not disable the existing renderer.
The [sequential probe](../../backend/tools/_sequential_partition_probe.py) preallocates native
bridge arrays and closes every native instance on success, failure and partial startup.
It contains no authoritative scheduler, controller revision counter, lane gate or resampler.

### Native/compiler evidence

The tested local runtime is **DirectCsound, Csound 6.18.1 (6181), eight-byte MYFLT**.
The independently reported native width matches its float64 output. Native comparisons use
8,192 frames per case with identical ordered MIDI and control inputs; no samples are discarded
and no timing alignment or nonzero numerical tolerance is allowed.

- Nine graph cases at K=1/32: two/four/eight independent sources, shared delay,
  private/Master bypass, sidechain routing, custom/multiple outputs, disconnected work and legato.
- Six live-control runs: bypass/sidechain/custom graphs at both rates with gain, pan,
  mute/solo, send pre/post/zero and private/Master bypass ramps.
- Instance I-rate control updates and raw MIDI reads from a different channel at both rates;
  host controller mapping remains outside native instances.
- Active phrase envelopes, allocation caps, sustain/release and same-boundary panic/retrigger
  at both rates; shared helpers are emitted only in their declared partition.
- Shared nonlinear filtering before delay, polyphonic allocation limits and silent start/end
  at both rates. A separate 44.1 kHz / 0dbfs=2 case retains the full-performance engine settings.

All 31 audio/meter comparisons are **sample-identical**, with zero observed error and zero
sample offset. This is sequential compiler/bridge evidence for these fixtures/build only;
it does not establish concurrent event acceptance, browser latency or speedup.
The sidechain fixture is a routing/summing probe, not a compressor qualification.

[Canonical hash fixtures](../../backend/tests/fixtures/parallel_render/t04_canonical_csd_hashes.json)
were captured once from `compiler_mixer.py` at pre-T04 commit
`7bdd4c8e6dcc241e8f63dc9def44e6124f8645ca`. All **90** LIVE/MIDI and OFFLINE/MIDI/SCORE
CSD hashes (15 graph cases at K=1/32) remain identical. Tests do not read Git or regenerate
expected output. Hash tests pin the recorded macOS wrapper option convention independently
of the test host; their 92 parametrized checks were rerun after this portability fix. All twelve original T01 CSD hashes and all 34 T03 plan snapshots also remain
unchanged. Existing offline-profile API checks now explicitly reject partition-compiler calls;
ordinary session lifecycle tests reject both analysis and partition compilation.

| Check | Result |
| --- | --- |
| Full backend suite, explicit Cython sequencer | 3,088 passed; one existing tenor-saxophone test failed |
| Final focused compiler/planner/baseline/binding/renderer/runtime/API suite, Python | 331 passed |
| Same final focused suite, explicit Cython | 331 passed |
| Final compiler suite, including nonfinite-output rejection | 149 passed |
| Native sample and meter equality | 31 comparisons, exact |
| Canonical pre-T04 CSD hashes | 90 unchanged |
| T01 CSD hashes / T03 snapshots | 12 / 34 unchanged |
| Local numeric instrument references | Verified in plain and legato partitions |
| Optional binding shape/dtype/ABI and partial-start cleanup | Regression tests pass |
| Backend Ruff, whitespace and local documentation links | Passed |

Full command: `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython .venv/bin/python -m pytest backend/tests -q`.
Focused commands select `test_compiler_partitioned.py`, `test_ctcsound_loader.py`,
`test_render_partition_plan.py`, `test_render_baseline.py`, `test_realtime_renderer.py`,
`test_csound_worker.py`, `test_browser_clock_runtime.py`, `test_session_performance_runtime.py`
and API regressions for single selection/restart, native/mock interface sessions, native K=1
live edits, queued pads and both offline CSD modes. Both kernel selections are explicit.
Final focused checks include artifact-integrity and optional mixer default regressions.
The final full run uses the completed source without overlapping implementation edits.
The existing Starlette/httpx deprecation warning is unrelated.

The full suite is **not fully green**. Its remaining failure is
`test_tenor_saxophone.py::test_normal_register_is_tuned_and_releases_cleanly[32]`:
a pitch estimate differed by 15.167 cents against a 15-cent threshold. The same test
failed with the pre-T04 mixer compiler substituted in memory (15.257 cents); all generated
CSD, manifest and diagnostics match the current compiler exactly for the same patch input.
A separate six-case rerun showed two saxophone failures, while earlier isolated velocity
reruns passed. Ten repeats of the unchanged pre-T04 CSD also show changing pitch estimates.
These observations establish existing native fixture variability, not a partition discrepancy.
No instrument, random seed or test threshold was changed. The
[verification record](measurements/t04-sequential-verification.json) retains the results and
limits of this compiler-only control; it is not a full historical-runtime benchmark.

After the full run, the development harness additionally rejects nonfinite audio/meters,
so matching NaNs cannot count as parity. The final compiler suite passed **149 tests**
in 40.60 seconds, including all 31 finite audio/meter comparisons and the injected-NaN regression.


G4 is satisfied for the tested structured lowering and sequential native bridge. Plans and
artifacts still select single and remain execution-ineligible. No new wall-time performance
claim is made; the single renderer's hot loop and factory are untouched. No T04 Docker build,
stock-binding/container native bridge run, AMD64/float32 qualification or browser soak was
performed. Historical T01/T02 measurements are unchanged and do not qualify parallel execution.

## T05 persistent processes and parent coordination

Delivered an explicitly started [PartitionRenderCoordinator](../../backend/app/engine/parallel_csound_renderer.py),
the import-safe [child entry point](../../backend/app/engine/csound_process.py),
[shared storage and protocol validation](../../backend/app/engine/render_ipc.py) and a
[minimal native instance](../../backend/app/engine/partition_native.py) shared with the T04 harness.
The [execution contract](contracts.md#10-t05-process-execution-contract) records exact bounds,
ownership, event acceptance, cancellation and publication rules.

Children persist until stop/failure and use explicit spawn. Each owns one Csound instance;
none owns a sequencer, scheduler, lane gate, resampler or authoritative controller state.
The parent calls preparation once, validates/seals one interval, dispatches independent
partitions concurrently and releases the shared suffix only after all matching predecessors.
Native precision and separate compiler-ordered contributions survive shared-memory transfer.
The parent commits complete blocks, converts/resamples once per request and withholds an
entire failed response, including when earlier blocks already committed. No speculative
future blocks, partial replay or live fallback are implemented.

Preflight accounts for all shared arrays, both final output slots, meter slots, mailboxes,
bootstrap CSDs and alignment/page rounding. Linux reserves tmpfs pages before first write;
an undersized `/dev/shm` returns ENOSPC with clean rollback. Control messages use fixed-size
shared mailboxes and semaphore publication, avoiding blocking payload sends. JSON control
encoding is an explicit initial implementation choice, not a performance-qualified design.
Oversized messages fail before dispatch. Native arrays never travel through JSON or queues.

Stop cancels before waiting for render ownership. Global deadlines cover startup, each
render block and cleanup; termination/reaping uses one budget for the entire process set.
The parent unlinks only after reaping all owners. A parent-sentinel watcher exits even a
hung native child after parent death. Unreaped children prohibit restart. A blocked caller
callback is reported rather than pretending Stop completed; callbacks must yield promptly.

The Linux probe exposed an installed stock ctcsound declaration bug: both audio-channel
functions used `POINTER(c_int)` although their methods pass `POINTER(MYFLT)`. The extracted
partition wrapper now sets those signatures from the verified native sample width. The
same wrapper verifies actual `0dbfs` as well as rate, block size, stereo channels and dtype.
Default `CsoundWorker` construction and its render loop are untouched.

### T05 verification

Tests in [IPC](../../backend/tests/test_render_ipc.py),
[process coordination](../../backend/tests/test_parallel_csound_renderer.py) and API regressions
cover shared layout/byte bounds, mailbox corruption, slot generations, stale/duplicate replies,
event-after-drain timing, concurrent request serialization, revision/ownership rejection,
same-interval dependency barriers, conversion/resampling, partial spawn failure, compile/ABI
failure, crash/hang/cancellation, partial-request withholding and a fresh canonical fallback
after rollback. Deterministic barriers prove independent workers execute concurrently.

Native comparisons use eight versioned fixture families (two/four/eight private branches,
shared effects, bypass/direct output, sidechain, custom ports and legato), K=1/32, ordered
polyphony/retrigger/sustain/panic events and control writes. Require exact native final samples,
float32 PCM and every block's meter values against canonical and sequential instances; no
alignment search, warmup omission or tolerance. Every case renders 8,192 frames and requires
nonzero output. One hundred native start/render/stop cycles check fresh epochs, all child
reaping, arena unlinking and stable descriptor counts. A standalone parent-death test checks
children terminate while native calls are blocked and the resource tracker removes the arena.

The standalone [native process probe](../../backend/tools/probe_partition_process.py) emits
JSON evidence and refuses missing native support. It uses the frozen T04 MIDI fixture,
compares all PCM plus final meter readings, and performs explicit cleanup. It is a correctness
probe, not a benchmark. Linux checks use the existing ARM64 Docker Desktop image with the
current backend mounted read-only, network disabled, four CPUs, 1 GiB memory and 64 MiB shared
memory. They do not constitute a new final-image build or resource/performance qualification.

Final commands, counts, runtime and source provenance are recorded in
[T05 verification](measurements/t05-process-verification.json).

| Check | Result |
| --- | --- |
| Full backend, compiled sequencer | 3,150 passed, 1 acoustic assertion failed; 932.89 s |
| Final Python focused regressions | 369 passed; 57.91 s |
| Final compiled-kernel IPC/lifecycle regressions | 46 passed; 11.83 s |
| macOS native process audio/meter matrix | 16 exact comparisons, K=1/32, 8,192 frames each |
| Linux ARM64 stock-binding process probe | 16 exact PCM/final-meter comparisons, K=1/32 |
| Native lifecycle stress | 100 cycles, all children/arenas released, stable FD count |
| Linux undersized shared memory | ENOSPC before child startup, clean rollback |
| Canonical CSD fixtures | All 90 unchanged |
| Ruff, whitespace, local documentation links | Passed; 126 links checked |

The full run preceded two final edge-case refinements: inheriting the last revision when a
request has no preparation callback, and refusing Start while another operation owns the
coordinator. Both are covered by the final Python and compiled-kernel focused suites, including
two added tests; the verification JSON retains the source hashes for each stage of validation.

The full suite is **not fully green**. The failure is
`test_tenor_saxophone.py::test_last_note_priority_wide_leaps_and_new_phrase[64]`: fundamental
spectral fraction 0.021102 against a required value above 0.03. That exact case passed in
isolated current and pre-T05 source trees; all 21 tests in the pre-T05 saxophone file passed.
Twenty additional direct native renders in each tree show acoustic variation but no repeat
of this failure. Executable CSD is identical; only the generated fixture UUID comment differs.
The exact full-suite failure remains unreproduced in isolation, so no causal conclusion or
fully passing full-suite claim is made. No instrument or test threshold was changed.

G5 execution semantics are verified for the tested macOS ARM64 lifecycle and native audio
workloads, with additional Linux ARM64 Docker Desktop audio correctness. These results do not
qualify integrated session recovery, realtime throughput or automatic selection.

### Remaining gates

T06 owns the session-facing renderer facade, live boundary actions, controllers/edits/auditions,
host MIDI, public status, browser cancellation/markers and automatic next-start recovery.
Normal session creation/start/restart and both CSD export modes are guarded against invoking
the coordinator. Single remains the default and fallback; diagnostic plans/artifacts still
say `selected_renderer="single"`, `execution_eligible=false`. No new environment flag exists.

T07 owns hierarchical cgroup leases, private/native RSS admission, performance measurements
and selection. No speedup, realtime refill deadline, latency or dropout claim is made by T05.
Historical T01/T02 baseline reports remain unchanged: the single hot loop/factory are unchanged
and its behavioral regressions run again. No new wall-time single/parallel comparison is claimed.
AMD64, native float32 builds, final-image builds, Linux lifecycle stress, browser soaks and
multi-session resource races remain unqualified. Windows is not qualified.

No UI/workflow, user manual, production examples or saved formats changed in T01–T05.
Frontend builds/screenshots and manual PDF regeneration are not applicable to this internal
execution work. Automatic admission and rollout remain disabled.

## T06 delivered work

T06 connects the process coordinator to real sessions through
[ParallelCsoundRenderer](../../backend/app/engine/session_parallel_renderer.py). Normal
`create_app()` and factory construction still return the original worker. An explicit
`SessionRendererOptions` application injection selects the facade; it additionally requires
caller-supplied costs and acknowledgement of unqualified execution before children can run.
There is no new environment flag, saved-performance setting or UI selector. This keeps T07's
measured admission/cgroup work separate from functional integration.

The facade keeps the existing parent scheduler, lane gate, controller revisions and boundary
queue across fallback. It advances the sequencer/router once per block, drains MIDI and
controls once, preserves late-event ordering, maps canonical meters and resamples once.
Live edits and auditions retain the persistent preparation service and idle/active boundary
semantics. Panic reaches all note assignments. Stop/delete/shutdown cancel startup before
waiting for lifecycle ownership, while disconnect cleanup retains reconnect precedence.
Generation and controller-lease checks withhold stale audio. Canonical validation precedes
optional partition preparation; auto can fall back after a preparation/start failure, but
invalid canonical input remains an error.

A worker failure during playback withholds the whole unfinished request, stops transport,
revokes the browser stream and reports `renderer_failed`. The browser clears queued audio and
transport markers and marks the session errored. Auto quarantines parallel use for that session;
the next explicit start uses the original single renderer from engine sample zero. There is
no replay or reconstruction of lost DSP state. Optional session diagnostics preserve the failed
committed/published cursors after cleanup. The ordinary single hot loop, shared compiler stage
lowering and both offline CSD export modes are unchanged.

### T06 verification

[Facade tests](../../backend/tests/test_session_parallel_renderer.py) exercise real native
PCM parity, meter timestamps, controls, resampling at 44.1/48 kHz, K=1/32, panic and fresh notes,
idle/active boundary actions, late MIDI, one authoritative CC revision, failed edits, cancellation,
startup fallback and next-start quarantine. API regressions in
[test_api.py](../../backend/tests/test_api.py) add live preparation/audition/mixer playback,
failed preparation retaining the old configuration, replacement controller leases, worker
failure, Start/Stop/delete races, unsupported graphs and canonical validation. Existing strict
renderer-interface/default-selection tests continue to guard the single path.

The production frontend build was exercised in Chromium through Playwright against a temporary
local server with explicit unqualified auto options and the versioned two-source native fixture.
The test used the real browser worker, SharedArrayBuffer and AudioWorklet, not a replacement
playback loop. Manual pads produced nonzero PCM through three child processes. Immediately
before crash injection, the shared ring held 15,872 frames. Failure reset all eight shared
state counters to zero, stopped transport and displayed the engine error. The failed request
had committed additional engine work but published no additional chunk. Restart through
**Start Instruments** kept the same session, selected single with `previous_parallel_failure`,
allocated fresh audio buffers and produced nonzero playback again. The observed restart ring
was primed to 86,400 frames with zero underruns in that new buffer epoch.

These are **functional observations, not performance qualification**. The parallel probe
showed repeated underruns and render/audio ratios around five, while other functional checks
were running. No controlled throughput, speedup or latency comparison is claimed. T07 must
measure and address synchronization overhead before any workload can be admitted automatically.
The existing default and fallback are therefore especially important.

Screenshots: [stopped after failure](../../screenshots/parallel-renderer-failure.png),
[playing after single restart](../../screenshots/parallel-renderer-recovery.png). They show the
existing device controls; no new selector or layout is introduced. User documentation/PDF and
README capabilities remain unchanged because parallel deployment is not enabled.

A Linux ARM64 Docker Desktop probe used the existing `visualcsound-browser-clock:local` image,
current backend mounted read-only, four CPUs, 1 GiB memory, 64 MiB shared memory and no network.
It produced nonzero native PCM through three processes, injected a crash, confirmed error and
complete worker cleanup, then restarted single at sample zero. This is not a newly built final
image, AMD64 verification, capacity admission or performance qualification.

Final counts, commands, raw browser/container observations and source hashes are retained in
[T06 verification](measurements/t06-session-verification.json). T07 capacity/performance and
T08 rollout remain pending. No default cutover is authorized by these results.

| Final check | Result |
| --- | --- |
| Full backend, compiled sequencer | 3,172 passed, 1 saxophone acoustic failure; 969.69 s |
| Final protocol/facade/API/lifecycle/default-interface regressions, compiled sequencer | 53 passed; 31.56 s |
| Final Python session, strum and lane-output checks | 92 passed; 21.30 s |
| Frontend lint/tests/production build | Passed; 118 files, 1,376 tests |
| Native ARM64 Docker session recovery | Passed; 3 processes, nonzero PCM, cleanup and fresh single fallback |
| Production Chromium failure/restart | Passed functional recovery; throughput unqualified |
| Ruff, whitespace and local Markdown links | Passed; 138 links checked |

The full suite began before the final optional-partition-preparation fallback, request preflight
validation, queued-render generation guard and MIDI source-identity bound. The final focused suites cover these additions,
including rejection of an old queued request before it can advance a restarted engine.

The full-suite failure is `test_tenor_saxophone.py::test_normal_register_is_tuned_and_releases_cleanly[32]`:
MIDI note 44 measured 102.9076 Hz, 15.3848 cents from expected, against a 15-cent limit.
The isolated current file also yielded 20 passes/one failure in that same case, with another
note outside tolerance. A temporary clean checkout of the pre-T06 commit reproduced the same
case failing (note 44, 15.3280 cents), with the other 20 tests passing. This establishes a
pre-existing acoustic failure; the full suite is not reported as green. No instrument,
compiler, single-worker or acoustic test threshold was changed.

The `make benchmark-runtime` launcher could not access the local uv cache. Its three modules
were run directly with the existing `.venv/bin/python`; all completed. Those smoke probes do
not qualify parallel DSP throughput. Historical T01/T02 evidence is retained unchanged.

The final source-boundary audit also widens only the internal MIDI source tag limit to 1,024
characters, preserving the existing 256-character session track IDs plus ownership prefixes.
The frozen schema and native API test now cover that maximum valid track identity.

Two [single-native](measurements/t06-single-native.json) / [repeat](measurements/t06-single-native-repeat.json)
runs reproduce T01's exact PCM, marker, meter, edit/control, final-state and canonical CSD
fingerprints across all 12 workload/rate combinations. Each uses the original three-round,
24,576-frame protocol. The first pass briefly overlapped the final Docker probe and had a
16.13% p99 outlier on tiny K=1. The clean repeat removes that outlier; no workload's p95 or p99
exceeds T01 by more than 5%. This supports unchanged single behavior; it does not qualify
parallel playback or establish a speedup. Raw timings and provenance are retained in both reports.

## T07 delivered implementation and stop/go decision

**G7 remains closed.** Capacity admission, the evidence predicate, runtime pressure counters,
profiling and paired measurement tools are implemented. No automatic workload/build is approved.
The default and recovery implementation remains `CsoundWorker`, and CSD exports are unchanged.
Correctness and useful throughput gains on deliberately oversized DSP fixtures are not enough
for realtime qualification. No buffer enlargement, speculative rendering, changed K value or
midstream fallback was used to obtain these results.

The [capacity module](../../backend/app/engine/render_capacity.py) resolves v1/v2 memberships
and mounts, intersects affinity/cpusets/ancestor quotas, checks memory/high-water and shared-memory
headroom and descriptor space, and records detection provenance. Unknown capacity fails closed.
Process-wide leases include pending/running singles, the downstream suffix and compiler/API
headroom; planning caps useful children and Start rechecks atomically. Stop/delete/shutdown and
failed starts release leases only after reaping native owners. Multiple simultaneous starts,
capacity shrinkage, memory/descriptor denial, retained ownership after failed cleanup, and
pressure cooldown are covered. See the [current budgets and scope](contracts.md#12-t07-capacity-and-performance-gate).

The [qualification gate](../../backend/app/engine/render_qualification.py) requires exact
runtime/artifact/plan identities, reviewed native correctness and final-image evidence, two
heavy workloads, >=20% p95 improvement, no p99 regression, matching browser settings and CPUs,
30-minute paired zero-underrun playback and no worse stress/recovery. No evidence is inferred
from synthetic planner costs. The internal diagnostic override still requires capacity admission.
There is no new deployment environment flag or UI selector.

### Underrun investigation

The [initial profile](measurements/t07-wakeup-profile.json) identified Darwin's emulated timed
semaphore waits: 2.794 seconds spent in semaphore acquisition while the coordinator rendered
32,768 frames (0.683 seconds of audio). The coordinator render call took 3.229 seconds. The
initial wakeup prototype reduced that profiled render to 0.524 seconds with exact audio/meters.
That prototype measurement preceded the final retained semaphore publication fence; it is a
bottleneck diagnosis, not the final uninstrumented speed measurement.

The final Darwin path uses a bounded nonblocking datagram to wake `select`, plus a semaphore
release/acquire fence publishing the shared samples/mailbox. Linux retains native timed
semaphores. Process death, stale/duplicate completions, cancellation, one-block ownership and
bounded cleanup still use the existing protocol. The [final native parent/child profile](measurements/t07-native-profile.json)
separates performKsmps/channel/IPC call costs from parent waiting. It was instrumented during
an image build and is not used for latency qualification; child profiles include startup/idle
waits. The standalone [profile tool](../../backend/tools/profile_partition_render.py) keeps this
instrumentation out of normal rendering and out of uninstrumented timing trials.

### Native paired timing

[Raw K=32 measurements](measurements/t07-native-paired.json) use macOS ARM64, native float64,
three timed trials of 98,304 frames with separate exact-behavior traces, fresh processes,
alternating arm order, 2,048 warmup frames and 512-frame requests at 48 kHz. A 512-frame
request represents **10.667 ms of audio**. Capacity was explicitly supplied to the local
diagnostic harness; production non-Linux capacity detection remains unknown/single.

| Workload | Single p95 / p99 ms | Parallel p95 / p99 ms | p95 change | Decision |
| --- | ---: | ---: | ---: | --- |
| Two sources, 8 voices/source, 4 filters | 4.676 / 4.809 | 8.594 / 9.594 | 83.8% slower | Keep single |
| Four sources, 16 voices/source, 32 filters | 125.224 / 127.218 | 73.713 / 75.004 | 41.1% faster | Both exceed realtime budget |
| Eight sources, 16 voices/source, 32 filters | 258.741 / 264.994 | 114.492 / 116.571 | 55.8% faster | Both exceed realtime budget |

The heavy fixtures have zero filter resonance to avoid cascading attenuation into silence.
Their purpose is to expose sustained DSP scaling, not to claim that this extreme workload can
play in realtime. All arms passed exact PCM, meters, transport markers, final-state and
canonical CSD fingerprint comparison. Traces reject silent/nonfinite output.

The [K=1 diagnostic](measurements/t07-native-k1.json) uses the two-source fixture, 12,288 frames
and one timed trial. Single p95 is 9.838 ms versus parallel 191.995 ms per 512 frames. K=1
remains unqualified. The coordinator's per-block process synchronization is still too costly;
adding children or increasing browser queues does not solve that deadline problem.

### Production browser regression check

[Browser evidence](measurements/t07-browser.json) records production Chromium with the same
K=32 two-source graph and one looping lead, default auto/listening buffering and 48 kHz audio.
The initial prime was 86,400 frames in both runs; no queue setting was changed.

| Renderer | Observed playback | Underruns / overruns | Median render/audio ratio | Minimum queued frames |
| --- | ---: | ---: | ---: | ---: |
| Single | 169.16 s | 0 / 0 | 0.158 | 32,384 |
| Parallel, 3 children | 130.63 s | 0 / 0 | 0.720 | 22,144 |

Both remained audible and reported no playback errors. Parallel had one observed maximum
request ratio of 1.065, absorbed by the existing queue. This bounded regression check supports
the wakeup fix; it does not substitute for a 30-minute heavy workload soak, controlled stress,
input-to-audible latency qualification or Linux browser evidence. Test servers, data and renderer
options were isolated; the diagnostic CPU override was not enabled in ordinary application startup.

### Validation and compatibility

[Verification record](measurements/t07-verification.json): 3,221 backend tests passed and one
pre-existing saxophone tuning test failed (velocity 32, 15.233 cents versus a 15-cent limit).
T06 already reproduced that failure at pre-T06 HEAD; neither instrument nor threshold changed.
The full run includes the native parity matrix and 100-cycle ownership/leak test. Final focused
admission/facade/API checks passed 73 tests after the small final accounting corrections; the
Python-sequencer focused run also passed 73. The broader focused process/IPC/failure run passed
113. Backend lint passed. Frontend lint, all 118 files / 1,376 tests, and production build passed.
Docker builds passed, including the compiled sequencer and frontend build stages.

The [single baseline](measurements/t07-single-native.json) and
[repeat](measurements/t07-single-native-repeat.json) reproduce all 12 T01 PCM, marker, meter,
edit/control, final-state and canonical CSD fingerprints. The first run's tiny K=1 p99 is 5.79%
above T01; the repeat removes that case's excess. Timing outliers remain in the raw reports;
no case's p95 or p99 is >5% above T01 in both runs. The original single render loop is unchanged.

### Linux floating-point parity correction

The heavy Linux qualification trace initially rejected PCM hashes while meters, markers,
status, sample boundaries and canonical CSD matched. A [sample-level investigation](measurements/t07-linux-subnormal-investigation.json)
found 108 differing float32 values across 26,624 stereo frames, with maximum absolute error
7.91e-39. These were subnormal values: single rendering converted beside Csound in a thread
that flushes them, whereas the old parallel parent used its own floating-point environment.
The gate was not weakened to accept an epsilon.

The output child now publishes an additional float32 PCM slot alongside the unchanged
native-width final bus. Conversion occurs in the native thread; the parent still resamples
only once per completed request. A generation-bound scalar reports the native flush policy,
which the parent also applies to subnormals created by resampling, retaining signed zero.
The full slots/mailboxes remain within admission and completion checks. Fresh-process tests
cover tiny/subnormal signals at both 48 kHz and 44.1 kHz; running a reference Csound first in
the same process would mask this difference by changing that thread's floating-point state.

The native paired/profile/browser reports above preceded this final PCM correction and are
retained with their original source fingerprints. The correction leaves the single renderer
and CSD exports untouched. Final-build conversion regressions and measurements are recorded
separately below; earlier throughput observations are not promoted to release qualification.

### Container capacity and final-build results

The [actual cgroup matrix](measurements/t07-container-capacity.json) checks Docker Desktop
Linux ARM64 at 1, 2, 3.5, 4 and 8 CPU quotas. Fewer than four effective CPUs reject useful
parallel admission; four/eight permit it with reserved parent/compiler capacity. An eight-CPU
quota constrained to two CPUs by cpuset rejects admission. Separate 512 MiB memory and 3 MiB
shared-memory limits reject the requested lease. This matrix predates the PCM transport
correction; the capacity implementation is identical. Missing hierarchy data, v1 ancestors,
concurrent sessions, pending single starts and changing limits are covered by unit/API tests.

[Paired four-CPU container trials](measurements/t07-container-paired.json), after native-owner
PCM conversion but before the resampling-mode correction, use 2 GiB memory, 64 MiB shared
memory, K=32, 48 kHz, 512-frame requests and three trials of 24,576 frames. All separate
behavior traces match exactly, including canonical CSD. Actual admission uses three children.

| Workload | Single p95 / p99 ms | Parallel p95 / p99 ms | Result |
| --- | ---: | ---: | --- |
| Two sources | 8.167 / 8.345 | 12.740 / 13.628 | Parallel exceeds 10.667 ms audio budget |
| Four heavy sources | 260.402 / 264.211 | 146.450 / 147.436 | 43.8% p95 gain; both exceed budget |
| Eight heavy sources | 534.084 / 537.318 | 298.402 / 307.473 | 44.1% p95 gain; both exceed budget |

The [eight-CPU probe](measurements/t07-container-eight-cpu.json) confirms seven admitted
children and exact behavior for the eight-source graph. Its timing overlapped regression/build
activity, so it is exploratory and excluded from controlled performance conclusions. The
[container profile](measurements/t07-container-profile.json) is likewise instrumented diagnostic
evidence, not a qualification trial.

Final image `sha256:8bc06633220b74be73f78913540e04dea77239099bb6fb4d754d901238a99757`
contains both the native-owner conversion and resampling-policy correction, with Csound 6.18.1,
Python 3.13.18 and the compiled sequencer on Docker Desktop Linux ARM64. The final two-source
checks each use one timed trial of 24,576 frames plus a separate exact behavior trace:

| Platform | Single p95 / p99 ms | Parallel p95 / p99 ms | Evidence |
| --- | ---: | ---: | --- |
| macOS ARM64 diagnostic | 4.800 / 4.971 | 10.604 / 16.588 | [Final native](measurements/t07-native-final.json) |
| Docker Desktop ARM64, four CPUs | 8.199 / 8.453 | 13.767 / 16.647 | [Final container](measurements/t07-container-final.json) |

These short final checks verify the corrected build and preserve exact PCM/markers/meters/
status/CSD; they do not establish stable tail latency or replace long playback trials. The
final focused regression run passed **136 tests**, including the full native matrix, capacity,
qualification, process failures, session facade and API. Four fresh-process tiny-signal cases
also passed in the final Linux image at 48/44.1 kHz. As a negative control, the intermediate
image without resampling-policy handling fails the 44.1 kHz / 1e-36 amplitude case, confirming
that the regression detects the corrected behavior. The 100-cycle leak check passed in the
earlier full suite and was not repeated after the final PCM correction.

**Stop/go decision: retain diagnostic opt-in; no automatic classes are qualified.** The
two-source Linux parallel path remains slower than single and exceeds the audio deadline;
the heavy fixtures scale but cannot play in realtime at these settings. K=1 remains excluded.
Further synchronization/IPC optimization and controlled final-build measurements must precede
the required 30-minute heavy browser soaks, matched input-latency/stress probes and release
approval. Linux AMD64, bare-metal Linux ARM64 and native float32 Csound remain unqualified.
Capacity leases cover one API process and visible cgroup ancestors; arbitrary assets and
unrelated host/container processes are outside this admission guarantee. No realtime timing,
buffering or single/export behavior was changed to satisfy the gate.

## T07 continuation: synchronization and IPC

The internal parallel path now sends each sealed interval once. Children publish their
outputs directly to successor dependency fences; the parent validates every completion
before advancing the clock or reusing a slot. This removes parent wakeup/redispatch between
graph waves without adding render-ahead, batching, or an inter-partition sample delay.
Empty-event commands and replies use a 60-byte record bound to the validated bootstrap
digest, sequence, sample and control revision. MIDI/control-bearing messages and lifecycle
messages retain the full validated protocol. Cached native channel copies, meter readers,
shared views and process-sentinel polling remove repeated binding, layout and process checks
from successful blocks. See the [transport contract](contracts.md#13-t07-synchronization-and-ipc-continuation).

The single factory, its render loop, CSD exports, engine rates, `ksmps`, request sizes,
browser queue policy and two audio slots are unchanged. Duplicate dependency signals,
stale identities, failed children and incomplete blocks still fail closed. The parent
acknowledgement is published after all successor fences, so the global barrier can reject
leftover signals without racing a legitimate publication. Cancellation still reaps native
owners before freeing shared memory; a blocked successor cannot extend the stop budget.

### Controlled final-image measurements

Final image: `sha256:4d8770ba1a5e15bdcce523d2c94eab9287b5e6ebf31f3ffec36e739783c3e9f4`.
Docker Desktop Linux ARM64, Python 3.13.18, Csound 6.18.1, native double samples and the
compiled Cython sequencer. Timed jobs ran sequentially without builds, tests or playback.
Each main case has three fresh-process trials, 98,304 measured frames after 2,048 warmup
frames, and separate exact single/parallel traces. Requests remain 512 frames at 48 kHz
(10.667 ms of audio), with K=32. Four-CPU containers use 2 GiB memory; eight-CPU containers
use 3 GiB; both retain 64 MiB shared memory and actual cgroup admission.

| Workload / CPU quota / children | Single p95 / p99 ms | Parallel p95 / p99 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| Original two / 4 / 3 | 7.819 / 8.049 | 7.336 / 7.641 | 6.2% |
| Realtime two / 4 / 3 | 12.260 / 13.112 | 9.778 / 10.324 | 20.2% |
| Realtime four / 4 / 3 | 12.564 / 13.247 | 9.923 / 10.806 | 21.0% |
| Realtime four / 8 / 5 | 13.199 / 14.101 | 7.000 / 7.731 | 47.0% |
| Realtime eight / 8 / 7 | 14.893 / 15.400 | 8.273 / 8.758 | 44.5% |

Raw requests, process CPU/RSS, capacity observations, lifecycle costs and exact trace
fingerprints are retained in the [four-CPU](measurements/t07b-final-container-4.json) and
[eight-CPU](measurements/t07b-final-container-8.json) reports. All paired PCM, markers,
meters, status and canonical CSD fingerprints match; audio is finite and nonzero.
The new versioned realtime cases each have sixteen voices and six filters per voice,
distributed over two, four or eight source branches. They were frozen before their
measurements. They supplement, rather than replace, the original workload and stress cases.

A [fresh pre-change image control](measurements/t07b-before-container-control.json), using
the original two-source case and three shorter trials, measured parallel p95 at 12.498 ms
versus 7.336 ms in the final build: approximately 41% lower. Its single p95 was 8.334 ms;
the final single p95 was 7.819 ms. The different trial lengths and host variation prevent
treating that historical percentage as a precision estimate. The paired final-build
comparisons above determine useful scaling. In that control comparison, median parent CPU
time per parallel request fell from 3.326 to 1.189 ms; these CPU samples exclude child DSP.
Intermediate compact-message and direct-handoff
reports remain in this directory with their original provenance; they are diagnostic stages,
not evidence for the final image. The [final profile](measurements/t07b-final-container-profile.json)
is instrumented and includes child startup/idle time; its elapsed times are not qualification
percentiles.

The limits remain material. Four-CPU realtime-four p99 slightly exceeds one request's audio
duration, although it improves over single. Eight-CPU realtime-eight has a 17.970 ms maximum.
The [original oversized stress cases](measurements/t07b-final-container-heavy.json) still
take parallel p95 137.000/269.673 ms for four/eight sources on four CPUs. The
[K=1 counterexample](measurements/t07b-final-container-k1.json) takes 85.755 ms versus single
15.931 ms. Neither qualifies. The [macOS diagnostic](measurements/t07b-final-native.json)
also falls short of the 20% p95 benefit gate; its supplied diagnostic CPU budget is not
production capacity detection. A percentile below the audio duration is not a hard deadline
guarantee or a browser dropout measurement.

### Correctness and regression evidence

| Check | Result |
| --- | --- |
| Full backend suite, including 100-cycle cleanup test | 3,230 passed in 726.79 s |
| Final focused IPC/native/session/API suite | 101 passed in 76.57 s |
| Focused Python sequencer parity suite | 52 passed in 18.25 s |
| Final Linux native matrix, eight topologies at K=1/32 | 16 exact PCM/meter cases, clean ownership release |
| Final Linux fresh-process subnormal/resampling checks | 4 exact cases at 48/44.1 kHz and two amplitudes |
| Backend Ruff and final Docker build | Passed |

The [Linux matrix](measurements/t07b-final-container-correctness.json) covers independent
branches, shared effects, bypass, sidechain, custom ports and legato. The
[subnormal report](measurements/t07b-final-subnormal.json) checks native-owner float32
conversion and resampling. API parity now also verifies exact target frame/byte counts at
48/44.1 kHz for K=1/32 through live edits, controls and auditions. The existing Starlette/httpx
deprecation warning remains; the earlier T07 saxophone tolerance failure did not recur in
this full run. The final image differs from the full-suite snapshot only in a corrected
generic child-exit diagnostic; DSP, synchronization and timing code are identical.
The exact final sources also pass all 16 crash, corrupt-completion and bounded native-hang
regressions (6.55 s) after the playback measurements.

### Sustained browser playback and pressure

[Browser evidence](measurements/t07b-browser-realtime4.json) retains the production Chromium
Worker/AudioWorklet counters, authored fixture, actual prepared sixteen tracks, renderer
identity, warmup, settings, shared-ring capacity and raw observations. The
[harness](measurements/t07b-browser-harness/README.md) uses disposable databases and the
final image, with separate four-CPU, 2 GiB, 64 MiB shared-memory containers. Both use the
unchanged local `auto` settings and enter `listening`; the ring remains 288,000 frames at
48 kHz. Their normal adaptive refill behavior is observed, not replaced with the native
benchmark's 512-frame requests. No builds or test suites ran during playback.

| Pre-pressure playback | Single | Parallel |
| --- | ---: | ---: |
| Duration | 45.47 min | 30.40 min |
| AudioWorklet underrun count | 15,573 | 0 |
| Overruns / reconnects / reported errors | 0 / 0 / 0 | 0 / 0 / 0 |
| Minimum observed queued frames | 0 | 20,608 |
| Sampled render/audio ratio, median / p95 / p99 | 1.013 / 1.090 / 1.105 | 0.841 / 0.891 / 0.940 |

These are concurrent-session observations on a shared Docker Desktop/host, not isolated
physical cores or a paired latency distribution. Single started about fifteen minutes
earlier; its first underrun occurs near parallel startup. That overlap is retained and
prevents attributing the entire baseline failure to the renderer alone. Parallel retains
three children throughout and never falls back or reconnects. Both final sample peaks are
0.090532. By the end of the parallel soak the parent had recorded 13 over-budget requests
(including warmup), despite
zero browser underruns: the existing queue absorbed those tails. This is evidence of useful
realtime playback under these conditions, not a hard per-request deadline guarantee.

After saving those snapshots, each container received one busy process for 60 seconds
(59.995/59.953 CPU seconds), within its existing quota. No additional cgroup throttling
was observed. Parallel remained at zero underruns/overruns through pressure and more than
30 seconds of recovery observation; its post-snapshot minimum queue was 21,120 frames.
Single accumulated another 1,558 underruns across the post-snapshot interval. Since single
was already underrunning before the pulse, a matched clean-baseline recovery latency is
unavailable. This modest pressure test does not establish behavior under full quota
saturation, arbitrary background work, or multiple API-process admission.

The API's ordinary preparation path normalizes the fixture's master grid; the actual
prepared configuration is retained in both browser arms. Both receive identical authored
input, but these browser observations are not the lower-level benchmark's exact event
script. Headless AudioWorklet consumption does not measure sound-device or input-to-audible
latency. Both sessions stopped normally through the app; the two disposable containers and
test browsers were then removed.

**Stop/go: synchronization optimization delivered; G7 remains closed and single stays the
default/fallback.** Selected heavy K=32 cases now meet the native benefit threshold, and the
measured parallel app workload completes a 30-minute zero-underrun run. The conservative
evidence predicate still requires two clean paired heavy workloads; this baseline underruns
and only one heavy browser workload was soaked here. Matched live-input latency, a clean
paired stress/recovery comparison and deployment-specific platform qualification remain
unproven. No qualification records are installed, no threshold is relaxed, and no automatic
selection is enabled. The [verification manifest](measurements/t07b-verification.json)
records executed checks, exact unchanged default/export/browser sources and reproduction
commands. Further qualification should use independent sequential browser arms as well as
concurrent-session stress, without changing timing or buffer settings.

## T07 continuation: completed G7 browser qualification

**Decision: NO-GO for G7.** The requested second heavy soak and matched recovery/latency
experiments are complete. `realtime_2` passes the measured checks. `realtime_4` improves
median input latency and recovery but does not establish the required p95 latency limit.
Single remains the default/fallback, no qualification records are installed, and T08
release remains pending. This continuation changes measurement tooling and evidence only.

The [protocol](t07c-test-plan.md) was frozen before these probes. The
[reproducible comparison](measurements/t07c-browser-qualification.json),
[compressed raw observations](measurements/t07c-browser-data/),
[harness](measurements/t07c-browser-harness/README.md) and
[verification manifest](measurements/t07c-verification.json) retain the complete results.
The image remains `sha256:4d8770ba1a5e15bdcce523d2c94eab9287b5e6ebf31f3ffec36e739783c3e9f4`:
Docker Desktop Linux ARM64, Python 3.13.18, Csound 6.18.1, native double samples and Cython.
Each disposable container has four effective CPUs, 2 GiB memory and 64 MiB shared memory.
Both modes retain 48 kHz/K=32, local `auto` settings and the 288,000-frame browser ring.
No application sources, render request policy, timing, audio buffers or CSD exports changed.

### Sustained playback

New T07c arms ran sequentially, one test container/browser at a time, without builds or
unrelated tests. A ten-second startup/warmup is retained separately. The single control
for `realtime_4` was repeated without the earlier overlapping container startup.

| Workload | Single duration / underruns | Parallel duration / underruns | Provenance |
| --- | ---: | ---: | --- |
| Realtime two | 30.04 min / 0 | 30.04 min / 0 | Both new, isolated T07c arms |
| Realtime four | 30.04 min / 0 | 30.40 min / 0 | New isolated single; retained T07b parallel |

All four soak observations have zero overruns, zero warmup underruns and no reported errors.
The retained four-branch parallel soak still has T07b's concurrent-host caveat; it has not
been relabelled as a new isolated run. A fresh parallel four-branch session received a
62.40-second observation before its matched probes, not another thirty-minute soak.
The clean isolated four-branch single result supersedes neither nor erases the earlier
concurrent baseline's 15,573 underruns; it demonstrates why that overlap limited attribution.

For realtime two, sampled render/audio p95/p99 are 0.948/0.961 single and 0.812/0.840
parallel. The new realtime-four single values are 1.046/1.078 despite zero browser underruns:
the existing queue absorbs slow requests. Parallel stays selected with three children,
known four-CPU capacity, no failure and no fallback. The exact-image native performance
and parity reports from T07b remain applicable; no new native benchmark is claimed here.

### Matched recovery and live input

Each fresh arm received three 1.2-second container pause/unpause pulses. Each pulse retained
a fixed sixty-second observation; stable recovery requires ten subsequent seconds of full
audio consumption without another underrun. Command-time and output-clock bounds are
retained, and the analyzer rejects gaps, resets and nonfinite data. All twelve pulses began
cleanly, induced real dropouts and recovered within the observation window.

| Workload | Single / parallel underrun quanta, three pulses | Worst single recovery | Worst parallel recovery | Result |
| --- | ---: | ---: | ---: | --- |
| Realtime two | 899 / 887 | 353–405 ms | 288–316 ms | Pass |
| Realtime four | 1,045 / 920 | 16,215–16,258 ms | 336–390 ms | Pass |

These are bounded-stall results, not proof of arbitrary quota saturation or multi-session
host isolation. An underrun count is the AudioWorklet's count of affected quanta, not a count
of separate audible glitches. Raw traces also retain exact missing-frame totals, partial
quanta, queue levels and output-clock mapping spread.

Latency uses timestamped MIDI through the production Worker with the same graph/native
owners, sixteen peak voices, muted but running background branches, and unchanged automatic
Live mode. A silent observation branch leaves the production output connection intact and
reads, never writes, the audio ring. Its separate diagnostic storage is not an audio buffer.
Every arm passed sixteen known-frame calibration pulses with zero sample error and retained
four warmups plus all 128 measured bursts, with no probe timeout or dropped observation.
Output time is estimated with `getOutputTimestamp()`; physical speaker latency is unmeasured.

| Workload / renderer | Mean ms | Median ms | p95 ms | p99 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Realtime two / single | 337.5 | 249.4 | 728.8 | 746.1 | 746.4 |
| Realtime two / parallel | 144.1 | 121.4 | 211.9 | 722.4 | 722.6 |
| Realtime four / single | 187.2 | 183.6 | 258.0 | 275.5 | 278.7 |
| Realtime four / parallel | 146.0 | 121.3 | 365.1 | 601.6 | 661.6 |

The frozen 10,000-resample comparison uses parallel minus single and a 0.667 ms native-block
margin. Realtime two's 95% mean interval is **−234.5 to −152.3 ms** and its p95 interval is
**−601.8 to −49.6 ms**: pass. Realtime four's mean improves (**−57.9 to −22.7 ms**), but its
p95 interval is **−47.7 to +230.9 ms**: inconclusive, never a pass. Its observed p95 is higher,
but this interval does not establish a statistically supported regression either.

Retained first/second-half single A/A comparisons show temporal variation: mean intervals
are +25.8 to +173.1 ms for realtime two and −30.7 to −0.4 ms for realtime four. These are
finite, sequential browser estimates with correlated runtime behavior, not population-level
latency guarantees. The whole latency phase (including setup/warmup/gaps) accumulated
106/18 underrun quanta for realtime two single/parallel and 323/22 for realtime four.
Between the first and last measured bursts those counts are 103/18 and 276/10 respectively.
The unchanged Worker increases its recovery queue by 120 ms per observed underrun, capped
at 600 ms. The large observed Live-mode queues and latency tails are consistent with that
existing recovery behavior. Fewer underruns and faster median response do not establish
the required tail-latency bound.

### Verification and release consequence

- 51 focused tests passed in 3.36 seconds: six new measurement-analysis regressions,
  existing capacity/qualification tests, and API default, admission-denial, failure and
  canonical-fallback regressions. The existing Starlette/httpx deprecation warning remains.
- Observer controls passed for stereo onset, silent output, calibration, quiet detection
  and bounded telemetry. Backend and harness Ruff passed. The full backend suite and
  native parity matrix were not repeated; T07b's exact-image evidence is explicitly reused.
- Post-soak/pre-probe private process-memory snapshots, including compiler/tracker processes,
  are 249.3/444.9 MiB for realtime two and 252.4/449.6 MiB for realtime four single/parallel.
  The fresh four-branch parallel snapshot follows its short observation, not a thirty-minute
  soak; these are snapshots, not new peak-memory measurements.
- All four test containers and browser sessions were removed after normal app stops.
  Existing user containers were left running. Source hashes verify unchanged production
  backend/frontend, including single/default/fallback selection, timing and export sources.

The original scalar `QualificationEvidence.rejection()` accepts both diagnostic numeric
aggregates. It does not contain the broader live-input latency criterion. The analysis
therefore also applies the frozen latency/recovery checks, and the four-branch result blocks
G7. These aggregate inputs reuse native benchmark identities for comparison only; they do
not register browser artifacts or approve a deployment. No threshold is relaxed or record
installed. The next performance work must address residual Live-mode underruns and their
latency tails under the existing timing/buffer contract, then repeat the matched qualification.
K=1, oversized heavy cases, original low-benefit cases, other platforms and native float32
remain outside qualification.

## T07 continuation: live-input latency tails and ten-minute qualification

T07d addresses four-branch Live-mode tails without changing musical timing or the browser's
buffer policy. The prior observations show sparse underruns followed by the Worker's existing
recovery queue increase (120 ms per observed underrun, capped at 600 ms). This is consistent
with the large tails; it does not establish that all tail variation comes from one cause.
The [frozen protocol](t07d-test-plan.md) uses the user's requested ten-minute soaks for every
new arm. It keeps the full recovery and live-input probes, reports uncertainty and leaves the
production evidence predicate's thirty-minute minimum unchanged.

### Investigation and implementation

Separate profiles identified repeated scalar NumPy calls, empty event-model construction and
native `spout()` wrapper construction. The final parallel-only change uses scalar finite checks
for meters, one immutable empty payload per control revision, and a validated native output
view borrowed for one Csound lifetime. Every block still drains authoritative events and runs
its boundary callback; MIDI/control blocks remain freshly validated. The child reads the view
only after native rendering, copies through the existing final slots, and releases it before
reset. Native float32 conversion, predecessor fences, global completion, failure handling,
request sizes and all queue/buffer capacities are unchanged.

Two synchronization experiments were rejected and retained as diagnostic evidence. Reversing
parent completion collection did not improve the median and worsened tails. A bounded 50 µs
semaphore spin increased parent CPU use and render time. Neither reached production code.
CPython's [POSIX semaphore implementation](https://raw.githubusercontent.com/python/cpython/3.13/Modules/_multiprocessing/semaphore.c)
already tries acquisition before blocking; an extra unconditional try is unnecessary. Native
output ownership follows the [Csound realtime I/O API](https://csound.com/docs/api/group__RTAUDIOIO.html).

The sustained control keeps all sixteen four-branch voices active and uses 3,072 frames per
request (64 ms at 48 kHz). In the final 200-request comparison, old/candidate p95 times were
60.16/54.67 ms and p99 times 67.82/60.92 ms; parent p95 CPU time fell from 7.31 to 6.07 ms.
The old repeat followed the candidate, and the earlier 100-request control also had a 60.76 ms
p95. These short native controls support reducing overhead, not a causal browser-tail claim.
Instrumented timings are explicitly excluded from qualification.

The candidate image is `sha256:b6829d569bcdd005db0c91b5361f710710f3085c96302fcacd29638ccead900d`,
a four-source-file overlay on the immutable T07b image. It retains the same Python, Csound,
Cython sequencer, frontend and dependencies. All runs use actual four-CPU cgroup admission,
2 GiB memory, 64 MiB shared memory, 48 kHz and K=32. There are three rendering children;
synthetic costs select a diagnostic plan but never bypass capacity admission.

### Native validation

The final image passed all sixteen exact audio/meter cases (eight topologies at K=1 and K=32)
and four fresh-process small-sample/resampling pairs. The paired benchmark separately matches
PCM, markers, meters, status and canonical-CSD fingerprints before timing three rounds per arm.

| Workload | Single p95 / p99 ms | Parallel p95 / p99 ms | p95 reduction |
| --- | ---: | ---: | ---: |
| Realtime two | 11.859 / 12.478 | 9.048 / 9.811 | 23.7% |
| Realtime four | 12.755 / 13.012 | 9.887 / 10.345 | 22.5% |

Requests contain 512 frames (10.667 ms). Both heavy cases meet the native comparison; occasional
maxima remain above the audio duration. Browser evidence is therefore assessed separately.

### Four-branch browser findings

The parallel arm completed 602.41 seconds with zero warmup/soak underruns or overruns and
no errors. All three rendering children remained selected, with no failure or fallback. The
matched single arm completed 602.40 seconds with 727 affected audio quanta, zero warmup
underruns and no application error. That count is lost/partial audio quanta, not separate
perceptual glitches. The unchanged single code had a clean historical T07c soak, so the new
losses also demonstrate run-to-run variation; these sequential controls are not dedicated
host isolation or a causal proof for every observed difference.

Recovery passed: the three forced interruptions produced 1,012/857 affected quanta for
single/parallel. Worst recovery bounds were 673–726 ms single and 282–337 ms parallel.
All six pulses started from clean local windows, induced dropouts and recovered within their
full sixty-second observations.

The parallel live-input probe **failed**, stopping before burst 107 because the foreground
had not been quiet for the required fifty milliseconds. It retained sixteen successful
calibrations, four warmups and 107 measured bursts. The next burst was not sent into an
ambiguous onset, and the failed attempt was not retried, discarded or topped up. The single
probe completed all 128 bursts. The report retains descriptive partial distributions but
refuses the frozen statistical comparison when either arm is incomplete.

| Four-branch renderer | Bursts | Mean ms | Median ms | p95 ms | p99 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Single, complete | 128 | 139.6 | 140.4 | 159.6 | 167.4 | 168.7 |
| Parallel, incomplete | 107 | 192.0 | 124.2 | 629.1 | 729.0 | 729.9 |

The whole input phase accumulated 201/106 affected quanta single/parallel. In the parallel
trace, seven increases occur during/gaps between measured bursts, followed by larger queues
and tails. A lower median and fewer total affected quanta do not satisfy the tail requirement.
The native overhead reductions therefore **have not resolved four-branch live-input tails**.
This result does not establish a statistically qualified regression against the prior build:
the samples are incomplete and historical browser runs are not a matched before/after trial.

### Second workload and scope of the result

Both two-branch arms completed 602.4–602.5 seconds with zero warmup/soak underruns or
overruns and no application errors. Sampled render/audio p95/p99 ratios are 0.962/0.983
single and 0.788/0.829 parallel. The corresponding four-branch ratios are 1.075/1.096 and
0.859/0.889. These are production-cadence diagnostic samples, not an exhaustive request trace.
All parallel observations retain three children, known four-CPU capacity and no fallback.

Two-branch recovery also passed: 961/819 affected quanta single/parallel, with worst recovery
bounds of 283–331 ms single and 228–278 ms parallel. All twelve recovery pulses across both
workloads retained their full observations and achieved ten seconds of uninterrupted consumption.

The two-branch parallel input probe also **failed**, before burst 81, for the same missing
quiet-foreground condition. It retained 81 measured bursts, four warmups and sixteen successful
calibrations. The single control completed all 128. No replacement attempt was run.

| Two-branch renderer | Bursts | Mean ms | Median ms | p95 ms | p99 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Single, complete | 128 | 434.3 | 484.6 | 736.4 | 747.4 | 747.8 |
| Parallel, incomplete | 81 | 167.7 | 123.2 | 371.5 | 722.1 | 722.1 |

Whole-phase affected quanta are 186/35 single/parallel for realtime two and 201/106 for
realtime four. Counts between the first and last measured bursts, including gaps, are 183/35
and 188/106 respectively. All 64 calibration pulses across the four arms have zero frame
error. The observer never changes the production audio connection or ring, and output times
remain browser estimates rather than physical speaker measurements.

The ten-minute assessment is **not passed for either workload** because both parallel input
probes are incomplete. Realtime four also fails the clean paired-soak condition. Separately,
the original scalar predicate reports `browser_soak_incomplete` using the actual 602-second
observations; no duration is fabricated to satisfy its unchanged 1,800-second minimum. That
predicate still does not test live-input tails. The latency failures block qualification even
within the shorter scope requested here, independently of the legacy duration requirement.

### Verification, artifacts and remaining work

- 130 focused tests passed in 107.96 seconds (430 unrelated API tests deselected), including
  native process/failure cases, session lifecycle, capacity, admission, fallback and API behavior.
  New regressions cover borrowed output freshness/cleanup, empty-block boundary/event/revision
  behavior across requests/restarts, and manual MIDI after silent API refills and restart.
  The native-view test passed again after adding the standard missing-binding skip guard.
- Nine measurement tests passed in 0.19 seconds, including three new archived-report controls
  for partial failure retention, invalid calibration and the complete-probe comparison.
  Observer controls, backend/harness Ruff, JavaScript syntax and diff whitespace checks passed.
  The full backend suite and frontend build were not repeated; the frontend/dependencies are
  the unchanged immutable base image. The existing Starlette/httpx deprecation warning remains.
- Post-soak private process-memory snapshots are 246.9/443.8 MiB single/parallel for realtime
  two and 248.1/453.8 MiB for realtime four. These include compiler/tracker processes and are
  snapshots, not peak-memory bounds. All tests use the same 288,000-frame audio ring.
- All four disposable containers and browser sessions were closed after normal app stops,
  including the two failed probes. Existing user containers were left running. Source hashes
  bind the four production changes to the final image and verify unchanged single/default/
  fallback selection, event/protocol settings, browser timing/buffers and export/compiler paths.
- [Browser comparison](measurements/t07d-browser-qualification.json),
  [native measurements](measurements/t07d-final-native.json),
  [exact native checks](measurements/t07d-native-correctness.json),
  [small-sample checks](measurements/t07d-subnormal.json), and
  [verification manifest](measurements/t07d-verification.json) retain the outcomes and hashes.
  The [harness](measurements/t07d-browser-harness/README.md), raw browser observations,
  failed runner logs and native diagnostics are versioned alongside them. No earlier evidence
  is overwritten or reused as a candidate browser run.

The retained implementation reduces measured native overhead while keeping ordinary rendering
single and preserving fallback, timing, buffer sizes and CSD exports. It does **not** establish
reduced four-branch browser latency tails. Further work must measure the remaining scheduling/
refill stalls under live input and repeat complete matched probes with the same timing contract;
changing recovery buffering or accepting partial samples would not demonstrate that result.
G7 and T08 rollout remain closed, with zero qualification records installed. K=1 performance,
other workloads/platforms, native float32 and shared-host isolation remain outside qualification.

## G7 scope amendment and controller-sequencer fan-out

On 2026-11-07, after the T07d measurements, the user explicitly made live-input latency
non-blocking for G7. The [current acceptance criteria](acceptance.md#7-performance-measurement-and-gates)
now prioritize scheduled playback, exact event timing and controller delivery. The failed
live-input observations and original T07c/T07d decisions remain historical evidence under
their frozen protocols; they are not current live-input vetoes. This clarification installs
no qualification records, changes no production predicate or duration data, and enables no
renderer selection or release automatically.

Controller sequencers already run once in the parent and emit the same value on every
configured target MIDI channel. `PartitionRenderCoordinator` broadcasts the complete ordered
MIDI batch to every child for the same engine interval; local instrument-number remapping
does not alter MIDI channel numbers. Named mapped performance-control writes go only to their
subscribed owners after the parent applies channel/CC routing and revisions. Sharing a
controller sequencer therefore does not by itself force DSP branches into the same process.
See the [controller fan-out contract](contracts.md#15-controller-fan-out-and-g7-priority).

A new versioned [fixture](../../backend/tests/fixtures/parallel_render/controller_fanout.json)
and [native regression](../../backend/tests/test_parallel_controller_fanout.py) verify step
and curve sequencers controlling CC 74 on channels 2 and 5. Four instruments read channels
2, 5, 2 and 7; the two channel-2 readers must reside in different processes. The test verifies
native parallel selection, matching ordered events/sample intervals and audio against single
rendering, audible response in all targeted instruments, an unchanged untargeted channel,
and step Start/Stop resets. Instantaneous peaks verify reset silence without treating normal
RMS-meter decay as continued audio.

Validation: 64 tests passed with the Python sequencer and 64 with explicitly requested Cython
(8.62 seconds each), covering the new native fan-out cases and existing step, curve and
performance-controller MIDI tests. The existing Starlette/httpx deprecation warning remains.
Ruff and diff whitespace checks passed. These are native host correctness checks, not new
Docker performance qualification or browser soaks. No production renderer changes were
needed for this verification; default/fallback single, timing, buffer sizes and exports remain
unchanged by this follow-up.

## T07 continuation: ten-minute G7 completion with live input non-blocking

The user explicitly requested G7 completion using ten-minute runs and non-blocking live-input
latency. The [T07e protocol](t07e-test-plan.md) was frozen before new measurements. It changes
the evidence minimum from 1,800 to 600 seconds per matched arm and requires zero parallel
warmup/soak underruns while retaining single baseline losses. This aligns the scalar gate
with the intended baseline comparison, with a stricter zero-loss requirement for parallel
even when single drops audio. Noninteger, negative and nonfinite loss counts are rejected.
Native benefit, p99, correctness, settings/build identity, capacity and recovery gates remain.
No qualification records are installed and no deployment/default cutover occurs.

The only changed production source is `render_qualification.py`. The candidate overlays
T07d with that policy and reusable native controller-test support. Native benchmark provenance
confirms all other application source hashes match T07d; synthesis, synchronization, browser
code, timing, buffer sizes and CSD export paths are unchanged. The single path remains the
factory default and compatibility fallback. A new API regression verifies that numerically
passing ten-minute evidence from another build cannot authorize parallel startup or allocate
children/shared audio. The full backend suite passed **3,260 tests in 723.02 seconds**;
controller-focused suites passed **64 each** with Python (9.40 s) and Cython (9.32 s).
Only the existing Starlette/httpx deprecation warning appeared. Ruff passed.

On the frozen Docker image, all sixteen native audio/meter comparisons passed exactly at
K=1 and K=32, all four tiny-sample/resampling pairs matched, and both step/curve controller
fan-out cases passed. The controller cases verify four native owners, matching event samples
and values on channels 2 and 5, two channel-2 readers in separate processes, untargeted
channel 7 isolation and step reset behavior. This correctness probe supplies a larger CPU
budget to force ownership separation; timed browser/native benchmarks use actual cgroup
admission with four CPUs and three rendering children including the suffix.

The fresh paired native benchmark uses three rounds of 98,304 frames per workload/mode,
512-frame requests, separate fresh processes and alternating order. Both heavy workloads
pass the >=20% p95 gate with no p99 regression; separate traces match PCM, markers, meters,
state and sample cursors exactly. Report-analysis controls pass 25 tests and the unchanged
silent observer controls pass. Existing recovery-analysis regressions are included in the
full backend suite. No test/build/benchmark overlaps the browser measurements.

T07e **did not pass**. Its four-branch pair completed ~602-second clean soaks and passed
matched recovery (987 single versus 897 parallel induced underruns; worst recovery bounds
412–454 ms single versus 278–332 ms parallel). The two-branch parallel arm then accumulated
183 warmup underruns and continued dropping audio from startup despite ample CPU quota.
Scheduling samples found both independent owners mostly on virtual CPU 0 (19/20 and 15/20
samples), although their allowed masks were 0–11. This is a playback failure, not a waived
live-input latency observation.

The already-failed arm received a recorded diagnostic CPU-placement intervention: native
owners were assigned CPUs 0, 1 and 2. Render/audio ratio fell from about 1.07 to 0.64 and
underruns stopped accumulating at 9,847 before the intentionally disruptive recovery phase.
The complete ten-minute observation and intervention timestamp are retained. Neither its
post-intervention interval nor recovery is qualification evidence. The remaining planned
single-two arm was cancelled because a new candidate was necessary. T07e's successful
four-branch data is not reused to qualify the replacement build.

The [T07f protocol](t07f-test-plan.md) prospectively requires four fresh matched arms with
the same thresholds and settings after a startup-only Linux CPU-placement fix. The
[placement contract](contracts.md#16-linux-worker-cpu-placement) covers atomic process-wide
reservations, affinity verification, retained ownership on failed cleanup and single fallback.
No blocking playback criterion is relaxed after the failed T07e arm.

## T07 continuation: Linux CPU placement and fresh G7 qualification

The [T07f protocol](t07f-test-plan.md) responds to T07e's observed CPU colocation. The
new [placement pool](../../backend/app/engine/render_cpu_placement.py) reserves distinct
allowed logical CPUs across parallel coordinators in the API process, before spawn. A
native owner verifies and applies its placement before compilation and Ready. The parent,
compiler and default single renderer retain their affinity. Reservations survive unfinished
operations/cleanup and release after all native owners are reaped. Existing admission still
limits quota, preparation/API headroom, memory and process counts; placement adds no capacity.
Unsupported platforms keep their prior scheduler behavior, and Linux placement failures
follow existing startup failure/single fallback. No audio-loop affinity operations are added.

The first focused run caught a new startup error label outside the existing protocol enum.
This was corrected to the existing `start` code before any candidate measurements; no schema
or frontend contract changed. The corrected suite passed **160 tests, 429 deselected, in
111.00 seconds**, covering placement races, cpuset changes, startup failure, retained ownership,
100-cycle native lifecycle, session integration, controllers, capacity, evidence and selected
API fallback/default cases. The earlier full backend run of 3,260 tests and 64 tests per
sequencer kernel belongs to T07e, before placement; the affected suites were reverified here.
Ruff passed. The existing Starlette/httpx deprecation warning remains.

On the final image, all sixteen native audio/meter cases again pass exactly, all four tiny-
sample/resampling pairs match, and both controller-sequencer modes pass. Native placement
probes verify disjoint live coordinators, reuse after Stop, unchanged parent affinity and
reaping/release after a child's placement denial. The six-owner probe intentionally bypasses
session capacity admission for correctness only. Timed tests retain actual four-CPU admission
and three rendering owners. Report/measurement controls pass 41 tests (26 report checks,
6 shared measurement checks and 9 precision-recovery checks), and the silent observer controls pass.

Fresh native three-round results pass: p95 improves **20.8%** for `realtime_2` and **25.3%**
for `realtime_4`, with no p99 regression. All workers have distinct singleton CPU masks.
Separate traces match single audio, markers, meters, status and sample cursor exactly; their
fingerprints also match the earlier T07e traces, including canonical CSD. Compared with the
T07e image, only `csound_process.py`, `parallel_csound_renderer.py` and the new placement
module change among production sources. Timing, request/buffer sizes, controller semantics,
CSD exports and default/fallback single behavior remain unchanged.

**Final decision: G7 passes for the measured Linux ARM64, four-CPU, 48 kHz/K=32 workload scope.** The [qualification summary](t07-qualification-summary.md)
records the full result table, immutable image, source/report identities and limits. All four
fresh arms ran for about 602 seconds; parallel warmup/soak losses were zero in both workloads.
Single two had zero losses; single four had 985, retained as baseline observations.

Four-branch recovery passed its original three-pulse comparison. Two-branch recovery had
fewer induced losses but overlapping worst-time bounds, so its original result remains
inconclusive in the retained original report. The [prospective extension](t07f-recovery-extension.md)
collected exactly six more pulses per renderer with narrower Docker control uncertainty,
in reverse single-then-parallel order. The final comparison retains all nine trials per arm;
no slower observation was dropped or replaced. See the summary for actual combined bounds.
The extra observations are recovery-only and do not replace or shorten the ten-minute soaks.

All final arms passed ordinary Stop/resource cleanup, with no application errors, overruns
or parallel fallback. Single remains default/fallback; buffers, event timing and CSD exports
are unchanged. The historical failed live-input probes stay non-blocking and are not claimed
as current-image measurements. No qualification records are registered and T08 is not enabled.

Raw reports, logs and replay harnesses are retained locally in the ignored measurements
folder. This summary records their report/manifest hashes and explains this storage
limit. The task did not modify the externally changed ignore rules. Historical T07d hashes
are verified unchanged.


## T08: qualified public opt-in and CPU status line

Implemented a stopped-session Perform checkbox and `renderer_mode=auto` API request,
retaining default `single` construction and existing startup/next-start fallback. Operator
catalogs supply exact input/cost/policy/build/plan/artifact/browser-setting qualification;
clients cannot grant eligibility. Invalid/missing/old-build evidence and capacity denial
remain single. The deployment switch is rechecked at preparation/Start, without replacing
an active renderer. No default cutover, persisted-data change or CSD export change is made.

The narrow fixed Perform footer samples Linux CPU load outside rendering. Parallel reports
total logical-CPU load on verified assigned CPUs; unpinned single reports server-process
usage. This includes other work and is labelled accordingly. Unsupported/missing readings
are unavailable, never zero. Per-session one-second caching bounds procfs sampling; polling
is sequential, stopped on unmount/hidden tabs and isolated from global store/audio updates.
Observation does not touch transport, controls, the sample cursor or idle-session activity.
The requested color ranges leave 50–60% unspecified; orange covers >50..85%, green <=50%
and red >85%. Labels, tooltips and integrated help cover all four GUI languages.

Initial integration checks caught numeric coercion changing cost-plan digests; catalog
records now preserve integer/float representation through strict bounded models. Native
public-path tests prove matched selection, plain-worker defaults, canonical parity, stopped
ownership cleanup and rollback. Fabricated test evidence is explicitly not qualification.
The prospective [T08 protocol](t08-test-plan.md) governed new-image checks. G7 and G8 pass
within the scope and identities in the [release summary](t08-qualification-summary.md): native
p95 improved 24.6%/25.0%, both 600-second parallel soaks had zero losses, and matched recovery
passed without an extension. The four-branch single baseline retained 1,235 underrun blocks.
All four soaks included the visible CPU observer. Native/browser graph and compiled identities
matched; all native parity/controller/ownership probes passed.

Full verification: 3,296 backend tests, 119 frontend files/1,384 tests, frontend lint/build,
backend Ruff, Docker build and 37 measurement-analysis tests passed. Actual public UI checks
on both catalog profiles selected qualified parallel without diagnostic injection, verified
single defaults/override, changed-settings fallback, disabled active switching and cleanup.
The deployment rollback switch was exercised in a fresh server. Screenshots cover desktop
and narrow layouts; the English manual was regenerated and inspected.

Public verification initially combined previous-session Stop diagnostics with new playback.
The retained failed attempts exposed the unchanged default Stop handler's MIDI-channel-0
validation warning for continuous instruments. Evidence now records that warning separately;
new parallel sessions have no audio errors or losses. This existing warning remains outside
T08's changes. The catalog uses conservative 896/960 MiB private-memory admission budgets,
separate from measured snapshots and cgroup peaks. Its report digest binds the complete raw
qualification report. No old runtime identity or fabricated test record authorizes the release.
