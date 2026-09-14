`tb303_madness.json` is a versioned snapshot of the performance used to reproduce the periodic realtime stalls (224 bars at 128 BPM). Tests never fetch the live performance or read `examples/`.

`tb303_madness.runtime.json` is its sequencer request, generated with the repository CLI's `build_runtime_config`, with arranger tracks enabled, queues cleared, a 8-step display cycle and the finite 7,168-step arrangement extent. It is used for compiler benchmarks and regression tests. Both snapshots retain the original synthesis and curve data.
