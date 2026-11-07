# T07e G7 qualification under the revised scope

Frozen before T07e candidate measurements. The user explicitly requests G7 completion
with **ten-minute runs** and **live-input latency non-blocking**. This is a prospective
criterion amendment, not a relabelling of T07c/T07d outcomes. Preserve their raw evidence.

- Set the qualification minimum to 600 actual observed seconds per single/parallel arm.
  Keep >=20% native p95 improvement on each of two heavy cases, no native p99 regression,
  matching settings, exact runtime/artifact/plan identity, native correctness and capacity.
- Require zero parallel playback underruns, including warmup, and no application errors or
  overruns in either arm. Record single baseline underruns without treating them as candidate
  failures. This aligns the scalar predicate with the written baseline comparison; requiring
  zero parallel underruns even when the baseline drops audio is stricter than that comparison.
  Negative, noninteger or nonfinite loss counts are invalid evidence.
- Recovery retains three 1.2-second pauses per arm, at least sixty seconds of observation
  after each resume and ten seconds of uninterrupted consumption. Parallel total losses and
  worst recovery must be no worse than single, with overlapping recovery bounds inconclusive.
- Live MIDI input latency is diagnostic only. Retain the T07d failed probes and their exact
  build/source provenance rather than rerunning or repairing them to obtain a pass. T07e
  changes qualification policy only; all synthesis, IPC, frontend, timing and buffer sources
  must match T07d. No new live-input latency result is claimed.
- Freeze the final candidate image before timed runs. Use Docker Desktop Linux ARM64,
  Csound 6.18.1/MYFLT float64, Python 3.13 and the Cython sequencer, four effective cgroup CPUs,
  2 GiB RAM, 64 MiB shared memory, 48 kHz/K=32 and unchanged automatic browser settings/ring.
- Run fresh sequential arms: single four, parallel four, parallel two, single two. Each gets
  ten seconds of retained warmup, >=600 seconds of playback and the matched recovery probes.
  No builds, tests or other benchmarks run concurrently with timed observations.
- On the final image, verify the native parity matrix, small-sample conversion/resampling,
  controller-sequencer fan-out and fresh paired native benchmarks (three rounds, 98,304 frames).
  Run backend regressions and both sequencer kernels before browser timings.
- Report G7 only for the measured build, workloads and environment. No automatic/default
  cutover or qualification registration is authorized by passing these measurements. Single
  stays default/fallback. CSD exports, render timing and buffer sizes remain unchanged.

The production predicate remains an exact-build selection prerequisite, not a report loader.
The report must bind browser container images and observed renderer/capacity/settings, native
trace parity, source hashes, recovery evidence and correctness results before declaring G7.
Native benchmark artifact hashes are not automatically registrations for browser/session graphs.
