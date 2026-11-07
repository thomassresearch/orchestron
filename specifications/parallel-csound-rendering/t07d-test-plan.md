# T07d four-branch live latency investigation

Frozen before candidate browser measurements. The user explicitly shortened new soaks
to **600 seconds**, replacing the 1,800-second test duration for this continuation.
Keep that distinction in every report; do not relabel ten minutes as thirty minutes or
install production qualification records. The production evidence predicate remains unchanged.

- Reuse the T07c versioned `realtime_4` and `realtime_2` workloads, four effective Docker CPUs,
  2 GiB RAM, 64 MiB shared memory, 48 kHz/K=32 and the existing local automatic buffer policy.
  No render-ahead, sample offset, request-size, ring-size or recovery-buffer change is allowed.
- Diagnose using the retained T07c traces, bounded sustained-native controls and separate
  instrumented profiles. Preserve unsuccessful experiments. Instrumented results cannot
  establish service-time percentiles or qualification. Keep one timed job active at a time.
- Freeze a candidate image derived from the immutable T07b image, changing only the parallel
  engine sources. Record every changed source, image ID, native parity and lifecycle results.
  Keep single rendering and exports unchanged; default startup remains single.
- Run fresh sequential browser arms in order: parallel four, single four, single two,
  parallel two. Each retains ten seconds of warmup, at least 600 seconds of clean-soak
  observation, then the same recovery and latency probes as T07c. Preserve all errors/losses.
- Recovery remains three 1.2-second container pauses, sixty seconds of observation per pulse
  and ten seconds of uninterrupted consumption to establish recovery. Compare total underruns
  and worst recovery bounds, retaining overlapping bounds as inconclusive.
- Latency remains sixteen independent calibration pulses, four warmups and 128 measured
  timestamped MIDI bursts through the normal Worker, with the same pitches, deterministic
  jitter, foreground/background voices, silence threshold and mixer restoration. Use the
  same silent observer and browser output-clock estimates; no physical speaker latency claim.
- Retain the T07c statistics: nearest-rank p95/p99, mean/median/maximum, deterministic
  10,000-resample 95% intervals of parallel-minus-single mean/p95 (seed 70703), and a
  32/48 ms non-inferiority margin. Both upper bounds must meet the margin. Report single
  first/second-half variation and all latency-phase underruns, including warmup and gaps.
- Rerun exact native parity and paired native service-time measurements for both heavy cases
  on the final image. Report the original scalar qualification rejection separately from
  the user-requested ten-minute assessment. Never fabricate longer durations to pass it.

See [T07c method and limits](t07c-test-plan.md) and the
[implementation record](implementation-record.md) for historical results. No automatic
selection, release approval or qualification registration is part of this work.
