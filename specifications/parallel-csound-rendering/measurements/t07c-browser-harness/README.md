# T07c browser qualification harness

Diagnostic-only continuation of the [T07b harness](../t07b-browser-harness/README.md).
Use the frozen [test protocol](../../t07c-test-plan.md); this harness does not install
qualification records, enable deployment flags or change application sources.

Copy the JS files, `server.py`, `resources.py` and `playwright-cli.json` to
`output/playwright/t07c/`. Copy the Python orchestration files to `output/t07c/`.
Run from the repository root with the exact image named in `run_arm.py`, Docker,
the project's Python environment and Playwright CLI available. Set `PLAYWRIGHT_CLI`
to the CLI executable when it is not on PATH. Use a fresh CLI session for each arm.
Port 18771 and container name `orchestron-t07c` must be unused.

Example (one arm; never run arms concurrently):

```sh
.venv/bin/python output/t07c/run_arm.py --case realtime_2 --renderer parallel \
  --session t07c2p --output output/t07c/rt2-parallel
```

The runner creates a disposable container, loads only versioned qualification fixtures,
starts playback through the app, retains a ten-second warmup, captures at least thirty
minutes of playback, then runs recovery and MIDI latency probes. It saves all observations
before stopping through the app and removing its own container/browser. It does not mount
application data. `--seconds` controls the observation interval only; intervals below
1,800 seconds cannot count as a soak. An incomplete latency run is saved and fails the runner.

`setup.js` retains references to the existing AudioContext, AudioWorkletNode, Worker and
shared ring without changing their construction arguments or message flow. It can observe
startup contexts that the app later replaces; every probe uses the last active context,
worker and connection. `capture.js` is a non-stopping snapshot; `finish.js` stops afterwards.

`probe_processor.js` observes a silent side branch. The production audio node keeps its
direct destination connection. The observer's output is zero; it reads production ring
counters but never writes them. Separate bounded telemetry stores audio quantum positions,
read/write counters and underruns. Its second input accepts known-frame calibration pulses
that never reach the audible output. `install_probe.js` embeds the processor and installation
body; regenerate it after editing either source:

```sh
python3 - <<'PY'
import json
from pathlib import Path
p = Path('output/playwright/t07c')
(p/'install_probe.js').write_text('async (page) => { return await (' +
    (p/'install_probe_body.js').read_text() + ')(page, ' +
    json.dumps((p/'probe_processor.js').read_text()) + '); }\n')
PY
```

Run `test_probe_processor.cjs` and the measurement-analysis pytest file before using new
probe code, outside timed measurements. `resources.py` reads process private memory and
cgroup counters only after the clean soak. No builds or unrelated tests run during probes.

`run_recovery.py` applies three 1.2-second pauses only to the named disposable container,
always unpausing in `finally`. Each has a fixed sixty-second recovery observation and
retains command start/completion bounds. A recovered pulse requires a clean pre-pause
window and ten seconds of uninterrupted consumption. Missing drops, continuing failures
and overlapping paired bounds cannot silently become zero recovery time or a pass.

`start_latency.js` stops the sequencer normally, retains the same graph and Csound owners,
mutes background branches while keeping their DSP active, and uses the normal Worker MIDI
path. It calibrates sixteen pulses, retains four warmups and 128 measured foreground bursts,
then releases held notes and restores mixer controls. All raw output-clock mappings, counters,
errors and timing observations are retained. The browser's estimated output time is not a
measurement of physical speaker latency. Run recovery before latency: latency intentionally
stops the sequencer's event script and does not restart it.

Analysis lives in `backend/tools/qualify_partition_browser.py`. It retains finite-sample
uncertainty, rejects missing/uncalibrated/unmatched observations, checks telemetry continuity,
and never registers renderer eligibility. Archived JSON may be gzip-compressed; use
`gzip.open(path, 'rt')` before `json.load`. SHA-256 checks cover the archived bytes.

Reproduce the retained comparison from the repository root:

```sh
PYTHONPATH=. .venv/bin/python specifications/parallel-csound-rendering/measurements/t07c-browser-harness/analyze.py \
  --raw-dir specifications/parallel-csound-rendering/measurements/t07c-browser-data \
  --output /tmp/t07c-comparison.json
```

The archived launch helpers default to `playwright-cli` on PATH; the executed copies used
the local cached CLI path. The archived server adds a lint annotation explaining why its
temporary database settings precede application imports. Neither adjustment changes probe
behavior. The analyzer reuses T07b's exact-image native reports and its historical parallel
four-branch soak explicitly. It does not turn the fresh short four-branch observation into
a new soak. Its scalar evidence evaluation is diagnostic only: the separate frozen latency
check still blocks G7, and no artifact eligibility records are installed.
