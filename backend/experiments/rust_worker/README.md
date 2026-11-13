# Retained Rust parallel worker

The narrow worker-loop experiment is retained and is now the **default inner loop for
parallel playback**. Single rendering remains the application default; Python still owns
the coordinator and worker process lifecycle. The original Python batch loop is retained
and commented **deprecated**. The benchmark and [original measurements](RESULTS.md) remain
available for repeatable comparisons.

`VISUALCSOUND_PARALLEL_WORKER=rust|python` selects the parallel inner loop when a worker
starts; the default is `rust`. Use `python` for explicit rollback. There is no public API
or UI selector and no automatic fallback to the deprecated parallel loop. Missing/stale
libraries, invalid selections or unsupported ABIs report startup failure through the existing
cleanup and auto-to-single fallback. An active failure stops playback as before.

## Boundary

Python retains Csound creation/compilation, the parent scheduler, protocol validation,
eventful JSON decoding, shared-memory provisioning, publication fences, timeouts and process
cleanup. The Rust cdylib runs channel transfers, per-step MIDI/control delivery, `performKsmps`,
PCM copying/conversion, finite checks and meter reads. Each batch crosses ctypes once.
Eventful batches still marshal their validated deliveries in Python. Empty batches allocate
no event descriptors. The native MIDI read callback uses synchronous thread-local ownership;
the Csound instance and its pointers remain in their original child process.

Rust supports **float64 stereo Csound only**, matching the supported native installations.
The deprecated Python loop retains its original ABI support. Rust uses the same native audio-channel
copy APIs, synthesis steps, meter sampling, native floating-point environment and original
Csound programs. There is no fast-math, new DSP, thread pool, changed coordination interval,
buffer enlargement or relaxed protocol check. Startup caches and preallocates native state;
the Rust render loop itself does not allocate.

This is an unsafe, private C ABI with an owning Python adapter, not a general-purpose plugin
ABI. The adapter validates contiguous shared views and retains all referenced objects.
Borrowed buffers/functions must live through the native owner's shutdown. The Rust callback
is active only during the owning render call and does not call back into Python. The existing
parent-death watchdog and process termination remain responsible for a stuck native call.

## Build and verify

From the repository root, with Rust/Cargo and the ordinary native Csound development setup:

```sh
.venv/bin/python -m backend.experiments.rust_worker.build
.venv/bin/pytest backend/tests/test_rust_worker_experiment.py -q
```

Cargo has no external crate dependencies and builds offline (tested with Rust 1.90).
Ordinary `uv sync`/editable/wheel builds now require Cargo and build this library through
`hatch_build.py`. Editable artifacts and their source/binary stamp go to
`build/rust-worker/target`, outside the source directory. Wheels include the library and
stamp in this package's `_native/` directory. Runtime startup checks the source and binary
hashes before loading it. Docker includes the library, with Rust confined to its build stage.
Rebuild after Rust edits with `uv sync --reinstall-package visualcsound-backend` or the command
above. `VISUALCSOUND_BUILD_RUST_WORKER=off` omits Rust from a build; it does not change runtime
selection. Set `VISUALCSOUND_PARALLEL_WORKER=python` separately to use the deprecated rollback.

Tests require the built default library or an explicit `ORCHESTRON_TEST_RUST_WORKER_LIBRARY`.
They cover exact PCM/meters and scheduler boundaries, K=1/32, partial batches and rounding,
resampling/subnormals, routing, shared tables, MIDI retriggers/sustain/panic, controls,
missing/stale libraries and overflow cleanup. API checks exercise default Rust rendering,
explicit Python rollback and diagnosed startup fallback. Wheel verification runs outside
the checkout and checks native identity and stale-source rejection.

## Compare

macOS example (substitute `.so` on Linux):

```sh
VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython .venv/bin/python \
  -m backend.experiments.rust_worker.benchmark \
  --library build/rust-worker/target/release/liborchestron_worker_experiment.dylib \
  --output output/rust-worker/macos/report.json --diagnostic-cpus 4 \
  --frames 98304 --rounds 6
```

`--diagnostic-cpus` is an explicit local diagnostic capacity budget for platforms without
Linux cgroup admission. It does not pin CPUs or qualify production capacity. Omit it for
Linux measurements using actual container limits. The default scenarios are `realtime_2:32`,
`realtime_4:32`, `lake:32`, and the small-step diagnostic `two:1`. Lake uses versioned real
instruments and Master-insert routing with a repeating nine-channel note/CC probe, **not the
saved arrangement**. Other scenarios retain their fixture's sequencer, arpeggiator/router
callback path. All traces/timings use native Csound; mocks and renderer fallback are errors.

Each scenario first compares separate exact PCM, MIDI, meter, marker, transport-status,
canonical-CSD and sample-cursor traces. Timing then runs Python A, Python B and Rust in fresh
processes, cycling through all six arm orders. Both Python controls explicitly inject the
deprecated Python worker so a default change cannot turn the comparison into Rust versus Rust. Compilation/startup and a 2,048-frame warmup
are excluded. Each request contains 512 frames; coordination remains 256 frames. Reports
retain individual timings, per-round gains, both Python controls, native/program identities,
source hashes, library stamp and observed capacity. Sources are checked again on completion.
Use a new output directory for each run. Do not run other builds/tests/playback during timing.

The provisional retention criterion, chosen before timing, is at least 10% lower median and
p95 request time, no more than 5% p99 regression, no more than 5% Python A/A median drift,
and at least 80% of rounds showing a 10% median improvement. Exact traces are mandatory.
Judge K=32 representative workloads separately from K=1. Instrumented profiles, startup time,
parent CPU time and pooled tail percentiles are not browser underrun or latency measurements.
No timing result here qualifies smaller browser buffers or guarantees browser underrun improvements.

## Isolated Linux image

The optional Dockerfile extends an existing local application image, copies the current
backend, and builds only the Rust library in a separate stage. It verifies that the inherited
Cython binary matches the current source; rebuild the base image if that check fails.
It does not change the running application. Use an alternate `BASE_IMAGE` build argument
when needed.

```sh
docker build -f backend/experiments/rust_worker/Dockerfile -t orchestron-rust-worker:experiment .
mkdir -p output/rust-worker/linux
docker run --rm --cpus 4 --memory 2g --shm-size 64m \
  -e VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython \
  -v "$PWD/output/rust-worker/linux:/results" orchestron-rust-worker:experiment \
  --output /results/report.json --frames 98304 --rounds 6
```

## Roll back or remove

To roll back without removing the experiment, start the backend with
`VISUALCSOUND_PARALLEL_WORKER=python`. Stop and explicitly restart affected sessions; never
switch a running native owner. Rust tooling can also be omitted at install time using
`VISUALCSOUND_BUILD_RUST_WORKER=off`.

Removal remains localized: restore the retained Python branch as the normal loop in
`csound_process.py`; remove this directory, its tests, runtime fingerprint contribution,
Hatch/Docker/CI build wiring and corresponding cache keys, wheel checks and documentation.
Keep useful measurement evidence. No authored performance, protocol, frontend or coordinator
migration is needed. Generated `build/rust-worker/`, `output/rust-worker/` artifacts and
separately tagged diagnostic images can be discarded independently.
