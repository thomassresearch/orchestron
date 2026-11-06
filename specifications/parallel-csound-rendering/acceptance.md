# Parallel rendering acceptance and measurement plan

Status: planned, 2026-11-06. No acceptance gate has been executed for a parallel implementation. The [implementation plan](implementation-plan.md) defines the contracts being tested.

## 1. Evidence rules

Use isolated sessions and versioned fixtures under `backend/tests/fixtures/`. Never edit user performances, the developer database, external MIDI setup or examples to run these checks. Tests must not load examples through production imports either. Preserve the shared drumkit fixture/build-input rules in [AGENTS.md](../../AGENTS.md).

Record source revision and dirty-file hashes, fixture hashes, plan/capability version, selected renderer and fallback reasons, native Csound/binding/Python versions, sample format, CPU architecture, container image digest, cgroup limits, engine settings, browser settings, process count and measurement procedure.

Use real Csound for audio and scalability claims. Mock workers are appropriate for scheduler/failure tests but never establish native correctness or speedup. Confirm nonzero output on audible workloads and actual child-process execution in parallel runs. A fallback run cannot be counted as a parallel performance result.

## 2. Versioned workload matrix

| Fixture family | Required cases and oracle |
| --- | --- |
| Independent branches | Two, four and eight substantial synth branches with private inserts; known signals and canonical single output |
| Shared processing | Shared reverb/delay, nonlinear shared compressor, and Master insert chain; processing occurs once on the combined input |
| Sidechain | Dry source plus sidechain into another branch; no phase/block shift, same gating under solo |
| Routing stages | Raw/pre/post taps, mutable sends, mono pan, stereo balance, custom channel order, nested inserts and insert-return strips |
| Direct output | Mixed Master-routed and direct outputs; Master mute/gain affects only routed paths |
| Voices and lifetime | Polyphony, same-pitch retrigger, legato priority, sustain/all-notes-off, release tails, continuous generators and silent gaps |
| Controls | Simultaneous MIDI CC and GUI edits, mapped performance controllers, I-rate changes and restart behavior |
| Resource ownership | Explicit shared numbered tables, dynamic table references, replicated read-only assets, SoundFont handles and memory-heavy assets |
| Random/plugin eligibility | Known private random state, shared/unknown state and unaudited plugins; correct classification and fallback |
| Graph rejection | Real feedback, invalid ports/assets, reserved IDs, grouping-induced cycles and ambiguous resource access |
| Little parallel work | Tiny patch, one expensive instrument, dominant shared suffix and fewer eligible branches than capacity |
| Musical timing | Existing polymeter/polyrhythm, scores, strums, arpeggiators, clips, automation and transposition fixtures |

Include impulses and unique per-port signals to detect missing, swapped, doubled or previous-block buses. Test default `ksmps=32`, `ksmps=1`, and larger supported settings, plus same-rate and differing browser/engine sample rates. Do not assume every tested setting will qualify for automatic parallel selection.

## 3. Planner and compiler acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| P01 | Replan identical immutable inputs | Identical ownership, bus order, references and plan hash |
| P02 | Validate stage accounting | Every resolved stage has exactly one owner; every local/cut edge is represented; no missing implicit output |
| P03 | Co-locate nonadjacent state users | Quotient graph remains acyclic after safe closure, or explicit fallback |
| P04 | Private branch feeds shared effect and dry path | Fork retained; effect runs once; independent sources remain concurrent |
| P05 | Mute, zero send, bypass or no current notes | Dependencies and state remain present; no topology rebuild |
| P06 | Unknown table/plugin/global behavior | No unsafe split; stable reason code and unchanged single behavior |
| P07 | No explicit audio graph | Initial legacy fallback; no silent migration to mixer semantics |
| P08 | Insufficient upstream concurrency | Single selected with explanation, including budget consumed by suffix |
| P09 | Compile subsets | Full-performance engine settings and stable identity/control scopes retained |
| P10 | Polyphonic boundary export | All voices sum exactly once; no last-writer-wins behavior |
| P11 | Canonical compile/export | Public single CSD and both offline export modes retain routing and behavior |
| P12 | Precision and summation | Native precision retained at boundaries; deterministic contribution ordering verified |

For simple deterministic signal probes require exact PCM where arithmetic order is unchanged. For effects where explicitly justified rounding changes occur, record absolute/relative error bounds and peak/RMS difference using a numeric threshold frozen before comparison. Require zero sample offset and no whole-block shift regardless of amplitude tolerance. Never use perceptual similarity alone to pass timing tests.

## 4. Timeline and live behavior acceptance

Instrument both renderers to produce an ordered trace of block start/end, MIDI events and source/sequence identity, control revisions, configuration changes, committed cursor, transport markers and meter timestamps. Use deterministic barriers to inject events before and after specific acceptance points rather than sleep-based races.

| ID | Scenario | Required result |
| --- | --- | --- |
| T01 | Normal block progression | Exactly one sequencer/router advance; workers consume identical interval; cursor advances only after complete output |
| T02 | MIDI before drain, after drain, at boundary and late | Same eligible block/order/late classification as the baseline contract |
| T03 | Concurrent GUI control and CC updates | One authoritative revision update; all subscribers receive consistent values |
| T04 | Live edit completes while upstream child renders | Applies at the next eligible global boundary, never partway through worker set |
| T05 | Failed or superseded preparation | Old playback retained; no partial update, duplicate retry or lost edited draft |
| T06 | Boundary callback while PCM requests pause | Completes under idle render ownership without waiting for another browser request |
| T07 | Note-off, sustain release and lane mute/solo | No stuck notes; source ownership and unrelated manual devices preserved |
| T08 | Pad launch, seek, loop, tempo/meter and finite end | Existing quantization, signed phase anchors and stop/seek contracts retained |
| T09 | Arranger/device Play/Stop and temporary auditions | Existing independent-source and restoration behavior retained |
| T10 | Mixer bypass and live tap changes | Same smoothing, effect state continuation and sidechain behavior |
| T11 | Several pending browser requests | Contiguous ordered sample ranges; no overlapping render ownership |
| T12 | Browser resampling | Same frame counts and continuous output under existing resampler behavior; conversion occurs once |
| T13 | Parent and worker state inspections | No child-owned authoritative transport, lane gate or controller revision |
| T14 | One very slow child | No output from a later interval mixed with earlier branches; no premature marker/cursor publication |

Test Python and Cython sequencer implementations, including their existing musical regression suites. A new parallel mode must not cause the compiled kernel to fall back silently.

## 5. Lifecycle, failures and fallback

| ID | Injected situation | Required result |
| --- | --- | --- |
| F01 | Unsupported graph/build in auto | Canonical single start, explicit reason, no abandoned children |
| F02 | Same condition in explicit parallel mode | Pre-start error identifying the unsupported condition |
| F03 | Child compile/start failure | All children and segments cleaned; auto attempts single only before playback and once |
| F04 | Stop/delete during startup or fallback | Cancellation wins; no delayed successful start or leaked lease |
| F05 | Crash before/after bus write or partial completion | No incomplete PCM published; session stops/errors; no partial-block replay |
| F06 | Hung child | Bounded wait, coherent error, graceful shutdown then termination/reaping within configured budgets |
| F07 | Stale epoch/sequence/slot, duplicate DONE, malformed result | Rejected without cursor advancement or stale slot reuse |
| F08 | Event/control queue saturation | No silent note-off loss or unbounded API wait; diagnosed handling matches contract |
| F09 | Stop/restart and lease reconnect races | Old completions cannot publish to the new session epoch or controller |
| F10 | Runtime failure followed by explicit start | Fresh single start in auto quarantine; no claim of restored DSP tails/state |
| F11 | API shutdown/parent exit | Children and owned shared memory released; no orphan renderers |
| F12 | Repeated start/stop and partial startup | Stable process/FD/shared-memory counts over at least 100 cycles |
| F13 | Capacity race between sessions | Atomic reservations; no over-admission, starvation through leaked leases or theft of active workers |
| F14 | Invalid graph/asset | Same validation error in all modes; fallback never makes it executable |
| F15 | Child failure after some blocks of a request completed | Entire incomplete response withheld; diagnostics distinguish committed engine work from published PCM; explicit stop/error |

Verify actual frontend behavior after failure with queued browser audio. Record whether the existing error path stops or drains it and implement any necessary coherent stop notification without redefining samples already played. Confirm next-start reset clears stale worker-era PCM/markers according to the established browser restart contract.

## 6. Capacity and Docker acceptance

Test synthetic cgroup v1/v2 layouts, inherited ancestor quotas, cpusets, fractional quotas, missing/unreadable files, affinity narrower than CPU count and memory limits. Pair unit tests with real containers at one, two, four and eight CPU allowances where hardware permits. Include constrained CPU sets and quota throttling; they are different scheduling environments.

Measure total parent-plus-child CPU, RSS/peak memory, shared-memory usage, file descriptors, startup/compile time, cleanup time and cgroup throttled time. Exercise two concurrent sessions plus live preparation and API activity. Confirm single selection when the first-release topology cannot fit useful concurrency into its budget.

Run native Docker qualification on Linux AMD64 and ARM64 before calling both supported. Docker Desktop measurements are identified separately. Native macOS behavior may be supported but does not qualify the Linux container path. Child spawn/import, asset search paths and any native IPC extension must work in the final runtime image without build tools.

## 7. Performance measurement and gates

Extend the real-native harness around [benchmark_render_loop.py](../../backend/tools/benchmark_render_loop.py) or add a dedicated `benchmark_parallel_render.py`. Use [benchmark_offline_mixer.py](../../backend/tools/benchmark_offline_mixer.py) as a routing workload reference, not an end-to-end realtime benchmark. The existing [browser-clock benchmark](../../backend/tools/benchmark_browser_clock_render.py) uses a mock engine and cannot establish DSP scaling.

Measure paired single/parallel runs with identical authored input, deterministic seeds where supported, event scripts, engine settings, browser queue settings and warmup. Use separate fresh sessions, interleave run order, retain raw samples and repeat A/A controls to establish baseline noise. Do not compile, rebuild or run unrelated tests during timings.

Report median, p95, p99 and maximum for end-to-end render service time, native worker time, coordinator time, predecessor wait, IPC/copy time, and render-time/audio-time ratio. Measure actual browser queued/pending frames, underruns/overruns and input-to-audible latency. CPU headroom alone does not establish a dropout rate.

Initial release thresholds below are proposed engineering gates. Freeze them with the baseline in T01 before measuring the candidate; a later threshold change must be explained rather than fitted to a disappointing result.

- Correctness: all applicable P/T/F cases pass; every automatic exclusion has a tested single fallback.
- Unchanged single mode: no repeatable greater-than-5% p95/p99 regression beyond A/A noise on representative native workloads. Investigate smaller regressions on latency-critical cases.
- Useful scaling: at least 20% lower p95 end-to-end render time on two representative heavy independent-branch fixtures with at least four effective CPUs, without worse p99 beyond established noise. Publish the serial-heavy counterexamples too.
- Live timing: identical scripted event/block decisions, no added sample offset, and no statistically supported added whole-block input latency under matched live probes. Report all observed latency distributions and limits of the measurement method.
- Real playback: at least 30 minutes per qualified heavy workload at the same queue settings, with zero underruns when the paired baseline has zero; controlled stress must not increase underruns or recovery latency relative to baseline.
- Reliability: successful repeated lifecycle, crash/hang and cleanup tests; memory remains within admitted bounds, with no monotonic process/segment/FD growth.
- Automatic selection: small, serial, unknown, memory-heavy or unqualified cases remain single. A global average speedup cannot qualify a known-regressing class.

If `ksmps=1` fails performance gates, retain single for that setting. If strict scheduling fails across all useful workloads, keep the default single and record the outcome; do not substitute speculative batches or a larger browser buffer to make the benchmark pass.

## 8. Required checks during implementation

| Scope | Check |
| --- | --- |
| Focused backend | New planner/compiler/IPC/renderer/capacity suites plus affected existing mixer, worker, browser-clock, controller and API regressions |
| Full backend | `uv run --extra dev pytest backend/tests` and `make backend-check` |
| Kernel parity | Focused timing suites with `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=python` and `cython`, rebuilt through the repository's documented process |
| Frontend contracts and failure UI | Focused runtime/browser-worker tests, then `npm --prefix frontend run check` when frontend contracts/UI change |
| Existing runtime baseline | `make benchmark-runtime`, supplemented by real-native partition workloads and browser playback |
| Container | Build final image, verify native versions/process startup, run correctness and qualified benchmarks with explicit CPU/memory limits |
| Docs | Markdown/local-link and anchor validation, `git diff --check`; PDF rendering/visual inspection when manual source changes |

Record unavailable platform/Docker/browser checks as unperformed, not passed. Full application checks are implementation gates; creating this planning package only requires documentation validation.

## 9. Final release evidence

The future implementation record must contain G1–G8 status, commands/results, rejected or narrowed partition cases, raw measurement links, qualified platform/workload matrix, finalized budgets and timeouts, failure/rollback evidence, and known limitations. Screenshots are required if user-visible layout or interactions change. Confirm the single override works in the final container and does not change saved performances.

A reviewable release contains both the successful parallel path and the tested reasons to stay single. Do not change the default until that record supports the cutover.
