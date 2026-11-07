# T01 baseline and frozen contracts

Status: initial contracts implemented without renderer activation, 2026-11-06. [Internal models](../../backend/app/models/render_protocol.py) are the executable structural contract. They are not imported by session creation, compiler selection or the current rendering loop. [Implementation evidence](implementation-record.md) distinguishes completed T01 work from later qualification.

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

The frozen Pydantic union is `RenderMessage`; its generated schema is [protocol.schema.json](protocol.schema.json). JSON is the review/interchange schema, not a decision to serialize audio or per-block payloads as JSON. T05 chooses a bounded binary/shared-memory encoding with identical fields and invariants. No pickled callbacks, service objects or Csound pointers are permitted.

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
or coordinated failure publication. Those remain T05 onward. Container/native stock-binding,
AMD64, float32, browser soak and parallel process performance require separate qualification.
