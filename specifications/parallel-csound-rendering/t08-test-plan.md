# T08 qualification protocol

Freeze this protocol before timing the T08 candidate. The new public opt-in and CPU observer
change the runtime fingerprint; T07f records must not authorize this build through an alias.
The original G7 reports remain unchanged. Single stays the default and fallback, live-input
latency stays non-blocking, and no buffer, block, event or export semantics are changed.

Use the actual Dockerfile-built Linux ARM64 image, native float64/Cython, four effective CPUs,
2 GiB RAM, 64 MiB shared memory, 48 kHz/K=32, and the existing browser settings and ring. Record
its immutable digest and complete source/native provenance. No builds, tests or unrelated
benchmarks overlap timed runs. Run native parity/controller/ownership checks first.

Measure `realtime_2` and `realtime_4` with three paired 98,304-frame native rounds per renderer,
512-frame requests, separate traces and fresh processes. Use the fallback-capable `auto` plan
policy for the parallel arm; a diagnostic override may collect measurements but must not
claim qualification. Require >=20% p95 benefit and no p99 regression, plus exact audio, meters,
scheduled events and sample cursors. Record the exact graph/cost/policy/plan/artifact identities.

Browser order: single two, parallel two, parallel four, single four. Each fresh arm retains
ten seconds of warmup and at least 600 seconds of playback. The visible Perform CPU status
line must poll normally. Record its readings and request cadence outside rendering. Seed the
versioned fixtures with deterministic patch identities in the disposable database, so native,
browser and subsequent public-catalog verification can compare the same graph/artifact.
No user library, performance, container or browser is reused or modified.

Require zero parallel warmup/soak underruns, no overruns/errors/fallback, distinct singleton
worker CPU masks, adequate memory and successful Stop/child/shared-arena cleanup. Retain all
single baseline losses. After each soak apply three minimum 1.2-second acknowledged container
pauses, each with a fixed sixty-second recovery observation and ten-second stability requirement.
Use persistent local Docker Engine HTTP control, retain command-time uncertainty and actual
hold bounds. Parallel induced losses and worst recovery bounds must not regress. If the sole
remaining issue is overlap of complete recovery bounds, collect exactly six additional pulses
per renderer in fresh reverse-order sessions and compare all nine; never discard a trial,
replace censored evidence, or repeat an extension just to pass. Additional recovery-only arms
are about seven minutes, never substitutes for the ten-minute soaks.

Only after all gates pass may a release catalog be built from these observations. Bind it to
the exact current runtime, input graph, auto policy/costs, compiled plan/artifact and browser
settings. Review a conservative private-memory admission budget above the observed snapshots;
report snapshots and cgroup peaks separately. Do not infer qualification for other graphs,
platforms, K=1, arbitrary voice/workload envelopes or external API processes.

Verify the public API/UI path on the same native image with the reviewed catalog: unchecked
still creates the plain single worker, checked/matched selects qualified parallel, mismatched
settings/build/graph or rollback stays single, and Stop releases owners. Verify observation
alone never renders samples or extends idle retention. Capture real UI screenshots, complete
application checks, update help/docs and rebuild/inspect the manual. No default cutover or
user-container deployment is part of this work.
