# Rust coordinator experiment

This standalone benchmark compares the shipped Python coordinator with a Rust implementation of its per-batch render path. Both arms start the same native Rust/Csound workers through the session renderer. The application has no import, build hook or setting for this experiment. See the [measured results](RESULTS.md).

The existing coordinator factory selects the candidate in a benchmark process. Rust encodes compact and eventful batch descriptors, routes subscribed controls and sample commands, splits oversized batches before dispatch, signals workers in dependency order, waits for and checks every acknowledgement, detects dead workers, validates PCM and all meter rows, and copies the stereo output. It uses the same shared arena, two slots, process sentinels, POSIX semaphore fences and Darwin socket notifications as the reference.

Python owns process startup and cleanup, calls the transport and sequencer at each original synthesis boundary, seals the visible cursor before dispatch, and publishes the committed cursor and requested meter snapshots under the existing state lock. Request resampling remains common to both arms. Rust validates every meter row, while the adapter builds dictionaries only for the last row and the snapshots the application publishes. The comparison therefore measures the complete candidate, including this reduction in Python work.

## Reproduce on macOS or Linux

Use a source checkout with its regular backend development environment, Csound, the default Rust worker library, and the Rust toolchain. The benchmark reads versioned test fixtures. From the repository root:

```sh
cargo fetch --locked --manifest-path tools/experiments/rust_coordinator/Cargo.toml
.venv/bin/python -m tools.experiments.rust_coordinator.benchmark --build
.venv/bin/python -m pytest -q tools/experiments/rust_coordinator/verify.py
.venv/bin/python -m tools.experiments.rust_coordinator.benchmark --output output/rust-coordinator/macos/report.json
```

Cargo fetch is only needed to populate an empty registry cache. The build itself runs offline and records the source and library hashes. Use a directory named for the measurement host in the output path. The default admission override of four CPUs reproduces the host diagnostic. Use `--diagnostic-cpus 0` to measure under the actual detected limit.

## Reproduce on Docker Desktop

Start with a locally built app image matching the checkout. This experiment image overlays the matching backend sources, checks the native worker and Cython sequencer, and builds only the additional coordinator library. The commands below keep raw evidence outside the container.

```sh
cargo vendor --locked --offline --manifest-path tools/experiments/rust_coordinator/Cargo.toml output/rust-coordinator/vendor
docker build --build-context crates=output/rust-coordinator/vendor -t orchestron-coordinator-probe:experiment -f tools/experiments/rust_coordinator/Dockerfile .
mkdir -p output/rust-coordinator/linux
docker run --rm --network none --cpus 4 --memory 2g --shm-size 64m -v "$PWD/output/rust-coordinator/linux:/results" orchestron-coordinator-probe:experiment --diagnostic-cpus 0 --output /results/report.json
```

## What the benchmark records

Each workload first runs separate untimed correctness traces. The harness rejects differing digests for PCM, meters, scheduled MIDI, transport markers, status, canonical CSD or final sample cursor. It also checks the plan, artifact, actual worker count and batch size for every trial, rejects single-renderer fallback, confirms Rust batches executed in the candidate and checks worker/arena/lease cleanup. The retained worker workload supplies the same warmup, instrumentation and input scripts to each arm.

Six rounds cover every ordering of the two identical Python controls and Rust. Each arm starts fresh workers. Timed calls include session scheduling, IPC, DSP and request assembly. Meter/marker draining and trace hashing occur outside the timed interval. The report pools individual requests for percentiles, retains per-round median gains and reports parent CPU time separately from elapsed time. Each adjacent trial JSON includes the raw samples. Run platforms sequentially to avoid the benchmarks competing with each other.

To discard the experiment, remove this directory and its generated `output/rust-coordinator/` directory. The optional Docker image is tagged `orchestron-coordinator-probe:experiment`.
