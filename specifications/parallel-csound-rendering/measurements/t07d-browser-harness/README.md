# T07d live-input qualification harness

Diagnostic continuation of the [T07c harness](../t07c-browser-harness/README.md), using
its unchanged browser observers, recovery pulses and MIDI latency probes. The frozen
[T07d protocol](../../t07d-test-plan.md) uses **600 seconds per clean soak**, as requested
by the user. The production thirty-minute predicate is unchanged and evaluated separately.
No report installs qualification records or enables automatic selection.

From the repository root, copy the JavaScript files, `server.py`, `resources.py` and
`playwright-cli.json` to `output/playwright/t07d/`, and the other Python files to
`output/t07d/`. Create both directories first. Use Docker, the project Python environment,
and Playwright CLI. Set `PLAYWRIGHT_CLI` to its executable if it is not on PATH. Port 18771
and container name `orchestron-t07d` must be unused. The immutable candidate image is in
`run_arm.py`; `Dockerfile` records the four-file overlay on the immutable T07b base image.
Before rebuilding, verify that `visualcsound-t07b:local` resolves to the `base_image` ID in
the [verification manifest](../t07d-verification.json).

Run the following arms sequentially, with no other benchmarks, tests or builds active:

```sh
.venv/bin/python output/t07d/run_arm.py --case realtime_4 --renderer parallel --session t07d4p --output output/t07d/rt4-parallel
.venv/bin/python output/t07d/run_arm.py --case realtime_4 --renderer single --session t07d4s --output output/t07d/rt4-single
.venv/bin/python output/t07d/run_arm.py --case realtime_2 --renderer single --session t07d2s --output output/t07d/rt2-single
.venv/bin/python output/t07d/run_arm.py --case realtime_2 --renderer parallel --session t07d2p --output output/t07d/rt2-parallel
```

Each arm uses its own disposable database/container/browser. After ten seconds of retained
warmup, it observes at least ten minutes, captures private process memory, runs three
1.2-second pause/unpause recovery probes with sixty-second observation windows, and collects
sixteen calibration pulses, four warmups and 128 live MIDI bursts. It retains every error,
then stops through the app and removes its own browser/container. See the T07c README for
observer design, telemetry boundaries and timestamp limits. The legacy `T07B_*` fixture
variables retain their meaning. No application data volume is attached.

The only executed-to-archived launcher change is a portable `playwright-cli` PATH default
instead of the local cached executable path. Test duration, image, settings and probe code
are identical. `install_probe.js` embeds `install_probe_body.js` and `probe_processor.js`;
its generation recipe and observer control tests are unchanged from T07c.

`probe_live.py` is a separate native diagnostic, never browser qualification. It sustains
sixteen notes across the same four branches and measures fixed 3,072-frame requests. Its
`--profile`, `--reverse` and `--spin-micros 50` variants retain unsuccessful investigations;
none changes production synchronization. Instrumented samples cannot establish performance
percentiles. `native_correctness.py` runs the sixteen exact native cases and four fresh-process
small-sample/resampling pairs in the final image. Its evidence directory is `/evidence`.
The archived native diagnostic is formatted for readability and its unused result binding
has an underscore prefix; the executed source is retained as `probe_live.executed.py.gz`
under `t07d-native-diagnostics`, and both hashes are recorded. Those changes
do not alter its operations or timing. The browser probe code is unchanged.

Reproduce the analysis from the repository root:

```sh
PYTHONPATH=. .venv/bin/python specifications/parallel-csound-rendering/measurements/t07d-browser-harness/analyze.py \
  --raw-dir specifications/parallel-csound-rendering/measurements/t07d-browser-data \
  --native specifications/parallel-csound-rendering/measurements/t07d-final-native.json \
  --output /tmp/t07d-comparison.json
```

The analyzer reads gzip-compressed raw JSON when needed. It uses all four new soaks and
the final candidate's native results; no historical browser arm is substituted. It retains
the existing bootstrap comparison and recovery bounds, reports the actual durations to the
unmodified production predicate, and separately assesses the requested ten-minute scope.
Browser output-clock estimates do not measure physical speaker latency.

The four-branch parallel latency attempt stopped at 107/128 measured bursts and the
two-branch parallel attempt at 81/128, because each next burst lacked the required quiet
foreground. Both raw datasets and failing runner logs are retained; neither was retried
or replaced. `analyze.py` marks incomplete/uncalibrated probes
as incomplete, retaining descriptive partial distributions without a bootstrap pass.
`test_analysis.py` covers this failure handling and the unchanged complete-probe comparison.
