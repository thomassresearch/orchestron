# T07c raw browser evidence

These 31 losslessly compressed JSON records retain the four sequential test arms. `rt2`
means `realtime_2`, `rt4` means `realtime_4`; `single` and `parallel` identify rendering modes.
The [protocol](../../t07c-test-plan.md), [harness](../t07c-browser-harness/README.md),
[comparison](../t07c-browser-qualification.json) and [manifest](../t07c-verification.json)
describe reproduction and SHA-256 integrity checks.

- `soak`: startup/warmup, all production diagnostics, settings, ring counters/capacity,
  actual prepared tracks, renderer state, sample peak and elapsed time.
- `recovery`: three bounded pauses, command-time bounds and complete per-quantum traces.
  Each trace has `contextFrame`, `readFrame`, `writeFrame`, `underrunCount` columns in its
  flattened `data` array. These samples are diagnostic counters, not PCM audio.
- `latency`: sixteen calibrations, four warmups, all 128 measured bursts, errors, clock
  mappings, counters and mixer restoration. No timeouts or outliers were removed.
- `probe`, `resources`, `container`, `start`, `finish`: observer setup, private memory/cgroup
  snapshots, immutable image/resource limits, startup and normal app shutdown evidence.
  The first single arm was orchestrated manually; its `startInfo` is inside `soak` and its
  container record is the direct Docker inspect array. Other container records also include
  the explicit launch command and start epoch.

`rt4-parallel-soak.json.gz` is a **62.40-second pre-probe observation**, not a thirty-minute
qualification soak. Analysis explicitly reuses the parallel `clean_soak` from
[`t07b-browser-realtime4.json`](../t07b-browser-realtime4.json), retaining its concurrent-host
caveat. The other three T07c soak records each exceed 1,800 seconds.

Read a record with `json.load(gzip.open(path, 'rt'))`. The manifest hashes the compressed
bytes and the original JSON bytes separately. No application data or production databases
were mounted into these disposable test containers.
