# Rust worker-loop experiment results — 2026-11-13

**Original measurement decision: retain as an opt-in experiment.** The Lake instrument probe and K=1 case meet the provisional criterion on both measured platforms. The two synthetic K=32 workloads improve, but fall below the 10% criterion. Lake’s Linux p95 improvement is only 10.002%, so its tail result is borderline rather than strong evidence of a universal benefit.

After reviewing these results, the user directed promotion to the default parallel worker
on 2026-11-13. The experiment/harness remain, and the original Python loop is retained as a
deprecated explicit rollback. Single rendering remains the application default. The tables
below describe the original matched experiment, not a new benchmark of the packaging change.

Promotion verification passed the affected native/process/API regressions on macOS ARM64,
editable and wheel builds (including Rust with Cython disabled and an explicit Python-only
wheel), missing/stale library rejection, and lint/documentation checks. A separately tagged
production Docker image on Linux ARM64 produced exact default-Rust/Python PCM and meter
parity at K=1 and K=32, reaped its children, and contained no Rust compiler. This did not
restart or deploy over the running application; the Rust render loop itself was unchanged.

## Matched measurements

Each platform ran six balanced Python A / Python B / Rust rounds per scenario. Each timed arm rendered 98,304 frames in 192 requests, after 2,048 warmup frames. There were 72 timed fresh processes and 13,824 measured requests per platform, plus separate correctness traces. The table pools the two Python controls. Values are milliseconds per 512-frame request (10.667 ms of audio). All arms use three native owners, 48 kHz, 256-frame coordination and the Cython sequencer.

| Platform | Workload | Python median | Rust median | Median reduction | p95 reduction | p99 reduction | Criterion |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| macos ARM64 | realtime_2:32 | 3.721 | 3.464 | 6.9% | 4.4% | 5.0% | below threshold |
| macos ARM64 | realtime_4:32 | 4.619 | 4.180 | 9.5% | 8.4% | 6.7% | below threshold |
| macos ARM64 | lake:32 | 4.930 | 4.249 | 13.8% | 10.2% | 9.6% | pass |
| macos ARM64 | two:1 | 16.247 | 7.914 | 51.3% | 24.6% | 23.6% | pass |
| linux ARM64 | realtime_2:32 | 6.640 | 6.338 | 4.6% | 3.9% | 5.9% | below threshold |
| linux ARM64 | realtime_4:32 | 7.315 | 6.896 | 5.7% | 5.1% | 4.7% | below threshold |
| linux ARM64 | lake:32 | 5.014 | 4.236 | 15.5% | 10.0% | 8.2% | pass |
| linux ARM64 | two:1 | 18.993 | 10.002 | 47.3% | 27.0% | 25.3% | pass |

The Python A/A median difference was at most 1.51% on macOS and 1.06% on Linux. There was no pooled p99 regression in these runs. Per-round gains, maxima and all raw request samples remain in the reports; these are short native service measurements, not confidence intervals or an underrun qualification.

Lake uses the real versioned Master-insert instrument/routing fixture and a fixed repeating nine-channel MIDI/CC probe. It does **not** reproduce the saved arrangement. The K=1 result is a separate small-step diagnostic and must not be extrapolated to the normal K=32 configuration.

## Correctness and scope

- Both platforms produced identical Python/Rust PCM, MIDI-delivery, meter, marker, transport-status, canonical-CSD and final-cursor trace fingerprints for all four scenarios. All trial plan/artifact identities and worker/batch counts were invariant.
- Source stability checks passed on both completed reports. Every measured arm reaped its workers and released its shared arena/admission lease.
- The host validation covered 149 distinct affected checks: 129 existing process, lifecycle, batching, controller/session and API checks, plus 20 experiment checks. The first expanded run passed 147 and exposed two ineffective overflow test stimuli; after correcting the stimulus, all 20 experiment checks passed. Runtime code did not change during this correction.
- Experiment coverage includes partial/rounded batches, K=1/32, resampling at 44.1/48/96 kHz, subnormal PCM, shared resources, MIDI retrigger/release/sustain/panic, per-step controls, missing-library failure, and rejecting an overflowing request without partial publication.
- Backend lint and whitespace validation passed. The isolated Linux image built successfully and required a matching Cython extension. Linux timing traces are separate from the host pytest suite.

The experiment supports native float64 stereo only. It keeps Python process startup, protocol parsing and scheduling; it does not measure a complete Rust process rewrite. Native Csound DSP, channel copies, dependency waits and browser buffering are unchanged. No live browser soak, saved-arrangement comparison, x86 qualification, lower latency claim or production deployment was performed.

## Environment and retained evidence

- macOS 15.8.3 ARM64, Python 3.13.2, Csound 6.18.1, Rust 1.90.0; explicit four-CPU diagnostic admission budget, without host CPU pinning.
- Linux ARM64 through Docker Desktop, Csound 6.18.1, Rust 1.90; actual four-CPU quota, 2 GiB memory and 64 MiB shared memory. The application image supplied Python/dependencies and the verified Cython extension.
- Timing image: `sha256:25ff4d4d3a6cd8936906e378cdd0709b61de0304c7b9d444416c890f58f03552`.
- Host source base: `a22bd9bee29e67f88f92f48b7887ce06ed308911`, plus the experiment changes. Reports record individual source and native-library hashes; the minimal Linux image has no Git revision.
- No task-launched build, test or second benchmark ran during either timing window. The live application remained running; CPU observations before/after were low, but independent host contention was not continuously controlled. A/A controls bound observed median drift, not every source of tail noise.
- The benchmark container was removed automatically. The original application container/image was not restarted, rebuilt or reconfigured.

Local raw artifacts (including each arm, traces, logs and source identities):

- `output/rust-worker/macos/report.json` — SHA-256 `95753d648d22a2296564fd09fee00aa8ee34e6683f4d045dfaded382018edac6`.
- `output/rust-worker/linux/report.json` — SHA-256 `b9ecba67a52e4bf2ddec2cec4418115f8063a4f3e43e9b4ffa67ee47fb4c5178`.

These local output files are not versioned; this summary preserves the measured decision and identities. See [build, rerun and removal instructions](README.md).
