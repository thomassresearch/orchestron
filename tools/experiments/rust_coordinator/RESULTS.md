# Rust coordinator assessment · 27 November 2026

**Keep the shipped Python coordinator as the default.** For K=32 with the default 256-frame batch, Rust saved 0.04–0.23 ms per request at the median across the six platform/workload combinations. The Lake probe showed the largest median improvement, 5.5% on Linux. The two-instrument workload with the minimum 32-frame batch changed by 1.9% on macOS and 0.9% on Linux.

**The K=1 workload passed the criterion on both systems.** Median request time fell from 7.74 to 5.80 ms on macOS and from 10.02 to 7.87 ms on Linux. All twelve paired rounds cleared a 10% median improvement. P95 fell from 19.63 to 12.71 ms and from 21.24 to 13.71 ms respectively. Even with Rust, those p95 values exceed the 10.67 ms of audio a request delivers.

| Platform | Workload | Batch frames | Python median ms | Rust median ms | Median reduction | p95 reduction | p99 reduction | Python A/A median drift |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| macOS | Realtime 2 | 256 | 3.459 | 3.422 | 1.1% | 5.0% | 6.1% | 1.0% |
| macOS | Realtime 4 | 256 | 4.073 | 3.971 | 2.5% | 7.8% | 7.5% | 0.4% |
| macOS | Lake probe | 256 | 4.141 | 4.095 | 1.1% | 9.0% | 4.6% | 2.5% |
| macOS | Two, K=1 | 256 | 7.743 | 5.799 | 25.1% | 35.3% | 35.1% | 0.7% |
| Linux | Realtime 2 | 256 | 6.172 | 6.050 | 2.0% | 4.8% | 10.2% | 0.2% |
| Linux | Realtime 4 | 256 | 6.810 | 6.689 | 1.8% | 7.6% | 47.0% | 1.0% |
| Linux | Lake probe | 256 | 4.226 | 3.995 | 5.5% | 9.2% | 7.3% | 0.7% |
| Linux | Two, K=1 | 256 | 10.018 | 7.867 | 21.5% | 35.4% | 34.8% | 0.6% |
| macOS | Realtime 2 | 32 | 4.704 | 4.613 | 1.9% | 1.8% | 1.9% | 0.2% |
| Linux | Realtime 2 | 32 | 7.744 | 7.671 | 0.9% | 0.4% | -2.8% | 0.0% |

K means Csound’s synthesis block size (`ksmps`). All rows use K=32 except those marked K=1. Linux Realtime 4’s 47% pooled p99 reduction is sensitive to outliers. One Python B trial accounted for 33 of the 37 Python requests above 10.67 ms, while each of the six Python A trials had a p99 below 9 ms.

Median parent CPU time for K=1 dropped from 3.36 to 1.38 ms on macOS and from 3.89 to 1.74 ms on Linux. At K=32 with default batching the parent used only 0.23–0.30 ms per request with Python. K=1 has 256 synthesis steps per default batch. Avoiding per-step meter dictionaries and repeated Python descriptor construction can save much more work there. The benchmark varies both implementation and language and does not attribute a fraction of the gain to either optimization alone.

## What was measured

Each request produced 512 stereo frames at 48 kHz, or 10.67 ms of audio. Each trial rendered 2,048 warmup frames followed by 98,304 measured frames in 192 requests. Each configuration ran six fresh-process rounds in all six orderings of Python A, Python B and Rust. Both Python controls used the shipped coordinator. All three arms used the same three Rust workers, Csound programs, batch size, Cython sequencer and callbacks. Timing covered the session render call. The CPU measurement covers the parent process and excludes the worker processes.

The default coordination batch was 256 frames. The additional 32-frame run repeats the same two-instrument workload, engine settings and request size with eight times as many coordination barriers. The Lake case uses the versioned *Evening at the Lake* Master-insert instrument and routing fixture with a repeating nine-channel MIDI/CC probe. The K=1 case uses a separate fixture. These service measurements cover the native rendering portion of playback. Browser buffering, audible latency, long-running underruns and x86 hosts would need separate measurements.

The assessment used the earlier worker experiment’s criterion, set before timing. Median and p95 request times must both fall at least 10%, p99 may rise at most 5%, Python A/A median drift must be at most 5%, and at least five of six paired rounds must show a 10% median gain. A positive percentage below denotes a shorter request with the Rust coordinator.

## Correctness and reproducibility

Before timing each case, both coordinators ran separate traces and had to match the full PCM byte stream, scheduled MIDI, meter and transport-marker sequences, status, final cursor and canonical CSD. Every trial checked the plan, artifact, worker count, coordination size and cleanup. The trial harness counts native batches to verify the candidate actually ran. The macOS and Linux cases exercised their respective native completion transports.

All 16 additional macOS checks passed. These cover exact output and meters with partial batches and resampling, sample playback and source cancellation, mailbox splitting without draining MIDI twice, oversized-command rejection, corrupt or duplicate completions, worker death, timeout, concurrent Stop and cleanup.

macOS ARM64 used an explicit four-CPU admission budget. Linux ARM64 ran in a disposable Docker Desktop container with an enforced four-CPU quota, 2 GiB memory and 64 MiB shared memory. Timing runs were sequential across platforms. Normal host activity was uncontrolled. The Python A/A drift and per-round comparisons give a measure of that variation. See the [build and rerun instructions](README.md).

## Evidence

Local raw reports and per-trial samples are under `output/rust-coordinator/`. Each report records native source/binary hashes, runtime versions and plan identities. These report hashes identify the completed runs:

- `macos/report.json` — `7ac33e50a3e0b09d1f8b30c941b5d12d287d38edd59ceeb8c2d3bdb3d2a859c9`
- `linux/report.json` — `7d7703d191b1a704e7a597a8132e8819b0b4411e68b6f3529fbee5154fa2cca5`
- `macos-batch32/report.json` — `a7f10d2b4ae93642de427f36d3774b6fbaf82b6d26e9194407f03fc150591218`
- `linux-batch32/report.json` — `65296b5156a05c56974a02a11d10796e6edee8af4b1d19c7e88a4ea6111f992e`

Host source revision was `28be642dc538b92f0d9cc190fd368ea32266a2ac`. The Linux experiment image was `sha256:15b0df8085cda76bc8e40c656aab054a13242c00f0d2673263fd18612dd7488a`. The benchmark and fixture sources matched across both platforms.
