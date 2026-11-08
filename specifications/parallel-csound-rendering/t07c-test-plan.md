# T07c qualification protocol

Frozen before the T07c latency/recovery probes on 2026-11-07. This continues the T07b
evidence; it does not change the runtime, selection policy or existing thresholds.

- Use image `sha256:4d8770ba1a5e15bdcce523d2c94eab9287b5e6ebf31f3ffec36e739783c3e9f4`,
  four effective CPUs, 2 GiB memory and 64 MiB shared memory. Use the versioned
  `realtime_4` and `realtime_2` cases, 48 kHz/K=32, and unchanged local `auto` settings.
  Default single uses no injected renderer. Parallel uses the internal diagnostic
  override and actual cgroup admission. No records are installed or deployment flags enabled.
- Run one test container/browser at a time. Repeat the `realtime_4` single soak without
  the earlier concurrent startup. Then soak `realtime_2` parallel and single for at least
  1,800 seconds each after the same retained ten-second warmup. Retain T07b's completed
  30-minute parallel `realtime_4` soak with its concurrent-host caveat, and use a fresh
  parallel `realtime_4` session for matched probes. Do not compile, build or run unrelated
  tests during measurements. Preserve every failed run and identify any harness correction.
- After each soak, install a silent AudioWorklet observation branch. The production audio
  processor keeps its direct output connection; the observer emits only zeros and cannot
  edit the production ring. Its separate bounded diagnostic storage is not an audio queue.
- Recovery: three 1.2-second Docker pause/unpause pulses, each followed by a fixed 60-second
  observation. Preserve the production sequencer, queue policy and native timeout settings.
  Capture both command-time bounds and actual browser counters. Recovery means the first
  resumed full audio quantum followed by at least ten seconds without another underrun.
  Report missing frames, underrun counts, queue levels, recovery-time bounds and censored
  failures. A pulse that produces no underrun does not establish recovery latency. Require
  a clean pre-pulse window; never subtract ongoing baseline failures from the result.
  Compare total underruns and the worst recovery across the three pulses. Overlapping
  recovery-time bounds are inconclusive; a pass requires the parallel upper bound to be
  no greater than the single lower bound, with no additional underruns.
- MIDI latency: stop the sequencer through its normal API. Keep the same graph/native
  instances and hold the other source branches' voices while muting their mixer strips.
  The source DSP still runs. A foreground burst starts all voices on source 0: four in
  `realtime_4`, eight in `realtime_2`, reaching sixteen active voices in both. Send timestamped
  MIDI through the production browser Worker, using normal automatic Live mode. This
  replaces the event script only for the explicitly labelled latency phase.
- Use four retained warmup bursts and 128 measured bursts per arm, the same pitches and
  deterministic inter-event jitter. Require at least 50 ms of foreground silence before
  arming; detect the first absolute sample above `1e-7`. Retain timeouts/errors rather than
  dropping outliers. Release every foreground burst and all held background notes on exit.
- Calibrate the observer with sixteen known-frame one-sample pulses on an independent,
  silent observer input. Every detected frame must be within one sample of its scheduled
  frame. Estimate output time using the nearest `AudioContext.getOutputTimestamp()` pair,
  retaining notification delay and mapping/extrapolation information separately. This is
  a browser output-time estimate, not a physical speaker/microphone loopback measurement.
- Compare median, p95, p99, maximum and mean; retain all raw trials. Use deterministic
  independent bootstrap resampling (10,000 replicates, seed 70703) for 95% intervals of
  parallel-minus-single mean and p95. An upper bound no greater than one native block
  (32/48 ms) supports no added whole-block latency in this probe. A lower bound exceeding
  that margin shows regression; an interval crossing it is inconclusive, never a pass.
  Also report first/second 64-trial single A/A comparisons as within-session noise context.
- Reuse the exact-build native parity and paired performance reports, verify unchanged
  default/browser/export sources, and evaluate the original conservative G7 predicate.
  Publish a per-workload pass/fail/inconclusive decision. Completing qualification does not
  imply it passes; preserve single default/fallback and all exclusions regardless.

The output-time mapping follows the [Web Audio specification](https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp).
It is an estimate whose precision depends on proximity to the output stream position.
The [acceptance criteria](acceptance.md#7-performance-measurement-and-gates) and
[existing evidence predicate](../../backend/app/engine/render_qualification.py) remain unchanged.
