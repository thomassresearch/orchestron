# Whole-instrument graph selection

This contract replaces T08's per-song release catalog. It does not change the canonical
compiler, exports, audio clock, request sizes, buffering, event scheduling or process protocol.

## Selection

- `renderer_mode=single` remains the public default and constructs the original worker.
- Explicit `auto` uses the current full-performance graph with no installed catalog, graph
  registration, browser-settings match or synthetic timing profile. The server rollback switch
  still applies before preparation and again at Start.
- Whole patch stages, strips and private inserts retain one owner. Co-location constraints
  include shared mutable native resources and compiler helpers. The planner closes intervening
  paths to keep the resulting dependency graph acyclic.
- Independent upstream domains are balanced into persistent workers; joins and their downstream
  effects/Master/output remain in one final process. Every connection, contribution and stage
  has one owner. Shared suffix work is included in worker/CPU admission, not treated as free.
- Without measured costs, structural weights (stage work plus voice resource declarations)
  balance branches. Choose the fewest workers attaining the smallest estimated upstream
  critical path; spare CPUs alone do not justify more synchronization. These weights are not microsecond estimates or a promised speedup. The
  plan's timing estimates stay null. Explicit offline benchmark profiles retain their measured
  benefit checks. The pure plan still cannot authorize native execution by itself.
- Existing cgroup admission reserves coordinator/preparation headroom, counts other sessions,
  rechecks CPU/memory/shared-memory/descriptors at Start, and limits the layout to eight workers.
  Unknown capacity, fewer than two upstream groups, invalid ownership, unsupported resources,
  denied admission and failed startup retain canonical single fallback.
- Worker failure during playback retains the stop/quarantine/explicit-restart contract. No active
  synth replacement, larger buffers, relaxed deadlines or audio replay is introduced.

## Native resources

Resource semantics belong to compiler maintenance, not song configuration. The shipped semantic
identity snapshot detects changed/custom opcode definitions; ordinary arithmetic, filters,
envelopes and internal If/Switch branches remain inside whole instruments. It does not assert
that an opcode needs its own parallel implementation.

- Voice-local state stays with the whole instrument.
- The canonical wrapper already creates sine table 1 in every engine; the native sine table -1
  is also private/read-only. Readers can use these without co-location. A writer to table 1
  changes it into shared mutable state and groups all its users.
- Numbered GEN tables and their readers/writers are co-located. Dynamic table references and
  auto-numbered `ftgenonce` join the table domain to preserve allocation identity. Replicated declarations must be read-only. Compiler
  table memory estimates are charged to their owners in addition to the native per-process
  budget. Unbounded per-note automatic `ftgen`, sample-backed/unknown-size tables and generators
  with unmodeled state (including named generators) retain single fallback; they are not silently copied or assigned zero cost.
- Shared native random-stream users are co-located so their relative execution and random
  consumption remain intact. This can reduce the available parallelism even without audio wires.
- `initc7` and MIDI readers retain their shared initialization domain. Parent-generated MIDI,
  sequencer controllers, automation and live controls retain ordered, timestamped broadcast at
  the same engine block; event pruning by instrument MIDI channel remains forbidden.
- Existing scoped legato collectors/panic helpers retain one owner. Unknown custom/global
  state, SoundFont/analysis assets and unsupported helper memory remain explicit single
  fallbacks until their allocation and initialization semantics are covered. No general
  native-handle transport or arbitrary global-channel replication is claimed.

Scalar parameter expressions are also inspected: pure arithmetic/engine constants remain
local, `rnd`/`birnd` consumers join the random-state domain, and unmodeled functions/global
identifiers retain single fallback. This includes portless numeric constants and the legacy
`madsr` release alias. A harmless opcode name cannot conceal a cross-engine dependency in a
parameter expression. Prepared-piano table inputs and negative FFT-window table IDs likewise
participate in table ownership.

The sine convention is documented in the [Csound oscillator manual](https://csound.com/docs/manual/oscili.html).
Csound's [random generator documentation](https://csound.com/manual/siggen/random/) explains why
some otherwise independent instruments share random state.

## Evening at the Lake

The versioned snapshot has nine source instruments, shared reverb, shared compression and
67 compiler stages. With sufficient capacity, the selected graph produces three processes:

1. Tabla, shore, analog drums and flute share a random-state owner.
2. Glass bell, low bass, water pad, FM bass and reflections pluck.
3. Shared reverb, compressor, Master and output.

Seven processes are structurally possible, but the first domain dominates the structural
load. Extra workers do not shorten that indivisible branch. The three-process layout has the
same estimated critical path with fewer synchronization participants. A preliminary browser
trial of the seven-process layout had underruns; it overlapped the full backend regression run
and is not a matched performance measurement.

Smaller CPU allowances merge upstream groups; they do not change timing or buffer sizes.
The snapshot retains 48 kHz, ksmps 32, software buffer 1024 and hardware buffer 512.

## Validation (2026-11-08)

The isolated Linux test image is
`sha256:cc513bfa61905db85206f07aa8c7baf6b0b9e1296b6c32d486438ecb74e53b44`.
It used 12 available CPUs, a 2 GiB memory limit and 64 MiB shared memory. The user's running
application and stored performance were not modified. The saved arrangement was looped only
in the test browser so each matched run could last ten minutes.

Native comparison used the same timestamped nine-channel notes/controllers, 74 blocks per
request, 256 requests and 64 warmup requests in each renderer. Three persistent workers
produced byte-identical float32 output (maximum difference zero) with the same sample cursor.
Sequential native instances also matched canonical audio and meters exactly. This validates
ownership and event delivery for the exercised sequence, not every possible performance.

| Native request time | Single | Parallel (3 workers) |
| --- | ---: | ---: |
| Median | 59.10 ms | 47.28 ms |
| p95 | 67.64 ms | 50.09 ms |
| p99 | 74.96 ms | 54.29 ms |
| Maximum | 76.10 ms | 57.90 ms |

Each request represents 49.33 ms of audio. The measured median improves by 20%, but some
requests exceed that duration in both renderers. Browser playback measurements follow below;
these synthetic native notes alone do not prove sustained realtime performance.


The matched browser runs used the actual saved arrangement and original live settings:
Listening mode, 300/800 ms steady watermarks, 400/500 ms startup watermarks, 74 maximum blocks
per request, 4/5/3 steady/startup/recovery request limits and the unchanged 288,000-frame ring.
Ten seconds of startup warmup preceded each measured interval. No build or native regression
run overlapped either measured interval.

| Browser measurement | Single | Parallel (3 workers) |
| --- | ---: | ---: |
| Measured wall time | 603.43 s | 603.42 s |
| Underrun counter increase | 1,779 | 16,334 |
| Overruns / stream errors | 0 / 0 | 0 / 0 |
| Median observed render/audio ratio | 0.909 | 1.055 |
| p95 observed render/audio ratio | 1.090 | 1.233 |
| p99 observed render/audio ratio | 1.149 | 1.301 |

Ratios are samples of the existing browser diagnostic, not independent per-request latency
percentiles. Underruns are AudioWorklet counter increments, not distinct audible glitches.
The three-process run remained selected throughout and the footer reported CPUs 0, 1 and 2.
The single run used the original worker and no child DSP processes.

**Result: functional selection/parity passes; realtime performance for this arrangement does
not pass.** The native synthetic sequence improves, but the actual song has more underruns
with parallel rendering. The result is consistent with limited overlap around the large
shared-state domain plus per-block coordination cost. Structural weights cannot predict the
song's active-voice distribution. Keep single rendering for this song on this environment;
spare CPUs and successful graph partitioning alone do not guarantee a speedup. This change
does not claim new G7 qualification, hide this regression behind a catalog, enlarge buffers,
or change the clock to obtain a pass.

Local raw evidence is in `output/whole-instrument/`: `linux-native-lake.json`,
`lake-parallel-soak.json`, `lake-single-soak.json` and `browser-comparison.json`.
The screenshot is `screenshots/performance_engine_stats.png`. The versioned Lake fixtures
and `backend/tests/test_whole_instrument_rendering.py` provide repeatable graph, native parity
and persistent-process regression coverage without reading a developer library or examples.

After these measurements, two preparation-only guards were added for named GEN routines and
invalid writable replicated declarations. Neither is exercised by the Lake graph; neither
changes emitted Lake programs or the rendering loop. They have explicit regression tests.
The final build and check results are recorded below.

Final checks:

- 288 focused backend checks passed: planner determinism/coverage/ownership, resource guards,
  session lifecycle/recovery, native audio/meters, persistent shared-table memory charges,
  cross-channel MIDI/control delivery and the existing canonical CSD byte fixtures.
- Five public API checks passed for graph opt-in, default single, operator rollback and
  unsupported-graph fallback. No catalog or fabricated benchmark evidence was supplied.
- The earlier complete backend run had 3,296 passing checks and six canonical-fixture failures.
  Those failures came from changing the historical `unknown` test fixture to a different
  opcode, not changed compiler output. The original fixture was restored, a separate unsupported
  fixture was added, and all affected canonical checks passed in the final 288-check run.
  A second complete backend suite was not run after the focused fixes.
- Frontend lint/build and 1,384 tests (119 files) passed. Backend lint, changed Markdown local
  links and `git diff --check` passed.
- The final full Docker build passed:
  `sha256:053a0e4e81a09a64abf6d338fcad3f952574c1eb9bd2e720f88482210a1f79fc`.
  This includes the two preparation guards described above; the measured image identity is
  recorded separately rather than assigning earlier timings to a different image.
- The 212-page English manual was regenerated. Updated pages and the new three-CPU screenshot
  were visually inspected. UI help is aligned in EN/DE/FR/ES.
- All three child DSP PIDs and the shared audio allocation were gone after Stop; the temporary
  test browser/container were removed. The existing live Docker application was not rebuilt,
  restarted or reconfigured by this task.

## Master-insert retest (2026-11-08)

The revised live performance sends the sources and reverb to Master, with a dedicated
compressor insert owned by Master. An additive fixture overlay preserves this revision and
the original baseline independently. Library synthesis graphs, notes and source settings are
unchanged; the new compressor instance's current settings are retained in both new runs.
The existing live application was only read, never restarted or reconfigured.

The graph still selects three workers and 34 cross-process audio contributions:

| Worker | Whole-instrument ownership |
| --- | --- |
| Upstream 0 | Tabla, shore, analog drums, flute (shared random-state domain) |
| Upstream 1 | Glass bell, FM bass, low bass, water pad, reflections pluck |
| Downstream | Shared reverb, Master bus, compressor insert/bypass, Master strip, output |

The stage count rises from 67 to 68 because the insert adds its live bypass stage. The
upstream stage ownership is identical. Both routings sum the instruments before shared
compression; moving that processor to Master does not remove the dependency. Independent
sources in the second worker remain packed together because more workers do not shorten the
dominant indivisible group under the structural weighting policy.

The live session was already in an error state. Reproduction with its exact image
`sha256:95a716f71ecc101f6fff16c9bd4009c2e55343bda79246e65dc1900f14e09e59`
failed on the first browser PCM request with `Unknown or uncoalesced parent control write.`
The parent sends gain/post/pan fields for every mixer route, but graph metadata declared only
gain for raw insert feeds. The four otherwise harmless post/pan writes therefore had no
process owner. The correction declares all existing mixer writes on their route stages;
raw feeds continue to ignore post/pan in DSP. Strict rejection of genuinely unknown controls
remains intact. The canonical compiler, exported CSDs and timing/buffers were not changed.

Regression tests now drain the initial mixer writes through persistent workers and the public
browser-clock API, including live Master-insert bypass on/off. Previously, successful Start
alone did not exercise those pending writes. Control ownership checks cover the complete set
of canonical initial controls and parent mixer writes. Six planner snapshots changed only for
these control declarations and their digests; canonical CSD byte fixtures remain unchanged.

The corrected measured image is
`sha256:b8d600fd9cbbea47e694b26940a42e0a65917f96171da94f6341691939de4301`.
The isolated container has the same 12-CPU, 2-GiB-memory and 64-MiB-shared-memory test limits.
All 116 graph/resource/API checks and 167 compiler/lifecycle checks passed, as did backend
lint and the Docker build. No build or native regression test launched by this task overlaps the timed browser runs.

The corrected Linux native comparison uses the same nine-channel synthetic event sequence
and request/warmup counts as the earlier probe, with normal mixer initialization in both
renderers. Output is byte-identical, with maximum sample difference zero. Sequential native
instances also match audio and meters exactly for the revised graph.

| Corrected native request time | Single | Parallel (3 workers) |
| --- | ---: | ---: |
| Median | 61.60 ms | 46.50 ms |
| p95 | 67.91 ms | 49.61 ms |
| p99 | 74.12 ms | 54.10 ms |
| Maximum | 119.69 ms | 65.63 ms |

The median is about 25% lower, but each request represents only 49.33 ms of audio. This
synthetic sequence does not establish sustained benefit for the saved arrangement.
The browser used the same Listening-mode settings and 288,000-frame ring as the earlier
comparison, with the unchanged 48-kHz / ksmps-32 engine and 1024/512 software/hardware buffers.
The saved arrangement was looped only in the test browser; each run had ten seconds of
startup warmup followed by at least 600 measured seconds.

| Initial revised-routing browser measurement (overlap discovered) | Single | Parallel (3 workers) |
| --- | ---: | ---: |
| Measured wall time | 602.91 s | 603.44 s |
| Underrun counter increase | 4,046 | 15,662 |
| Overruns / stream errors | 0 / 0 | 0 / 0 |
| Median observed render/audio ratio | 0.954 | 1.048 |
| p95 observed render/audio ratio | 1.113 | 1.248 |
| p99 observed render/audio ratio | 1.154 | 1.428 |
| Maximum observed render/audio ratio | 1.322 | 1.761 |

These ratios sample the existing browser diagnostic, not independent request-latency
percentiles. The underrun count measures AudioWorklet callbacks lacking sufficient audio,
not separate audible glitches. Both engines still had audible output and running transport
at capture. Parallel retained the same three DSP PIDs; single used the original worker with
no child DSP processes.

This initial parallel measurement is confounded by overlapping live playback, as detailed
below. Use the repeat for the final comparison. Earlier routing measurements are historical,
not a simultaneous routing-only A/B comparison, so their absolute counts should not be used
to assign a precise speed change to the routing edit.

Raw evidence is under `output/whole-instrument/master-insert/`: `comparison.json`,
`comparison-contended.json`, `lake-parallel-soak.json`, `lake-parallel-repeat-soak.json`,
`lake-single-soak.json`, `native-benchmark.json`, the original startup failure and the
regression/build logs. The observed three-CPU screenshot is
`output/playwright/lake-master-insert/parallel-running.png`. The test image contains the
metadata fix. This task did not modify the live application; an independent rebuild installed
the same correction during testing, confirmed by its compiler module hash.

The final live-container check revealed playback from 11:21:59–11:22:49 UTC and
11:22:55–11:23:42 UTC, overlapping the first 106 seconds of the parallel measurement
(11:21:57–11:32:00 UTC). The single measurement (11:32:18–11:42:21 UTC) had no overlapping
live playback in those logs. The initial parallel result is therefore retained as a
contended observation, not the final matched comparison. A fresh ten-minute parallel run
used the same corrected test image/configuration against the completed single baseline.

### Final matched comparison

The parallel repeat ran from 11:48:14–11:58:17 UTC. Live-container logs contain no playback
starts or browser-clock connections during that interval; all 37 live-state observations
from 11:49:14 onward show the live session stopped (`compiled`). The revised saved arrangement,
browser settings, ring capacity, synthesis settings and test-image identity match the single
baseline. Both measurements include one arrangement loop with no live input.

| Revised-routing browser measurement without overlapping live playback | Single | Parallel (3 workers) |
| --- | ---: | ---: |
| Measured wall time | 602.91 s | 602.93 s |
| Underrun counter increase | 4,046 | 9,538 |
| Overruns / stream errors | 0 / 0 | 0 / 0 |
| Median observed render/audio ratio | 0.954 | 0.997 |
| p95 observed render/audio ratio | 1.113 | 1.170 |
| p99 observed render/audio ratio | 1.154 | 1.252 |
| Maximum observed render/audio ratio | 1.322 | 1.496 |

Ratios above 1 mean rendering takes longer than the corresponding audio duration. The table
summarizes 1,206 existing diagnostic samples per run, using linear percentile interpolation;
it is not an independent per-request latency measurement. Neither run is underrun-free.
Both still produced nonzero audio and had running transport at capture. Parallel remained
selected with three workers and no fallback or failure. The final CPU observation reported
37.8%, 36.6% and 29.0% on the three assigned CPUs; these are instantaneous observations,
not ten-minute average process utilization.

**Result: the revised routing works across three processes, but parallel rendering still
does not benefit this arrangement on this environment.** It has 2.36 times the underrun
increments and a 4.5% higher median observed render/audio ratio than single rendering.
Removing the concurrent live playback reduced the parallel underrun count substantially,
but did not reverse the result. The shared random-state group, common effects suffix and
per-block synchronization remain plausible limits; this retest does not isolate their
individual costs. The synthetic native benchmark's 25% median improvement is not a sustained
arrangement speedup. Keep single rendering for this song; no new G7 performance pass is claimed.

After Stop, all three child DSP PIDs and the shared audio allocation were gone. The temporary
test browser and container were removed. The existing live container was neither stopped nor
reconfigured by this task. Its independently rebuilt image
`sha256:b6cb0657c8836924c972b222079f8a37d74fffc90a67f47c6e8983cb14638dac`
already contains the control-ownership correction, verified by the compiler module hash.
Single remains the default/fallback, and timing, buffer sizes and CSD exports remain unchanged.
