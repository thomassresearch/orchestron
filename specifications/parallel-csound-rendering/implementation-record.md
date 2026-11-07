# Parallel rendering implementation record

Updated: 2026-11-07. T01 baseline/contracts, T02 renderer interface, T03 pure planner and T04 internal realtime compiler delivered. T05–T08, all parallel execution gates and default cutover remain pending. The shared factory still constructs the original `CsoundWorker`; no process pool, parallel renderer or runtime selection flag is active.

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

## Pending qualification and next task

T05 can introduce persistent child lifecycles, shared audio buffers and the parent coordinator
using the sealed-block timing contract. Native initialization must validate the runtime ABI
and artifact identity before bus use. A child receives ordered MIDI and owned control writes;
it must not acquire a sequencer, lane gate or controller revision counter. Keep single as the
default and fallback, and do not infer execution admission from a T04 diagnostic artifact.

T07 still owns hierarchical cgroup capacity detection, resource admission and native container
qualification on supported architectures. Browser latency/underruns, long soaks, concurrent
sessions, native memory/IPC overhead, child failures and cross-process parity remain unperformed
because no parallel execution implementation exists yet.

No UI/workflow, user manual, production examples or saved formats changed in T01–T04.
Frontend builds/screenshots and manual PDF regeneration are not applicable to this internal
compiler and native test harness. Full platform qualification remains in the later gates.
