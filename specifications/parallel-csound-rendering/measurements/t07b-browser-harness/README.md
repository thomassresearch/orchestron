# T07b browser evidence harness

This is a diagnostic harness for the final T07b image, not application startup or a
deployment setting. It uses a temporary database and asset directory inside a disposable
container, the production frontend/AudioWorklet, real native Csound, and versioned fixtures.
`T07B_RENDERER=single` leaves renderer injection unset. `parallel` explicitly permits an
unqualified plan while retaining actual cgroup admission. No CPU override is supplied.

Reproduce from the repository root with the image digest in `t07b-verification.json`:

1. Copy these files to `output/playwright/t07b/` and create that directory. Run a disposable
   container with `--cpus 4 --memory 2g --shm-size 64m`, bind the harness directory read-only
   at `/evidence`, publish container port 8000 on a free loopback-only port, and set
   `PYTHONPATH=/app`, `T07B_CASE=realtime_4`, and `T07B_RENDERER=single` or `parallel`.
   The entry command is `/app/.venv/bin/python /evidence/server.py`.
2. Wait for the server to respond, then open the URL in a fresh Playwright CLI session with
   `playwright-cli.json`. Run `setup.js` using `run-code --filename`. Observe the prepared
   page, then run `start.js`. Setup creates fixture patches only in the disposable database.
3. Keep the page and audio active. `poll.js` is an `eval` function for counters. After the
   intended duration, run `finish.js`; it captures evidence and stops the instruments.
   Save the JSON following the CLI's `### Result` marker. Close the CLI session and stop
   the disposable container. Never attach application data volumes.

`capture.js` takes the same snapshot without stopping, for separating a clean soak from a
later pressure phase. `cpu_pressure.py --workers 1 --seconds 60` applies one bounded busy
process inside the same container quota and records actual CPU time, wall time and cgroup
counters. Run it only after saving the clean-soak snapshot, use the same pressure in both
arms, and retain a recovery interval before `finish.js`. Do not merge pressure-phase
underruns into a clean-soak result or discard them from the final qualification decision.

The UI has one placeholder track to create the rack/session. `start.js` then submits the
full sixteen-track fixture through the ordinary sequencer/start API. Saved `startedStatus`
proves the actual prepared workload. The normal preparation path normalizes its master
grid; both browser arms receive identical authored input. This browser script is not
bit-for-bit the lower-level benchmark event script. It extends playback duration without
changing instrument DSP or queue settings.

The wrapper observes existing Worker diagnostic messages and shared ring buffers. It does
not alter refills, playback, MIDI scheduling, sample rate, `ksmps`, or buffer policy. Settings,
ring capacity, initial/final counters, errors, connections, sample peak, renderer identity,
prepared tracks and elapsed time are included in the result. Diagnostics are sampled at
the production cadence; ring counters include every reported AudioWorklet underrun.
Startup/ten-second warmup is retained separately rather than silently discarded.

Record whether paired sessions run sequentially or concurrently, including when another
container starts. Concurrent containers share the Docker VM/host; separate CPU quotas do
not isolate physical cores. These headless Chromium checks do not measure sound-device
latency or substitute for matched live-input probes. A clean bounded run alone cannot
approve an automatic workload. See the implementation record for the observed stop/go result.
