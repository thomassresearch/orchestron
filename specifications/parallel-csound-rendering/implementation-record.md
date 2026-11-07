# Parallel rendering implementation record

Updated: 2026-11-07. T01–T07 implementation delivered through the explicit internal session opt-in. G7 performance qualification has not passed; T08 release and default cutover remain pending. Normal application startup still constructs the original `CsoundWorker`; no deployment selection flag is enabled.

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
