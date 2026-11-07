# T08 opt-in release qualification — 2026-11-07

**G7 and G8 pass for the measured scope below.** T08 implements public opt-in playback and the fixed Perform CPU status line. Single rendering
remains the default and fallback. No timing, request size, buffer policy or CSD export changed.
The measured scope is Docker Desktop Linux ARM64, native float64/Cython, four effective CPUs,
2 GiB RAM, 64 MiB shared memory, 48 kHz and `ksmps=32`.

## Candidate and release scope

- Dockerfile-built image: `sha256:6179d0f6f473875548486f15d0a973e210f6094126771045c4315e3972aae9cd`.
- Native runtime fingerprint: `b7399b236d2a7aaf2019c9c945a4474d7b0a3e3c93d43a7b8c99818fbe8aefe8`.
- Three persistent rendering owners, including the shared suffix, on distinct logical CPUs.
- Same browser settings and 288,000-frame ring in every arm; visible CPU polling throughout.
- Exact native/browser input graph, cost profile, auto policy, plan and compiled artifact match.
- The [catalog](t08-qualified-workloads.json) contains the two exact measured fixture graphs.
  It does not qualify arbitrary performances, changed instance IDs, more voices, other browser
  settings, AMD64, K=1 performance or independent API processes sharing the container.

The catalog is supplied for explicit operator installation on the matching build. Nothing is
installed into the user's existing container, and ordinary startup has no catalog configured.
See [release configuration and rollback](t08-release.md). The capability switch permits an
explicit request; it does not change the default or bypass qualification/capacity checks.

## Measurements

Values separated by `/` are single / parallel. Each fresh arm includes ten seconds of warmup,
at least 600 seconds of playback, and three fixed recovery pulses. Order was single two,
parallel two, parallel four, single four. Builds and unrelated tests did not overlap timings.
The [prospective protocol](t08-test-plan.md) was frozen before collection.

| Workload | Soak seconds | Soak underrun blocks | Native p95, ms | p95 reduction | Native p99, ms |
| --- | --- | --- | --- | --- | --- |
| realtime_2 | 603.41 / 602.92 | 0 / 0 | 11.387 / 8.590 | 24.6% | 12.336 / 8.937 |
| realtime_4 | 602.91 / 602.94 | 1235 / 0 | 12.525 / 9.395 | 25.0% | 13.032 / 9.613 |

Native timing uses three paired 98,304-frame rounds with 512-frame requests and separate
exact-output traces. Both parallel warmups and soaks were clean, without application errors,
overruns or fallback. Baseline losses are retained. Live-input latency remains non-blocking;
old T07d diagnostics retain their original provenance and are not claimed as current results.

| Workload | Worst recovery bounds, ms | Induced recovery underrun blocks | Decision |
| --- | --- | --- | --- |
| realtime_2 | 365.05–380.57 / 295.61–316.14 | 941 / 785 | pass |
| realtime_4 | 1528.63–1537.71 / 311.22–330.16 | 1012 / 871 | pass |

Every pulse held the container for at least 1.2 acknowledged seconds, followed by a fixed
sixty-second observation and ten-second stability requirement. All original trials passed;
no recovery extension, replacement or discarded observation was needed.

The observer made 600 and 601 successful requests in the parallel soaks, with p95 response
times of 6.09 and 5.96 ms. Actual assigned-CPU readings were available. Private-memory snapshots
reached 467,382,272 and 474,353,664 bytes. The reviewed admission budgets are **896 MiB** and
**960 MiB**: twice each largest observed private snapshot, rounded up to 64 MiB. These budgets
are conservative estimates, not measured private-memory peaks. Charged cgroup peaks are
retained separately in the raw report. Existing runtime memory/headroom admission remains
mandatory. Every Stop released native rendering owners and shared audio arenas.

## Correctness and application verification

- 3,296 backend tests passed; 119 frontend test files / 1,384 tests passed. Frontend lint/build,
  backend Ruff, full Docker build and 37 evidence-analysis tests passed.
- Final-image native checks passed all 16 routing/block-size audio and meter cases, four
  tiny-sample/resampling pairs, CPU placement/reuse/denial cleanup, and step/curve controller
  fan-out across owners and MIDI channels. Native traces matched PCM, scheduled markers,
  meters, status, cursors and canonical CSD fingerprints.
- Public UI verification uses the catalog with **no injected renderer options**, no fabricated
  evidence and no capacity override. It checks the plain-worker default, qualified opt-in,
  disabled switching during playback, changed-settings fallback, single override and cleanup.
- The server rollback switch is checked through a fresh public server; existing-session rollback
  is also covered by the native API regression. Observation does not advance transport or
  prolong idle retention. Desktop and narrow layouts are inspected from actual playback.
- Labels, tooltips and integrated help cover EN/DE/FR/ES; the user manual remains English.

The first public harness assertion combined diagnostics across a deliberate Stop and the next
Start. It exposed an **existing** Stop warning: continuous bindings use MIDI channel 0, which
`collectPerformanceChannels` passes to a manual MIDI request that accepts channels 1–16.
That unchanged default-path warning is retained separately in public evidence. The new session
has no audio errors or losses; Stop still releases owners. This unrelated warning is not fixed
or silently omitted by T08. Initial catalog tests also caught integer/float cost coercion that
changed plan digests; strict catalog models now preserve the original numeric representation.
A test-only TypeScript state label was corrected before the final frontend/image build.

## Evidence

Raw reports, logs, scripts and unsuccessful public-harness attempts remain under the existing
ignored `measurements/` directory; its ignore policy was not changed. The tracked catalog and
this summary retain release inputs, scope and hashes. See the local
[harness](measurements/t08-browser-harness/README.md),
[qualification report](measurements/t08-browser-qualification.json) and
[verification manifest](measurements/t08-verification.json).

The catalog's `report_digest` is the SHA-256 of the complete qualification report file:
`abb111ce0db0634c50bb1f0ba049110b02c15cb5e7438a3bbcbea258ae891d2b`.

- Catalog SHA-256: `66e8cbed88ba0adad87d5d15caaf981bacde2c5b7c18531029563b4adb42392b`.
- Verification manifest SHA-256: `3f900f3c1369e3dd0c523bed79963bb0dbec246654a928e5c66b6ca819d6505c`.
- The rebuilt English manual has 211 pages; the contents, updated text, screenshot and
  configuration section were inspected on pages 2, 23–25 and 193.
