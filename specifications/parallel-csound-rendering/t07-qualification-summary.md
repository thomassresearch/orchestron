# T07 final G7 qualification — 2026-11-07

**G7 passes for the measured Linux ARM64, four-CPU, 48 kHz/K=32 workload scope.** T08 rollout remains pending. Single rendering stays the default and fallback;
no qualification records or deployment selection are installed. Live-input latency is
non-blocking under the user's amended criteria, and is not claimed to be fixed.

## Measured candidate and scope

- Image: `sha256:1a488adc5341ba0518e8d604b54dc512a952151e59d0f3923d6daeb74be943f0`.
- Runtime fingerprint: `85a7341cc27559f096927bf54fe8ed09951e5fb000e0e17da940c86ddb28b8bd`.
- Docker Desktop Linux ARM64, native float64, Cython sequencer, four effective CPUs,
  2 GiB container memory and 64 MiB shared memory; 48 kHz, `ksmps=32`.
- Three persistent rendering owners, including the shared suffix, on distinct allowed
  logical CPUs. Virtual CPU placement is not a reservation of physical cores.
- Same authored workloads and automatic browser settings in each pair; 288,000-frame ring,
  unchanged request sizes, timing, synthesis, buffer policy and canonical CSD exports.
- Fresh original arm order: parallel two, single two, single four, parallel four. No builds,
  unrelated tests or other benchmarks ran during timed observations.

## Results

Values separated by `/` are single / parallel. Soak losses exclude deliberate recovery
pauses; all four retained warmups had zero losses. Native p95 figures use three paired
98,304-frame runs per workload with 512-frame requests; neither workload regressed at p99.

| Workload | Soak seconds | Soak underruns | Native p95 reduction | Worst recovery bounds, ms | Induced recovery underruns | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| realtime_2 | 602.41 / 602.42 | 0 / 0 | 20.8% | 352.52–373.02 / 294.42–337.27 | 2694 / 2316 | pass |
| realtime_4 | 602.41 / 602.41 | 985 / 0 | 25.3% | 2083.95–2139.56 / 265.52–322.49 | 1036 / 841 | pass |

Two-branch recovery includes all **nine** observations per renderer: the original three
plus six fixed precision probes. Four-branch recovery includes its original three per
renderer. All pauses have a minimum acknowledged 1.2-second hold, sixty-second observation
and ten-second stability requirement. The original two-branch comparison was inconclusive:
parallel 284.54–337.27 ms versus single 317.35–369.79 ms. The prospective
[recovery extension](t07f-recovery-extension.md) narrowed control-command uncertainty using
a persistent local Docker connection. Its two fresh arms ran in reverse order, single then
parallel, and took about seven minutes each. No original trial was removed or replaced,
and the original inconclusive report remains available separately.

The four-branch single renderer dropped 985 worklet blocks in normal playback. This remains
visible; the prospective [T07e protocol](t07e-test-plan.md) requires clean parallel playback,
without rejecting a candidate merely because its baseline drops audio. There were no parallel
warmup/soak losses, application errors, overruns or fallback in either final workload.
All native owners and shared audio arenas were released after Stop. Private-memory snapshots
and cgroup charged-memory peaks are reported separately; neither is presented as an exhaustive
private-memory peak or installed production bound.

## Changes and verification

T07e exposed repeated worker colocation on virtual CPU 0 despite available capacity. An
intervention on its already-failed arm stopped further losses, but all post-intervention
observations remain diagnostic only. T07f starts each native owner on a distinct allowed
logical CPU, with process-wide ownership retained until children are reaped. Existing
capacity/headroom admission remains authoritative. Placement failure uses the existing
startup failure/single fallback path; parent/compiler/single affinity is unchanged.

- 160 focused tests passed after the placement change, including startup denial, cleanup,
  retained leases, session/API fallback, controls and the 100-cycle lifecycle test.
- 41 measurement-analysis/control tests passed, including missing evidence, recovery
  uncertainty, retention of all trials and pause/unpause failure handling.
- Final-image native checks: 16 exact audio/meter cases, four tiny-sample/resampling pairs,
  CPU ownership/reuse/denial probes, and step/curve controller-sequencer fan-out.
- Controller checks include channels 2 and 5, same-channel readers in separate owners,
  an untouched channel 7, and step-reset behavior. Scheduled events, markers, status,
  meters, sample cursors and canonical CSD fingerprints match single rendering.
- Before CPU placement, the full backend suite passed 3,260 tests; Python and Cython
  controller-focused suites each passed 64. These are historical checks, distinct from
  the current affected-suite and final-image verification. Ruff passed.

The first focused placement run caught an invalid startup error label; it was corrected to
existing protocol code `start` before candidate measurements. Its failed log is retained.
No frontend/UI contract changed, so no frontend rebuild was required for this continuation.

## Evidence and limits

The [implementation record](implementation-record.md#t07-continuation-linux-cpu-placement-and-fresh-g7-qualification)
contains the failed candidate and final-image history. Prospective protocols are
[T07e](t07e-test-plan.md), [T07f](t07f-test-plan.md) and the
[fixed recovery extension](t07f-recovery-extension.md).

Raw measurements are local artifacts under `measurements/`, which the repository currently
ignores. This task did not change that ignore rule. This summary preserves the
candidate identity, results, scope and hashes; local replay uses the archived
[harness](measurements/t07f-browser-harness/README.md),
[final report](measurements/t07f-browser-qualification.json),
[original report](measurements/t07f-browser-qualification-original.json) and
[verification manifest](measurements/t07f-verification.json).

- Final report SHA-256: `5777ad3a809417d44d8522c66b7583287fba1bc6da2588587e95f62c40ea0e03`.
- Original report SHA-256: `ff677cb2212a00a276855864450837cab7c0f909a0b2fefc63c3cb4a2ac005e7`.
- Verification manifest SHA-256: `69196caef1e227cb80956ac29b56fa78033bc2b2754e98195fc7be81c442b032`.

All T07d raw/report/harness hashes remain unchanged. Its failed live-input probes retain
their original image and protocol; they were not rerun or claimed as T07f results. Qualification
is limited to the measured workload/platform/engine configuration. AMD64, native Linux
hosts, K=1 performance, arbitrary workloads, concurrent independent API processes and T08
rollout are not qualified by these results.
