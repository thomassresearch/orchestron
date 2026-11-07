# T01 baseline and frozen contracts

Status: T01–T06 contracts, updated 2026-11-07. [Internal models](../../backend/app/models/render_protocol.py) define the structural protocol. Default sessions still use the original single worker; the explicit T06 application injection is described below. [Implementation evidence](implementation-record.md) distinguishes functional integration from pending performance/admission qualification.

## 1. Current ownership inventory

| Owner/caller | Operations and state that T02 must preserve |
| --- | --- |
| `RuntimeSession` and `SessionService.create_session` | Construct one `CsoundWorker` through the shared factory (T02); session lifecycle, configuration locks, generation and closing/stopping flags stay in the parent |
| Session compile/start/stop | `is_running`, `start`, `stop`, `configure_mixer`, `performance_controllers.configure`, canonical `CompileArtifact`; no parallel compile response |
| Session render path | `browser_clock_ready`, `backend`, `runtime_sample_rate`, `runtime_ksmps`, `render_sample_cursor`, `render_blocks`, meter/controller draining |
| Browser-clock lease and timestamp projection | Same committed engine cursor and engine rate; browser queue reports are observations, not rendering authority |
| `SessionPerformanceRuntimeCoordinator` | Creates one render-driven sequencer and MIDI router, binds `enqueue_timestamped_midi`, cursor and `lane_output` |
| MIDI input/binding service integration | Direct MIDI capability/output adapter and timestamped events; retain provenance, lateness, quotas and source identity |
| Mixer/performance-controller operations | `queue_mixer_controls`, `queue_control_channels`, controller values/mapping revisions; derive values from the whole graph |
| Device transport, lane output and auditions | `run_at_render_boundary`, `release_lane_events`, lane gates and current transport state; preserve independent manual devices |
| Panic and shutdown | `panic`, live-input state reset, stop/cleanup and lifecycle ownership; do not invent transferable native DSP state |

The [T02 interface](../../backend/app/engine/realtime_renderer.py) also includes the existing `audio_output_mode`, `runtime_channels`, `accepts_direct_midi`, `midi_output` and `midi_overflow_count` properties. Inventory is grounded in [worker](../../backend/app/engine/csound_worker.py), [session service](../../backend/app/services/session_service.py), [performance coordinator](../../backend/app/services/session_performance_runtime.py), [runtime dataclass](../../backend/app/engine/session_runtime.py) and their tests. Private members accessed by diagnostic tests are not public interface requirements.

T02 uses structural conformance rather than a forwarding wrapper: the factory returns the same concrete worker, whose render loop and synchronization are unchanged. `EngineStartResult` and `EngineRenderResult` now live beside the interface and remain importable from `csound_worker`; their fields, defaults and mutability are unchanged. No policy selection, child execution or runtime migration is introduced. Native binding absence retains the existing mock fallback; native compilation/start errors remain errors.

## 2. Observed timing contract

For `[S, S + K)`, the existing worker applies queued boundary actions, calls `before_block`, drains eligible MIDI, delivers mapped performance-controller values, applies pending host control writes, calls `performKsmps`, copies output, samples due meters, then commits `S + K`. Sequencer advancement precedes arpeggiator advancement inside `before_block`.

- A target timestamp strictly less than block end is due. A timestamp exactly at block end belongs to the next block. With K greater than one, events within a block are delivered together; preserve this quantization.
- Ordering is `(original target_engine_sample, sequence)` before late-event clamping. Two overdue events can collapse to the same delivered sample while their sequence numbers are descending; never re-sort the drained array. Lane gating may add repeated identical releases; protocol validation must not deduplicate these events.
- An event arriving after the MIDI drain is delivered in a later block. When its target is before that block's start, the scheduler clamps the target and marks it late. The cursor observed during native rendering remains S.
- The empty MIDI hint is an optimization, not an acceptance guarantee: arrival after that check can defer delivery. Explicit barriers in tests establish race ordering without sleeping.
- Pending host control writes coalesce by channel. A write arriving after the control dictionary is swapped waits for the following block. MIDI and GUI controls have separate decision points; sealing must follow both snapshots, not move GUI acceptance before MIDI delivery.
- A boundary action enqueued during action draining waits for the next boundary. The action runs in the parent. The current `run_at_render_boundary` caller also takes render ownership before returning, so callback application and caller response are not necessarily simultaneous during a multi-block request.
- When no audio is requested, `run_at_render_boundary` obtains idle ownership and completes. Native channel writes still take effect when the next block is performed.
- Stop serializes with rendering; old response publication also relies on service/controller checks. A new coordinator must add explicit epoch rejection without claiming the old renderer already has epochs.
- The worker commits every completed block, but the service sends PCM only for a completed request. A failing request can therefore leave committed native work that was never published. Failure handling cannot replay that work in the same native instance.

Tests cover native onset/CC sample levels at K=1 and K=32, half-open intervals, same-sample event order, post-drain lateness, current cursor, control-drain races, pending actions and real API live preparation. See [baseline tests](../../backend/tests/test_render_baseline.py), [worker tests](../../backend/tests/test_csound_worker.py) and [API tests](../../backend/tests/test_api.py).

## 3. Initial protocol version 1

The frozen Pydantic union is `RenderMessage`; its generated schema is [protocol.schema.json](protocol.schema.json). T05 initially uses length-prefixed UTF-8 JSON control records in fixed shared-memory mailboxes, with identical fields and invariants. T07 additionally encodes empty-event blocks as compact records bound to the validated bootstrap; see [the optimized transport](#13-t07-synchronization-and-ipc-continuation). Audio stays in native binary arrays. No pickled callbacks, service objects or Csound pointers are permitted in commands.

Every envelope carries an explicit version, positive epoch, partition identity and 64-character plan SHA-256. All records reject extra fields, coercion of string numbers and nonfinite floats. Frozen tuples prevent post-validation mutation of events/control arrays.

| Message | Payload beyond the envelope | Meaning |
| --- | --- | --- |
| INIT | `artifact_hash`, `engine` | Select pre-provisioned immutable CSD and bus-resource manifest; native compile/start begins |
| READY | Same artifact digest and actual engine format | Parent verifies exact handshake before any render; a mismatch fails startup |
| RENDER | Block identity, slots, ordered `midi`, coalesced `controls` | Render exactly one sealed global block |
| DONE | Exact block identity and owned slot generations | All outputs published before completion notification |
| ERROR | Bounded code/detail, last fully completed sequence or -1 | Child reports failure; parent invalidates the epoch and coordinates shutdown |
| STOP | Envelope only | Stop the identified epoch; superseding epochs cannot be affected |
| STOPPED | Envelope only | Native instance closed; parent can reclaim resources after all owners are reaped |

`engine` is `(sample_rate, ksmps, zero_dbfs, native_sample_type)`. A block identity is `(sequence, sample_start, frame_count, control_revision)`; `sample_end = sample_start + frame_count`. A slot is `(bus_id, slot in {0,1}, generation)`. MIDI includes authoritative sequence, source, clamped target sample, three channel-voice bytes and late flag. Controller writes carry channel and finite value.

Frame counts are structurally bounded, but the coordinator must additionally require `frame_count == plan.ksmps`, contiguous sample ranges, matching engine settings/revision and exactly the declared bus set. Structural validation alone does not verify stage ownership, valid resources, predecessor readiness, sequence/epoch freshness or correct native sample width. T03/T05 own those stateful checks.

Initial array ceilings are 2,048 bus slots, 16,384 MIDI deliveries and 16,384 control writes per descriptor. These are additional bounded IPC limits, not replacements for API quotas. In particular, deferred lane releases can expand a drained MIDI batch beyond its queue entry count: never truncate it. Preflight must prove supported bounds; unexpected runtime overflow stops the renderer with a diagnostic. Shared-memory manifests and CSD contents are created by the parent outside block messages, validated before allocation, and bound to the plan/artifact digests.

## 4. Initial policy bounds

`RendererPolicy` freezes these defaults for future integration; no environment variable or renderer selector is wired in T01. T02 keeps the single renderer. T07 may revise experimental resource/time defaults only with recorded measurements and a contract update.

| Field | Default | Accepted range |
| --- | --- | --- |
| mode | single | single, auto, parallel |
| max_workers | 8 | 1–64, further restricted by capacity/graph |
| max_shared_memory_bytes | 64 MiB | 1 KiB–1 GiB, within admitted container memory |
| startup_timeout_seconds | 30 | 1–300 |
| stop_timeout_seconds | 2 | 0.1–30 |
| render_timeout_seconds | 5 | 0.1–60 |
| slots_per_bus | 2 | Fixed at 2 |
| max_inflight_blocks | 1 | Fixed at 1 |

The render timeout is a failure watchdog, not an audio deadline or permission to buffer five seconds. Existing browser queue/request limits stay authoritative. Rendering must meet the actual refill budget to qualify. Capacity detection cannot infer available cores from these maxima.

Fallback semantics are frozen: unsupported/insufficient/unqualified auto plans select single before playback; a pre-playback child startup failure cleans up before at most one canonical single start; invalid patches/assets remain errors. Active child failure causes coordinated stop and next-explicit-start fallback, never live state transfer. Explicit parallel diagnostic mode fails preflight rather than silently reporting a single run as parallel.

## 5. Resource eligibility inventory

This is the conservative T01 seed classification, not a production allowlist. Section 8 records the implemented T03 resource analysis. No native build or workload is currently qualified for automatic parallel selection. Unlisted opcodes and external plugins remain unknown.

| Family and current evidence | T03 disposition | Required qualification |
| --- | --- | --- |
| Constants, arithmetic, compiled branch-local formulas | Candidate local | Pure source emissions and no outside state; preserve graph order/formulas |
| Baseline `vco2`, `moogladder`, `delay`, `cpsmidi`, `ampmidi` | Candidate per-instance/voice | T04 establishes exact sequential split parity for its fixtures on the local native build; broader combinations/builds require qualification |
| Mixer strip/route/ramp/meter stages | Candidate with owned host channels | Preserve pre/post, pan, bypass and meter order; whole-graph solo/sidechain controls |
| `midi_legato` | Co-location required | Generated collector/shared globals/panic listener must remain with synthesis; helper remapping |
| `maxalloc` | Co-location/reference mapping required | Compiler emits a literal allocation cap for the local synthesis instrument; never duplicate cap per voice shard |
| GEN, `ftgen`, `ftgenonce`, explicit table numbers | Unknown until read/write analysis | Table namespace and creation order can be shared; no automatic renumbering |
| `sfload`, `sfplay3`, `sfinstr3` | Unknown until resource proof | Current compiler deduplicates by filename; process-local handles and memory multiplication need verification |
| `ctrl7`, `midictrl`, `initc7`, generated MIDI readers | Subscription analysis required | Note channel alone does not describe controller consumption/initialization |
| Random/noise opcodes | Unknown until per-family audit | Repeated single output is not proof of process-independent RNG streams |
| Custom waveguide/granular helpers | Candidate private state, still unqualified | Source declares private RNG and granular temporary tables; lifetime, initialization and audible parity still need native proof |
| Arbitrary plugin/global channels, instrument scheduling/cross-instrument queries | Unknown | Explicit shared-state and reference audit or single fallback |

Source anchors: [orchestra emitter](../../backend/app/services/compiler_orchestra.py), [mixer lowering](../../backend/app/services/compiler_mixer.py), [legato helpers](../../backend/app/services/compiler_legato.py), [granular helpers](../../backend/app/services/compiler_granular.py), [waveguide helpers](../../backend/app/services/compiler_waveguide.py). This task changes none of their opcode support or generated DSP.

## 6. Build capabilities and baseline fixture scope

The T01 local native baseline used Csound 6.18.1 through the repository's `DirectCsound` binding. Its public methods include `spout` and control-channel access, but not `audioChannel`, `setAudioChannel`, `spin` or `sizeOfMYFLT`. The actual output array reports float64. These observations are recorded in every baseline result. T04 now adds and tests `audioChannel`, `setAudioChannel` and `sizeOfMYFLT` (see section 9); stock ctcsound documentation is not proof of local wrapper support.

The loader currently binds its direct path using `ctypes.c_double`. Future admission must verify native sample width against the library ABI before allocating buses; dtype inspection alone is not an independent ABI check. The isolated Docker smoke run selected the stock binding and found the corresponding bridge methods available; its [record](implementation-record.md) identifies the exact image. T04 verifies sequential bridge semantics on the local Csound 6.18 double build. Other builds and container admission remain T07 qualification work.

[workloads.json](../../backend/tests/fixtures/parallel_render/workloads.json) freezes six synthetic cases at 48 kHz and K=1/32: tiny, two/four/eight independent sources, four sources with a shared delay, and one serial-heavy source. Every case uses the real LIVE mixer compiler, private delays, wet Master paths and an explicit dry Master bypass. Voices and filter depth are bounded by the fixture model. This is diagnostic test data, not an instrument example or starter.

Each run warms 2,048 frames, measures requests of 512 frames, applies a prepared tempo/note edit at measured offset 4,096, queues a gain change and future CC at offset 8,192, and measures at least 12,288 frames. The corresponding absolute edit/control samples are 6,144 and 10,240. Two separate trace runs must match exactly; uninstrumented native runs must match their PCM, marker, meter, edit and final-state fingerprints. Native compilation and hashing occur outside measured render calls.

Broader nonlinear shared effects, sidechains, bypass, legato, resource hazards and failure cases remain specified in [acceptance.md](acceptance.md); existing repository tests provide baseline behavior references. T01 does not claim those already have partitioned implementations or new executable parallel fixtures.

## 7. Reproduction

```bash
.venv/bin/python -m backend.tools.benchmark_parallel_render \
  --output output/parallel-baseline-a.json --rounds 3 --frames 24576
.venv/bin/python -m backend.tools.benchmark_parallel_render \
  --output output/parallel-baseline-b.json --rounds 3 --frames 24576 \
  --compare output/parallel-baseline-a.json
```

Use `--cases` and `--ksmps` for a focused run. Every trial spawns a fresh process, refuses mock fallback and records native capabilities. Reports retain raw wall/CPU render times and p95/p99/max, source/fixture hashes, git state, versions and CPU/affinity observations. The cgroup fields are raw observations, not the T07 effective hierarchical capacity detector. Set `ORCHESTRON_BASELINE_IMAGE_DIGEST` when measuring a known container image.

Results exclude API/WebSocket/browser service time, startup/compile time and actual audio-device latency. They neither establish end-to-end dropouts nor qualify a renderer. Keep builds and tests out of timed runs; compare A/A distributions before claiming a candidate regression or improvement. T01 retains the existing release thresholds without tuning them to these measurements.

## 8. T03 pure planning contract

The internal entry points are `CompilerService.analyze_realtime_graph(targets, audio_graph)`
and `plan_render_partitions(graph, policy=..., costs=..., sample_bytes=8)`. They return frozen
[graph/plan records](../../backend/app/models/render_plan.py), with no native calls, filesystem
asset reads, process starts, shared-memory allocation, CPU probes, or session mutations.
The caller supplies an already loaded opcode catalog, immutable per-stage cost evidence and
worker/memory limits. Actual compilation and asset validation remain mandatory before any
future start; analysis is not a compilation certificate.

`RendererPolicy()` defaults to single. Explicit `auto`/`parallel` arguments are diagnostic
planning requests, not environment settings or activation. A feasible proposal has
`layout="coarse"`; all results still have `selected_renderer="single"` and
`execution_eligible=false`. Unsupported graphs/resources, missing costs, small capacity,
insufficient concurrent work, expensive boundaries or a dominant suffix produce one complete
single partition with stable reason codes. No runtime/session path calls this planner yet.

### Graph and resource metadata

- Snapshot the full performance engine before sorting/partitioning. Preserve all resolved
  patch, bypass, strip, route, internal Master and `$output` stages. Legacy inputs stay in
  their original compile path; their diagnostic inventory covers patch instances without
  inventing mixer stages or migrating routing semantics.
- Instrument/note/helper references remain canonical single-orchestra references. T03 does
  not emit child CSDs or local instrument numbering; T04 emits and verifies separate local references (section 9).
- Record every LIVE `connect` in emission order, including both pre/post inputs, every
  polyphonic outlet contribution and dry/wet bypass edges. The metadata extractor is checked
  against canonical emitted connections; it does not parse CSD for analysis. T04 unifies this representation with canonical/partition connection lowering (section 9).
- [Resource analysis](../../backend/app/services/compiler_render_resources.py) uses compiled
  graph nodes, port/default definitions, formula validation and typed GEN/controller metadata.
  `coarse-compiler-resources-v1` narrowly audits the baseline compiler operations plus constants,
  MIDI readers, envelopes, `maxalloc`, legato and instance performance controls. Semantic
  opcode definition hashes prevent a changed template/port/default from inheriting an audit.
  Compiler/helper semantic changes require review and a capability-version update too.
- Unknown opcodes/plugins and unaudited helpers remain single. GEN lifetimes, table accesses
  (including optional `ampmidi`/`ctrl7` tables), SoundFont/other asset handles remain unqualified.
  Known numbered table references get explicit read/write records and co-location constraints;
  dynamic references use an unknown namespace. No tables or assets are silently renamed or
  replicated. Hashes bind asset identity/configuration metadata, not verified file contents.
- Keep a patch, its strip and bypass together; declared inserts remain with their owner.
  Each legato collector and `maxalloc` declaration has one owner. The current shared legato
  panic listener co-locates all its consumers. MIDI initialization conservatively co-locates
  its writers and MIDI readers. Host performance-control subscriptions are instance scoped
  and do not force unrelated branches together. Future partitions receive the full ordered
  MIDI stream; note assignment alone never permits pruning controller events.

### Partitioning and estimates

Co-location can produce cycles in the quotient of a valid audio DAG. Collapse these strongly
connected groups, absorbing intervening stages, then verify acyclicity again. Genuine audio
feedback/invalid ports are still compiler errors and are never converted to a successful
fallback. Propagate independent origins, put joins and all descendants into one downstream
suffix, include Master and its inserts, and keep disconnected work conservatively downstream.
Group each remaining whole branch and assign branches by descending estimated cost with
stable identity/slot tie breaks. The suffix consumes one worker slot; at least two upstream
groups with nonzero work are required.

Cost profiles cover every stage exactly once, with finite nonnegative per-block microseconds
and provenance. Helper/voice cost belongs to the declared owning stage. They supply total
dispatch overhead per partition and all bridge-copy overhead per transferred sample; no
cost is inferred from node count or learned by secretly running audio. The estimate is
`max(upstream loads) + suffix + dispatch + copies`. The default requested reduction is 20%,
an advisory planning filter, not proof of the native end-to-end release gate. Cost profile
order is canonicalized. Synthetic fixture profiles can produce candidates but cannot enable
execution or qualify a runtime.

Every cut connection retains a separate mono bus in original contribution order, with the
same `ksmps`, summed-outlet semantics and two slots. There is no intermediate pre-summing,
new block delay or independent resampler in this model. Audio-buffer estimates use an explicit
four/eight-byte sample width (eight by default); this does **not** prove the native ABI.
The planner enforces the requested shared-audio limit and conservatively caps total buses at
the v1 per-message ceiling of 2,048. These estimates exclude native instance/asset RSS and
IPC metadata, which require later admission work.

`validate_partition_plan` independently checks stage/helper coverage and single ownership,
co-location, canonical stage/connection order, local versus cut accounting, acyclic partition
dependencies, one shared suffix, control/meter subscriptions, bus formats/bytes, cost estimates
and the plan hash. Nested mutable inputs are rejected. Hashes include full immutable metadata,
ordered contributions, compiler capability, engine settings, resources, costs and limits.
Mixer gain/mute/solo/send tap/bypass values are not planner inputs: they never remove dependencies.

The [planner tests](../../backend/tests/test_render_partition_plan.py) and
[34 snapshots](../../backend/tests/fixtures/parallel_render/planner_snapshots.json) provide G3
evidence. Section 9 records T04 native lowering and local sample-width verification.
Inter-process timing/cleanup, container capacity discovery and performance qualification remain T05–T08 work.


## 9. T04 internal realtime program contract

`CompilerService.compile_realtime_partitions(targets, audio_graph, mixer, plan)` is an explicit
internal compilation API. It returns the ordinary canonical artifact plus either bounded
partition programs or reasoned single-plan fallback. It never starts native Csound or a child
process, allocates shared memory, selects a renderer or enters session compile/start/export.
Every result retains `selected_renderer="single"` and `execution_eligible=false`.

CSD here is an internal Csound program format for future **realtime playback** workers.
User-facing MIDI/SCORE CSD exports stay on the canonical offline path; parallel batch export
is outside scope. Ninety pre-T04 CSD hashes freeze LIVE/MIDI and OFFLINE/MIDI/SCORE text across
15 versioned graph cases at K=1/32. The fixture records its source commit; tests never read Git
or regenerate expected hashes.

Canonical compilation validates the original performance first, including assets and mixer
settings. The planner validator checks integrity/ownership and freshly derived dependency
metadata must equal the plan graph, including input identity and resource capability hashes.
A stale or malformed plan is an error. A digest binds the canonical artifact, plan, complete
program metadata and internal CSDs; the harness verifies it and stage/bus ownership before startup. Invalid authored inputs cannot become executable by
falling back. A valid single-layout plan retains its canonical artifact and emits no partitions.
Unknown/table/asset/legacy exclusions remain unchanged.

The shared `LoweredMixer` records typed header entries, scoped setup, stage names/bodies,
canonical references and ordered connections **before** rendering text. The canonical emitter
serializes these in original order. The partition emitter filters by ownership; it does not
split, parse or rewrite an already generated orchestra. Patch/controller/maxalloc setup and
legato collectors/panic listener remain with their declared consumers. The shared panic listener
still co-locates all legato sources; T04 does not relax that constraint.

Each cut retains one mono audio channel and one original connection contribution. An always-on
ingress instrument runs before local stages; an always-on egress collector runs after them,
reading the summed outlet including all voices. Both adapters read every input before publishing
outputs to avoid Csound inlet/outlet buffer aliasing. Every block writes every boundary bus,
including silence; no channel carries an old block forward. No bridge resampling, normalization,
float32 conversion, parent-side pre-sum or extra block delay is introduced. Final `$output` and
its meters have one owner. These are native audio channels, not allocated inter-process buffers.

Stable stage names preserve node/global/instance scopes. Patch MIDI assignments use local named
instruments; legato collectors retain their explicit numeric helper references. A separate
manifest maps every stage and note reference to its local numeric assignment, accounting for
helpers and ingress. Native tests compare those references against `nstrnum`. Canonical stage
comments in internal programs retain their original references and are explicitly labelled;
event delivery uses the local manifest. MIDI is an ordered full-stream broadcast to each instance;
only the owning instance allocates each note. Host performance controller writes follow declared
subscriptions, with parent mapping/revisions remaining outside the native instances.

The direct binding adds copy-based audio-channel methods matching the stock wrapper's buffer
arguments. Missing optional native symbols do not disable ordinary single rendering. Channel
copies check the library's `csoundGetSizeOfMYFLT`, exact buffer length, native dtype, contiguity,
alignment and output writability. The direct wrapper remains double-only; unsupported ABI widths
are rejected by the qualification harness before compilation/bus use. See the primary API
[attributes](https://csound.com/docs/api/group__ATTRIBUTES.html) and
[channel transfer](https://csound.com/docs/api/group__CONTROLEVENTS.html) contracts.

The sequential probe is a **development harness**, not a renderer implementation. It owns one
canonical native instance and sequential partition instances in a single process, independent
host-MIDI input buffers, and preallocated native-width bridge arrays. A sealed block receives
identical ordered MIDI and relevant control writes, then upstream stages and downstream stages
execute before the next block starts. Only final output is compared. It performs no scheduling,
revision counting, lane gating or resampling, and closes all instances after success, failure or
partial startup. Exact native samples and per-block meter readings are required: tolerance is
zero, with no alignment search or dropped warmup blocks. The fixtures exercise K=1/32, multiple
voices, silence, private/shared effects, nonlinear shared processing, direct/Master paths,
custom/multiple ports, send taps, mute/solo/pan/gain, bypass ramps, controller changes, sustain,
release, allocation caps and panic/retrigger ordering. A 44.1 kHz / 0dbfs=2 probe verifies the
full-performance engine rule.

This establishes compiler/bridge correctness for the tested local native build, not realtime
speedup, asynchronous acceptance, all audited opcode combinations or platform-wide admission.
The harness keeps one block in flight but does not implement IPC descriptors, epochs, deadlines
or coordinated failure publication. Those are qualified separately in T05. Container/native stock-binding,
AMD64, float32, browser soak and parallel process performance require separate qualification.

## 10. T05 process execution contract

`PartitionRenderCoordinator` is an internal execution API, not itself a `RealtimeRenderer`
implementation. Only explicit callers can invoke `start(compilation, plan)`; a diagnostic
artifact does not enable a session or imply admission. `renderer_factory` defaults to
`CsoundWorker`; the explicit T06 facade is the opt-in caller. Canonical compile/export paths and the single render loop are unchanged.
The coordinator deliberately has no automatic fallback or live state transfer. Startup
failure rolls back ownership before the caller can start the canonical renderer. Failure
during playback invalidates the epoch and withholds the entire incomplete request.

### Native ownership and IPC

- Explicit `spawn`, one persistent child/native instance per partition, no task pool or fork.
  Only the parent owns clocks, sequencer advancement, scheduler drains and controller revisions.
  Children consume ordered full MIDI broadcasts and only their subscribed control channels.
- Before allocating, validate plan/artifact integrity, ownership, stereo output, worker count
  and total shared bytes against both policy and plan limits. Total bytes include two native
  slots per cut bus, two final stereo slots, two float64 meter slots per worker, all mailboxes,
  CSD/bootstrap data, alignment and operating-system page rounding. Linux reserves tmpfs pages
  with `posix_fallocate` before writing, so insufficient `/dev/shm` capacity is a startup error.
  Private native RSS and cross-session resource leases remain T07 work.
- One parent-owned shared-memory segment; children attach without tracker ownership and never
  unlink. Small spawn arguments reference hashed, pre-provisioned bootstrap records, avoiding
  a potentially blocking large CSD pickle on the spawn pipe. No samples travel in messages.
- Each worker has a 1 MiB command mailbox and 256 KiB reply mailbox. T05 records are a four-byte
  little-endian length followed by strict UTF-8 protocol JSON. Array ceilings remain unchanged;
  the encoded byte ceiling is an additional limit. Oversize is a diagnosed failure before any
  worker dispatch, never silent event truncation. This control encoding is unqualified for
  realtime performance and may be optimized in T07 without changing the frozen semantics.
- Command/completion semaphores establish publication ordering. Samples are visible before
  DONE; T05 releases suffix commands only after every predecessor's matching DONE. T07's
  [direct dependency fences](#13-t07-synchronization-and-ipc-continuation) preserve the DSP barrier
  while dispatching the already-sealed suffix command with the other commands. Neither
  slot counters nor shared flags are used as memory fences. At most one global block is sealed.
- INIT/READY agree on epoch, plan/artifact digests and native format. Native startup checks
  MYFLT width, binding dtype, sample rate, `ksmps`, channel count and `0dbfs`. The partition
  wrapper corrects stock ctcsound audio-channel pointer declarations using the verified MYFLT
  width; this does not change the default renderer. Missing bridge APIs or a width mismatch
  fail startup. The extracted wrapper is also used by the T04 sequential harness.
- Every RENDER/DONE checks exact sequence, interval, frame count, revision, slot set and
  `slot=sequence%2`, `generation=sequence//2`. Revisions cannot decrease. A worker performs
  exactly once, writes all its output/meter samples (including silence), then acknowledges.
  Nonfinite audio/meters, float32 overflow, malformed/stale/duplicate replies and unexpected
  child exit invalidate the epoch. Child output/logging file descriptors go to the null device;
  bounded error records carry diagnostics without a blocking log pipe.

### Parent timing and publication

`render_blocks(block_count, target_sample_rate, prepare_block)` serializes whole requests.
The trusted parent-only callback `(request_block_index, engine_sample_start)` runs once per
block and returns frozen `BlockInputs`: already drained/gated MIDI, coalesced control writes
and an authoritative revision. The T06 facade uses this connection point; it introduces no second scheduler.
Events arriving after that drain remain eligible for the next block, including the existing
late/clamp ordering. Without a callback, the last control revision is retained. The coordinator
never advances sequencers or fabricates MIDI timestamps.

Each request is bounded to 192,000 engine frames and an 8–192 kHz target sample rate. Engine
`ksmps` stays unchanged. All independent predecessors are dispatched before waiting; the
same-interval suffix runs after their barrier, and no future interval is speculative.
Only a complete block advances `committed_sample`. Native bridge/final slots retain their
native precision. The parent converts completed output to float32, resamples once per full
request through the existing helper, and returns the existing `EngineRenderResult` shape.
Publication and cancellation share a lock; `published_sample` advances only for a complete
returned request. On a later-block failure, completed native work remains diagnostic but no
partial request is returned or replayed. Stop retains those diagnostic positions; every new
start resets all three cursors to zero, including a new start that subsequently fails.

Owned meter readings are collected at the same completed sample as output. The internal API
retains the last block's channel readings and at most 32 frames sampled at the existing 15 Hz
cadence, starting after the first block. T06 maps channel names to session mixer levels and
wire audible transport markers. Failed epochs clear pending meter data.

### Cancellation and cleanup

Stop signals cancellation before waiting for render ownership. Wait loops inspect cancellation,
child liveness and the deadline at bounded intervals. There is one startup watchdog and one
watchdog per sealed render block; each failing operation additionally owns the stop budget.
Cleanup gives the whole worker set half the stop budget to exit gracefully, then terminates,
kills if necessary, and reaps within the remaining shared budget. It is not a timeout per child.
Only after every child is reaped does the parent close process handles and unlink its arena.
An unreaped child quarantines ownership for a subsequent Stop; restart/fallback is prohibited.
Repeated Stop is safe. A start racing with an active Stop is cancelled. Start requires idle
operation ownership and otherwise fails immediately, including after a blocked-callback Stop.

The trusted preparation callback must yield promptly and must not recursively call coordinator
methods. Python cannot preempt arbitrary caller code: Stop waits at most twice its configured
budget for render ownership, then reports the blocked parent callback; ownership remains with
the operation until it yields and cleans up. This limitation is explicit, not a successful stop.
Once publication has completed under the state lock, subsequent Stop cannot retract returned PCM;
the T06 session generation and browser-lease checks additionally guard browser-response delivery.

Each child has a parent-sentinel watcher that exits even while native compilation/rendering is
hung. Abrupt parent death leaves the dedicated Python resource tracker to unlink the parent's
segment after inherited tracker handles close. Container PID 1 must reap exited orphan zombies;
they retain no native state or shared mappings. Normal stop reaps children directly.

T05 tests qualify these execution semantics, not automatic selection, realtime speedup, UI/live
edits, musical session integration, end-to-end recovery, browser latency or multi-session admission.

## 11. T06 session integration contract

`create_app()` and the shared factory keep the original `CsoundWorker` by default. The
explicit `SessionRendererOptions` injection is for integration diagnostics only. Non-single
policies construct `ParallelCsoundRenderer`; child execution additionally requires
`allow_unqualified=True` and a complete caller-supplied cost profile. T07 owns measured
admission, cgroup reservations and deployment configuration. Synthetic fixture costs are not
admission evidence. No selector is persisted in performances or accepted through public requests.

The facade retains one parent worker object across parallel and fallback starts. Its MIDI
scheduler, source ownership/lane gate, output adapter, performance-controller state and
boundary-action queue keep their identity. In parallel mode no parent native Csound instance
runs. A block applies boundary actions, advances the existing sequencer/router callback once,
drains MIDI once, resolves mapped controller CCs once, coalesces channel writes and seals one
revision for the coordinator. Control/MIDI events arriving after sealing wait for the next
eligible block. Meter channels map back to canonical mixer identities and sample timestamps.
Resampling and PCM format are unchanged.

Live preparation still runs in the existing persistent compiler service. Applying an edit,
audition, device command or source release uses the existing parent boundary owner. It never
rebuilds the partition graph, restarts children or resets the audio cursor. Idle ownership
allows an edit to finish while the browser pauses requests. Failed preparation retains the
playing configuration. Panic resets queued/owned MIDI and broadcasts sustain-off/all-sound-off/
all-notes-off to every channel at a boundary, retaining continuous effect release tails.

Explicit Stop, deletion and app shutdown invalidate configuration/lifecycle generations and
signal the facade before waiting for lifecycle ownership. A startup token rejects late starts,
including fallback after cancellation. The coordinator observes the same cancellation event
while waiting for child startup or rendering. Stale queued boundary actions fail; an old render
response must pass both the lifecycle-generation and current browser-lease checks before use.
Automatic disconnect cleanup differs deliberately: it checks for a reconnect after obtaining
lifecycle ownership, preserving the existing grace-period contract.

Canonical validation always happens first. An optional partition-preparation or startup
failure in auto mode can select the already validated single artifact before playback, after
all child owners and buffers are released. Explicit parallel mode reports the error instead.
An active render failure never switches engines midstream or replays completed native work:
withhold the whole failing request, cancel pending preparations/actions, revoke the browser
lease, stop sequencing/router state, clean up workers and publish `renderer_failed` with
committed/published diagnostics. Start cannot overtake failure cleanup. Diagnostics retain the
failed cursors after cleanup; a fresh start resets them. Auto mode quarantines parallel use
for the remainder of that session, so the next explicit Start is single from sample zero.
An explicit parallel policy may retry after complete cleanup.

The production browser's error path clears shared queue/read/playback/transport counters,
pending PCM metadata, audible markers and subscriptions. Already audible samples cannot be
retracted. Late socket messages and delayed Blob decoding from the old stream are ignored.
`renderer_failed` sets the active session's displayed state to error and clears playing state.
A new connection starts with empty buffers. Optional `SessionInfo.renderer` diagnostics and
`started`/`renderer_failed` events expose selection and fallback reasons; ordinary sessions
return `renderer=null`. Planner artifacts remain unqualified and are not rewritten to claim
runtime admission. Public compile CSDs and MIDI/SCORE exports stay canonical.

T06 widens only `MidiDelivery.source` from the generic 128-character identity limit to 1,024
characters. Session track IDs already allow 256 characters and ownership prefixes add more;
forwarding must preserve the complete parent identity. The checked-in protocol schema and
maximum-length native API regression reflect this bound. Partition/bus identities, mailbox
byte limits and event counts retain their existing limits.

## 12. T07 capacity and performance gate

Normal factory construction remains the original `CsoundWorker`; no environment selector,
UI option, saved setting, export change or default cutover is introduced. Explicit internal
`SessionRendererOptions` can request diagnostics. `allow_unqualified` never bypasses admission.

- `render_capacity.detect_render_capacity` resolves membership against mountinfo, including
  v1 split controllers and v2 delegated/namespaced mounts, then intersects affinity/effective
  cpusets and every visible ancestor quota. It limits memory by host availability and ancestor
  `memory.max`/usage and `memory.high` (v1 limit/usage), plus shared-memory and descriptor space.
  Missing, unreadable or malformed required observations produce a recorded, unknown one-CPU
  fallback. Non-Linux platforms currently require an explicit diagnostic probe injection.
  Hidden namespace ancestors remain unobservable and are recorded; visible limits are bounds,
  not dedicated CPU ownership. No host core count overrides a container quota.
- One process-wide `RenderAdmission` accounts for pending/running sessions across service
  instances. Singles always remain available and reserve one slot plus 128 MiB for subsequent admissions.
  Rendering children include the suffix; useful parallel work requires at least three children.
  CPU headroom is at least one CPU, growing by half a CPU per additional preparation process
  (half for API/coordinators, half per preparer). Fractional remaining capacity rounds down;
  the initial ceiling is eight children. Planning uses the current limit, and Start atomically
  rechecks resources and reserves a lease before shared allocation/spawn.
- The full arena estimate includes both audio slots, final stereo output, meters, bounded
  mailboxes, serialized CSD/bootstrap and page rounding. Admission also reserves the maximum
  float32 PCM request, 128 MiB per diagnostic child, and 128 MiB each for API and preparation.
  Qualified records must supply measured private-memory bounds instead. Tables/assets remain
  unsupported; samples/SoundFonts never receive a zero duplication estimate. Existing leases
  are conservatively charged in addition to measured usage/free space, deliberately allowing
  underutilization rather than promising memory that a live owner may still consume.
- Leases release only after native owners stop/reap and shared storage closes. Failed cleanup
  retains ownership. All session stop, deletion, shutdown, failure and superseded-start paths
  share this boundary. Admission denial in auto mode starts canonical single once without
  quarantining future starts; explicit parallel mode fails before dispatch with its reason.
  Capacity changes affect later starts only. Three consecutive render requests taking longer
  than their audio duration suppress new parallel admission for 30 seconds, as does a >10%
  increase in throttled periods between admission observations. Historical counters alone do
  not count as current pressure. Active transport is never silently replaced or resized.
- Optional status diagnostics add effective CPUs, detection confidence, render/slow-request
  counts and maximum render/audio ratio. These are request timings, not AudioWorklet underrun
  counts. No pressure sampling or CPU/memory filesystem scans enter the default single loop.
- Evidence must match the exact plan/artifact and runtime fingerprint (application/compiler/IPC
  sources, compiled modules, native Csound build, Python/binding/numpy/pydantic, sequencer and
  platform/hardware), and available CPUs must meet its measured capacity. At least two distinct
  heavy workloads must each pass: >=20% p95 improvement, no p99 regression, exact native
  correctness, identical browser settings, final-image verification, >=10-minute paired browser
  soaks with zero parallel underruns and no worse stress underruns/recovery. Baseline single
  losses remain reported; they do not disqualify clean parallel playback. Loss counts must
  be nonnegative integers. The duration and playback policy follow the prospective
  [T07e amendment](t07e-test-plan.md), not a reclassification of historical measurements. This first predicate is
  conservative about p99: no allowance for noise is inferred from a short measurement.
  Internal records are trusted, reviewable inputs, not client-supplied assertions. No records
  ship in T07. Deployment/workload-envelope approval remains a release decision; changing
  browser settings or workload envelopes requires new evidence.
- macOS timed semaphore waiting emulates a sleep loop. Its completion notification now uses
  a bounded nonblocking datagram to wake `select`, while retaining a semaphore release/acquire
  fence for shared-memory publication. Linux retains native timed semaphore waiting. One
  outstanding command, all-predecessor barriers, interval/epoch validation, cancellation and
  bounded stop budgets are unchanged. There is no speculative batching or queue enlargement.
- The suffix publishes both native-width final samples and a separate float32 PCM slot.
  Float32 conversion executes beside `performKsmps`, matching Csound's thread-local handling
  of subnormals. A bounded scalar slot reports that conversion mode; its generation shares
  the output barrier and may not change within an epoch. The parent copies the float32 bytes
  and resamples once per request, preserving signed zero and applying the reported flush
  policy to newly interpolated subnormals. No process/thread floating-point flags are changed
  by the parent. All slots are included in startup memory admission and completion validation.

The lease scope is one API process. Multiple API processes/independent applications require
external coordination before parallel deployment; these leases do not reserve the machine
against unrelated containers. The permanent compiler/API reserve is a diagnostic budget, not
proof that arbitrary simultaneous compilation fits. These limitations keep automatic selection
closed until representative production evidence and workload bounds are approved.

Reference semantics: [Linux cgroup v2 hierarchy](https://docs.kernel.org/admin-guide/cgroup-v2.html),
[v1 CPU bandwidth](https://docs.kernel.org/scheduler/sched-bwc.html), and
[Python semaphore behavior](https://docs.python.org/3.13/library/multiprocessing.html#multiprocessing.Semaphore).

## 13. T07 synchronization and IPC continuation

The optimized path remains an explicit internal diagnostic option. Default/fallback single
rendering, export compilation, K, sample rate, browser queues, request sizes, native audio
slots and bounded command/reply mailbox capacities are unchanged. No interval is rendered
ahead of the parent's event drain or before the previous global completion barrier.

- Startup caches the immutable topological waves, control subscriptions and validated shared
  views. A semaphore per dependency edge connects the native owners. The parent still seals
  all descriptors before dispatch. Children acquire their command fence and every predecessor
  fence before reading inputs or performing DSP. Prefixes publish all output bytes before
  releasing successor fences; their parent acknowledgement is released **last**.
- The parent collects and validates every acknowledgement, verifies process liveness and
  rejects duplicate/unconsumed edge counts before advancing the clock. A failed predecessor
  cannot publish a successful audio request: the epoch is discarded and waiting children
  are reaped within the existing global stop budget. Edge fences are new objects per epoch;
  Stop and parent death do not depend on a blocked child's render loop polling cancellation.
- Empty MIDI/control deliveries use `render_block_codec.SteadyBlockCodec`: a four-byte
  `RBL1`/`DBL1` discriminator, the 32-byte bootstrap SHA-256, and unsigned 64-bit sequence,
  sample start and control revision, within the existing length-prefixed mailbox. The digest
  binds epoch, partition identity, plan/artifact, engine format and complete bus ownership.
  Slot and generation remain `sequence % 2` and `sequence // 2`; frame count remains fixed
  by the validated engine format. Negative/overflow counters, wrong length/digest, stale
  sequence/sample/revision and mismatched acknowledgement bytes fail closed.
- A block containing MIDI or subscribed controls uses the full validated JSON `Render`/
  `Done` pair. Init, Ready, Stop and Error also retain the JSON schema. Both encodings can
  alternate in the same epoch, preserving one authoritative revision and event ordering.
  This is a local same-build transport, not a rolling cross-version worker protocol.
- Native audio transfer calls retain Get/SetAudioChannel copies, with names, typed pointers
  and fixed views validated once. Generated control-meter pointers are borrowed through
  `csoundGetChannelPtr`, read only by their owning child after `performKsmps`, and never
  exported across a process boundary or used after reset. Their control type/storage stays
  fixed for the epoch. Finite checks and native-thread float32/subnormal conversion remain.
- One persistent selector watches native process sentinels instead of repeated successful
  per-child `waitpid` polls. Missing acknowledgements still check death and cancellation at
  the existing bounded wait interval; complete blocks check all sentinels before publication.
  The selector, dependency fences, cached views and native owners are released on cleanup.

The qualification thresholds are unchanged. Passing exact native traces and short render
deadlines does not alone approve automatic selection or replace browser/stress/latency evidence.
Native channel ownership follows the [Csound channel API](https://csound.com/docs/api/group__CONTROLEVENTS.html).

## 14. T07 live-input overhead continuation

The parallel owner borrows one validated, contiguous native output view after successful
start and format validation. Csound owns its storage for that fixed-format lifetime. Only
the owning child reads it, after `performKsmps`; it clears the reference before native
stop/cleanup/reset. No native pointer is exported. The existing final-bus copy, native-thread
float32 conversion, finite checks and completion fences remain authoritative. Generated
meter values use scalar finite checks; audio arrays retain their vector finite check.

The session facade reuses a frozen empty `BlockInputs` for the current control revision.
It still runs boundary actions, the sequencer callback, MIDI drain and controller mapping on
every block. MIDI/control-bearing blocks receive fresh validated payloads; a control update
replaces the cached revision, and a new native start resets it. This changes allocation work,
not event timing, request length, ownership, buffering or fallback behavior.

The [T07d protocol](t07d-test-plan.md) explicitly uses the user's requested ten-minute
soaks. Its historical reports distinguish that bounded assessment from the then-current
thirty-minute predicate. T07e prospectively changes that minimum to ten minutes, as recorded
in §12. Reproducing T07d's original decision requires its recorded source revision; neither
historical nor current reports install eligibility records or enable rollout.
The [Csound realtime I/O API](https://csound.com/docs/api/group__RTAUDIOIO.html) defines the
native output buffer and its post-performance reads.

## 15. Controller fan-out and G7 priority

A controller sequencer runs once in the parent. Step and curve tracks emit one ordered MIDI
CC message per target channel. The parent drains that stream once at the existing block
boundary and broadcasts the complete MIDI delivery to every native partition, retaining
the original channel numbers, values and order. A partition's local instrument numbers do
not renumber MIDI channels. Readers of the same channel/CC in different processes therefore
receive the same controller state; untargeted channels retain their own state.

Mapped `perf_controller` values use the same parent-owned channel/CC routing and revision
state, then send named control writes to their subscribed owners. Existing I-rate/new-note
semantics remain unchanged. Sharing an external controller sequencer alone does not create
a DSP dependency or force instruments into the same process. Audio routing and instrument-
generated shared-state writes still require the planner's usual dependency checks.

By explicit user direction on 2026-11-07, live-input response latency is a non-blocking G7
diagnostic. Scheduled event timing and controller correctness remain required. Historical
T07c/T07d reports retain their original criteria and failures; current acceptance follows
the [amended gate](acceptance.md#7-performance-measurement-and-gates). No runtime defaults,
buffers, production evidence records or CSD exports change with this clarification.

## 16. Linux worker CPU placement

Linux's scheduler can repeatedly colocate short, barrier-driven independent owners on one
virtual CPU even when affinity and cgroup quota allow parallel work. T07e observed this
with playback underruns; its recorded diagnostic intervention establishes the reason for
the [T07f continuation](t07f-test-plan.md).

`RenderCpuPlacement` reserves distinct allowed logical CPUs across live coordinators in
one API process. It queries the starting thread's current affinity, selects free CPU IDs
deterministically and reserves atomically before allocation/spawn. CPU quota, cpuset,
preparation/API headroom and other resource limits remain owned by `RenderAdmission`.
This placement pool supplies an additional restriction, never extra CPU capacity. Unknown
or insufficient Linux placement fails startup; auto mode follows existing single fallback.
Platforms without Linux affinity retain the previous scheduling behavior.

Each child verifies that its assigned CPU is still allowed, pins only its own rendering
thread, verifies the resulting mask, then compiles and publishes Ready. Failure is a normal
bounded startup error and all started owners are reaped. Parent/API, preparation processes
and single rendering are not pinned. No affinity query or write runs inside the audio loop;
block timing, barriers, event/control delivery, queue sizes and exports are unchanged.

Reservations release only at the end of successful coordinator cleanup. Partial spawn,
compile/placement failure and normal Stop share this path; unreaped owners or unfinished
parent operations retain their reservations. A later start rechecks the current allowed
CPUs. Existing owners are not dynamically rebound. Native probes verify distinct child
masks and unchanged parent affinity; browser evidence records allowed masks outside DSP.

These are logical CPU assignments within one API process, not exclusive physical-core
reservations. Other containers, host scheduling, SMT and separate API processes remain
outside this pool, as they do for capacity leases. Qualification stays specific to the
measured workload/build/environment and does not register deployment eligibility.


## 17. T08 opt-in and CPU observation

The [release contract](t08-release.md) defines the public `single`/`auto` session request,
operator-only exact-build catalog, browser-setting and graph identity checks, stopped-only
UI preference, deployment rollback and observation scopes. No catalog or failed qualification
retains single; the default path still constructs the plain original worker. The CPU footer
is not a clock owner and its approximately-one-second requests never call rendering or
extend idle retention. Event/control, buffer, CSD export and process ownership contracts above
remain unchanged. The [T08 protocol](t08-test-plan.md) separates final-image measurements from
fabricated selection-test records and historical G7 evidence.
