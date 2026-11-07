# Parallel Csound rendering

Status: T01–T07 implementation delivered; updated 2026-11-07. **G7 passes for the measured Linux ARM64, four-CPU, 48 kHz/K=32 workload scope.**
T08 rollout remains pending. Normal startup still uses the single renderer, also retained
as the fallback. No release qualification records or deployment selection are installed.

The [final qualification summary](t07-qualification-summary.md) records fresh ten-minute
paired soaks, native benefit, controller fan-out, recovery and the Linux CPU-placement fix.
Live-input latency remains a non-blocking diagnostic under the
[current acceptance criteria](acceptance.md#7-performance-measurement-and-gates);
historical failures are retained. The production evidence minimum is now 600 seconds,
as specified prospectively before these measurements.

Use independent instrument branches to distribute realtime synthesis across persistent Csound processes. Preserve the browser clock, musical timing, routing semantics and live controls. Keep the current single-engine renderer as the default and as the compatibility fallback.

The first delivery uses coarse partitions: independent upstream branches and one shared downstream partition for joins, shared effects, Master and final output. It keeps one global control block in flight, avoiding a new scheduling lookahead or a block of audio delay at process boundaries. More complex scheduling is conditional on measured benefit and timing equivalence.

## Reading order

| Document | Purpose |
| --- | --- |
| [Implementation plan](implementation-plan.md) | Architecture, ownership, partition algorithm, timing and failure contracts, ordered delivery tasks |
| [Acceptance and measurement plan](acceptance.md) | Required fixtures, correctness scenarios, fault injection, benchmarks and release gates |
| [Current contracts](contracts.md) | Observed timing, worker inventory, protocol, capacity bounds and conservative eligibility |
| [Protocol schema](protocol.schema.json) | Generated version 1 structural schema; coordinator also validates stateful ownership |
| [Implementation record](implementation-record.md) | Executed checks, native baseline results and remaining qualification |

## Decisions

- Reuse the resolved mixer stage graph; do not infer independence from rack order or connected components.
- Compile each stage exactly once and keep all voices and private state of an instrument together.
- Extend dependency analysis to shared state, numbered tables, helper instruments and MIDI/control subscriptions.
- Use one persistent, single-threaded Csound instance per child process, with shared-memory audio buses.
- Keep sequencers, arpeggiators, lane gates, MIDI ordering and controller revisions authoritative in the parent coordinator.
- Retain original `sr`, `ksmps`, `0dbfs`, event ordering and browser queue settings.
- Use automatic fallback before playback for supported fallback conditions. A failed active worker causes a coordinated stop; the next explicit restart can use the single renderer. Do not claim seamless failover.
- Do not split polyphonic voices, repartition active instruments, duplicate shared effects, change native bundle formats, or parallelize offline exports in this delivery.
- Enable automatic selection only for measured, compatible workloads and qualified runtime builds. Unqualified cases remain on the current renderer.

## Scope and evidence

The source review found one `CsoundWorker` per session, a serialized `performKsmps()` loop, and an existing `ResolvedMixerGraph` with ordered patch, bypass, strip, route and output stages. A static evaluation of the existing synthetic mixer benchmark produced 29 stages and 38 edges, with four independent sources and shared delay/Master consumers. This is graph evidence, not a performance result.

No Orchestron container was running during the initial analysis. T01 recorded repeatable native single-renderer measurements. T07 adds paired native/container measurements, actual cgroup admission probes and browser regression checks. Its synchronization continuation brings selected K=32 workloads below the p95 audio budget, with 20–47% paired improvement on measured heavy cases; see the [current evidence and limits](implementation-record.md#t07-continuation-synchronization-and-ipc). G7 passes for the measured Linux ARM64, four-CPU, 48 kHz/K=32 workload scope. Release and cutover remain pending.

The original planning package changed no implementation. T01 adds internal contract models, diagnostic tooling, synthetic fixtures and regression tests. T02 introduces a typed renderer interface and shared construction factory. T03 adds optional compiler resource/connection analysis and immutable diagnostic partition plans. T04 shares structured stage lowering and emits internal realtime partition programs. T05 adds persistent child processes, shared native audio buffers and a parent coordinator. T06 integrates session lifecycle, controls, edits, auditions and recovery through explicit internal options. T07 adds capacity leases, evidence-based selection, profiling, wakeup/PCM fixes and startup CPU placement. CSD export remains canonical and single. Normal session creation still selects the original single worker and its render loop is unchanged. Parallel sessions remain diagnostic opt-in only. User data, instrument examples and deployment settings are unchanged by this work.
