# Live mixer gain ramp qualification · 27 November 2026

**New live mixer compilations use the fast path at K>1.** The integrated K=32 change met every adoption criterion. With the shipped parallel renderer, median request time fell by 41–50% on the settled and moving-fader Lake workloads, and p95 fell by 32–35%. All 48 paired large-rack rounds across both renderers and platforms exceeded the 10% median threshold. The largest A/A drift across all workloads was 1.1%.

The compiler emits one ramp definition for the session’s resolved engine format. A live mixer with a block size greater than one sample gives every coefficient its own target and remaining-block counter. The first block and every transition use the original sample-rate smoother. A target change restarts the counter and the smoother continues from its current value. After the final active block, a stationary gain fills the block with its target value. The 20 ms fade and its rounding come from the original smoother.

The canonical compiler and every partition use this definition. It covers strip gain and balance, mute/solo gates, sends, pre/post blends and insert bypass. Insert processors continue rendering during bypass. Live K=1 uses the original opcode. Offline MIDI and SCORE exports continue to emit fixed coefficients. Switching the live compiler selection back to `RAMP_OPCODE` and starting a newly compiled session restores the original implementation. [Compiler](../../backend/app/services/compiler_mixer.py) · [Original plan and pilot](implementation-plan.md)

## Native results at K=32

The arrows show original → optimized wall time, in milliseconds per 512-frame request. A/A drift compares the medians of the two identical control arms. The last column counts rounds with at least 10% lower median request time. The 10% criterion applies to settled and moving Lake. Dense and small are regression checks.

| Platform and renderer | Mixer | Median ms | Reduction | p95 ms | Reduction | p99 ms | A/A drift | Rounds ≥10% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| macOS single | settled | 6.44 → 2.67 | 58.5% | 7.93 → 4.14 | 47.8% | 9.49 → 5.39 | 0.5% | 6/6 |
| macOS single | moving | 6.43 → 2.67 | 58.5% | 7.95 → 4.08 | 48.7% | 9.44 → 5.28 | 0.0% | 6/6 |
| macOS single | dense | 9.17 → 9.09 | 0.8% | 10.75 → 10.67 | 0.8% | 12.11 → 12.25 | 0.4% | 0/6 |
| macOS single | small | 1.84 → 0.62 | 66.4% | 1.94 → 0.66 | 65.9% | 2.01 → 0.72 | 0.0% | 6/6 |
| macOS parallel | settled | 4.24 → 2.10 | 50.4% | 6.10 → 4.00 | 34.5% | 7.51 → 5.50 | 0.2% | 6/6 |
| macOS parallel | moving | 4.34 → 2.32 | 46.5% | 6.03 → 3.97 | 34.2% | 7.56 → 5.42 | 0.0% | 6/6 |
| macOS parallel | dense | 7.25 → 7.22 | 0.5% | 8.50 → 8.76 | -3.0% | 9.87 → 9.85 | 0.4% | 0/6 |
| macOS parallel | small | 1.34 → 0.60 | 55.0% | 1.46 → 0.68 | 53.8% | 1.95 → 1.17 | 0.1% | 6/6 |
| Linux single | settled | 6.59 → 3.16 | 52.1% | 8.27 → 4.87 | 41.1% | 9.77 → 6.22 | 0.3% | 6/6 |
| Linux single | moving | 6.56 → 3.24 | 50.6% | 8.34 → 5.06 | 39.4% | 9.97 → 6.48 | 0.0% | 6/6 |
| Linux single | dense | 8.55 → 8.68 | -1.5% | 10.37 → 10.48 | -1.1% | 12.13 → 12.47 | 0.0% | 0/6 |
| Linux single | small | 2.22 → 1.16 | 47.8% | 2.50 → 1.29 | 48.4% | 5.48 → 1.42 | 0.1% | 6/6 |
| Linux parallel | settled | 4.25 → 2.44 | 42.5% | 6.39 → 4.33 | 32.3% | 8.01 → 5.93 | 1.0% | 6/6 |
| Linux parallel | moving | 4.31 → 2.52 | 41.4% | 6.29 → 4.27 | 32.1% | 7.93 → 5.89 | 0.1% | 6/6 |
| Linux parallel | dense | 6.47 → 6.50 | -0.5% | 7.95 → 8.01 | -0.7% | 9.83 → 9.87 | 1.1% | 0/6 |
| Linux parallel | small | 1.52 → 0.86 | 43.6% | 1.67 → 0.97 | 42.1% | 1.99 → 1.24 | 1.0% | 6/6 |

The 288 fresh-process trials produced 55,296 timed requests. PCM bytes, frame counts, engine cursors and published meter traces matched the reference in every trial. Single and parallel renderers also produced identical PCM and meter digests for each workload on each platform.

The dense gesture retargeted 159 of the 171 Lake ramp calls every 10.67 ms. Median changes ranged from a 0.8% reduction to a 1.5% increase. The largest p95 or p99 increase was 3.0%, within the 5% stress-test limit. With so many ramps moving, the single-instance p99 still exceeded the 10.67 ms request deadline on both platforms. The smaller rack had 56 ramp calls, and its median improved by 44–66% across the four comparisons.

## Saved-arrangement browser results

Each arm played for 602.93 measured seconds in headless Chromium 158 at 48 kHz. The canonical program and all three workers passed the emitted-opcode check, and both arms had identical partition membership. Both sessions finished playing with nonzero PCM and no reported application or worker errors.

| Playback measurement | Original | Optimized |
| --- | ---: | ---: |
| Underrun callbacks during the measurement | 30 | 0 |
| Overrun callbacks | 0 | 0 |
| Render time / audio duration, median | 0.745 | 0.535 |
| Render time / audio duration, p95 | 0.902 | 0.708 |
| Render time / audio duration, p99 | 0.964 | 0.757 |
| Render time / audio duration, maximum sampled | 1.646 | 0.918 |
| Queued frames, minimum sampled | 13,120 | 23,104 |
| Queued frames, median | 35,648 | 40,256 |

The ring capacity was 288,000 frames, with steady listening watermarks of 36,000 and 72,000 frames. The reference also triggered the normal recovery buffer boost. Each arm supplied 1,206 diagnostic snapshots. Underrun and overrun counts are differences of AudioWorklet counters after warmup. Queue depths are sampled snapshots and can miss the instant an underrun occurs. The result describes one matched pair on this host.

## Audio and API checks

The reference is the opcode from commit `343860f`. The native comparison renders independent left and right coefficients alongside the reference in one Csound instance and compares each sample's bytes. It covers matching and differing startup targets, repeated writes, idle gaps, over-unity gain, exact silence, rapid retargeting, and changes on either side of the settling boundary. The public WebSocket comparison exercises a held note, a live mixer write and its reversal through both renderers. It compares output bytes, the engine sample range of each request, published meter values and their engine timestamps. The compiler tests apply the historical CSD hashes after restoring only the intentional live opcode change. [Frozen reference](../../backend/tests/fixtures/csound/mixer_ramp_reference.orc) · [Native tests](../../backend/tests/test_mixer_audio.py) · [API tests](../../backend/tests/test_api.py) · [Compiler tests](../../backend/tests/test_compiler_partitioned.py)

The targeted regression run passed all **320 tests**, including native mixer and insert bypass, compiler profiles, the 90 historical CSD hashes, partition DSP parity, renderer lifecycle, mixer API, WebSocket fader reversal and both offline export modes. The standalone waveform probe also matched in all ten runs. Ruff, documentation checks and local Markdown link validation passed. The test run reported one Starlette TestClient dependency deprecation warning.

## Method and reproduction

Use native Csound and the built Rust worker. The [probe](../../tools/experiments/mixer_ramps/probe.py) compiles the production candidate through the normal compiler. Its two control arms substitute the frozen opcode during canonical and partition compilation. The six rounds use every ordering of the three arms, one fresh process per trial. Each trial checks PCM bytes, engine cursors, frame counts, meter trace and worker layout from the first block. Warmed timings use 192 requests after 2,048 warmup frames. Each request carries 512 stereo frames at 48 kHz with K=32. The parallel renderer uses the shipped Python coordinator, Rust workers and 256-frame batches.

- **Settled** plays the Lake Master-insert fixture’s deterministic nine-channel note and CC sequence with the saved mixer settings.
- **Moving** plays the same sequence and moves the master gain down to 0.2 and back to 1.0 eight control blocks later, once every 4,096 frames.
- **Dense** alternates gains, stereo coefficients, pre/post choices and insert bypasses across the rack every 512 frames, inside the 960-sample ramp.
- **Small** plays two instrument voices in the versioned two-source fixture, with its private effects and saved mixer. The parallel small-rack test uses the fixture’s synthetic stage costs to exercise its partitioned path.

Request time includes MIDI/control delivery, DSP, IPC where applicable and PCM assembly. The threshold for a slow request is its 10.67 ms of audio. Trace comparison and CPU sampling run outside the timed interval. CPU measurements include the rendering parent and all live workers. Peak cores are the maximum sampled average over 64 consecutive requests, with operating-system accounting resolution. CPU seconds per audio second measure the cost of producing a fixed duration of audio. Startup includes canonical and partition compilation, engine start and initial mixer configuration. Baseline percentiles pool twice as many observations as candidate percentiles.

Run the following from the repository root. Add `--renderers single` or `--cases dense small` to select individual workloads. Each trial writes raw request times and parity digests. The report retains the round-level reductions and timing distributions for both reference arms.

```sh
.venv/bin/python -m tools.experiments.mixer_ramps.probe --waveform
.venv/bin/python -m tools.experiments.mixer_ramps.probe --output output/mixer-ramps/qualification/macos
```

For Linux, mount the same sources and oracle into the runtime image with four CPUs. This reproduces the isolated native benchmark.

```sh
mkdir -p output/mixer-ramps/qualification/linux
docker run --rm --network none --cpus 4 --memory 2g --shm-size 64m \
  -v "$PWD/tools/experiments/mixer_ramps:/app/tools/experiments/mixer_ramps:ro" \
  -v "$PWD/backend/app/services/compiler_mixer.py:/app/backend/app/services/compiler_mixer.py:ro" \
  -v "$PWD/backend/tests/fixtures/csound/mixer_ramp_reference.orc:/app/backend/tests/fixtures/csound/mixer_ramp_reference.orc:ro" \
  -v "$PWD/output/mixer-ramps/qualification/linux:/results" \
  --entrypoint /app/.venv/bin/python \
  sha256:15b0df8085cda76bc8e40c656aab054a13242c00f0d2673263fd18612dd7488a \
  -m tools.experiments.mixer_ramps.probe --output /results
```

Browser measurements use the versioned Lake Master-insert arrangement in an isolated application database. Start Instruments and arranger Play use the browser clock and the listening queue. The song loops, with a ten-second warmup after audio first appears. Each arm measures at least ten further minutes on the same browser audio device. The raw captures include the initial and final AudioWorklet counters, sampled queue depth, render/audio ratio, renderer selection and errors. The Docker image and resources match between arms. Each server loads the mounted compiler from the image source tree and checks its SHA-256. Before timing, the browser fetches diagnostics that verify K=32, 48 kHz and the expected ramp definition in the canonical CSD and all three worker programs. A preliminary run that resolved the wheel-installed compiler was excluded. These captures measure playback callbacks and queue headroom. They provide no subjective listening score.


## CPU, startup and audio deadlines

Each row has 2,304 reference and 1,152 candidate requests. The last column gives the counts exceeding 10.67 ms with those respective denominators. Peak core usage measures how many CPUs were busy while rendering as fast as possible. CPU seconds per audio second also accounts for how much sooner the candidate finishes.

| Platform and renderer | Mixer | CPU s / audio s | Peak cores | Startup median ms | Late requests, ref / optimized |
| --- | --- | ---: | ---: | ---: | ---: |
| macOS single | settled | 0.606 → 0.251 | 1.00 → 1.00 | 170 → 171 | 1 / 0 |
| macOS single | moving | 0.607 → 0.251 | 1.00 → 1.00 | 170 → 170 | 0 / 0 |
| macOS single | dense | 0.863 → 0.856 | 1.00 → 1.00 | 170 → 171 | 135 / 59 |
| macOS single | small | 0.163 → 0.047 | 1.00 → 1.00 | 64 → 64 | 0 / 0 |
| macOS parallel | settled | 0.690 → 0.328 | 1.67 → 1.60 | 662 → 663 | 0 / 0 |
| macOS parallel | moving | 0.712 → 0.354 | 1.70 → 1.61 | 666 → 666 | 1 / 0 |
| macOS parallel | dense | 1.168 → 1.163 | 1.74 → 1.73 | 667 → 660 | 2 / 2 |
| macOS parallel | small | 0.199 → 0.081 | 1.64 → 1.56 | 277 → 276 | 0 / 0 |
| Linux single | settled | 0.615 → 0.296 | 1.00 → 1.00 | 124 → 125 | 2 / 0 |
| Linux single | moving | 0.615 → 0.300 | 1.00 → 1.00 | 125 → 127 | 4 / 0 |
| Linux single | dense | 0.800 → 0.818 | 1.00 → 1.00 | 125 → 125 | 80 / 35 |
| Linux single | small | 0.187 → 0.085 | 1.00 → 1.00 | 23 → 23 | 8 / 0 |
| Linux parallel | settled | 0.672 → 0.350 | 1.69 → 1.60 | 1360 → 1365 | 0 / 0 |
| Linux parallel | moving | 0.682 → 0.368 | 1.75 → 1.65 | 1302 → 1295 | 6 / 0 |
| Linux parallel | dense | 1.072 → 1.075 | 1.77 → 1.76 | 1288 → 1296 | 8 / 6 |
| Linux parallel | small | 0.219 → 0.118 | 1.87 → 2.16 | 888 → 895 | 0 / 0 |

The Lake partitions owned 22, 30, 16 stages. The small-rack partitions owned 9, 9, 5 stages. Each pair also checked the individual stage IDs. macOS used a four-CPU admission budget on the host. Linux ran sequentially on the same machine through Docker Desktop with a four-CPU quota and 2 GiB of memory.

Both platforms used Csound 6.18.1. The integrated probe SHA-256 was `f27e5edd67bd4a75386b77950cbefff134de43ff9d4544eb0f0ba29b2da7408b`. Raw per-trial JSON, reports, browser captures and a browser replay bundle are in the local `output/mixer-ramps/qualification/` directory.

- macOS ARM64, Python 3.13.2, worker SHA-256 `406385a6270b33174c1765efc78c3b838a65518d0d1dd1bc6bbeed8f14fc92b6`, report SHA-256 `f191ce7571825bdfea2d2812a108bc871ac5b7d48ae60ebfc0d88f77c441a410`.
- Linux ARM64, Python 3.13.18, worker SHA-256 `ed86f40b39121f0cae8e6f8302efc650ab91ac627205b8644cdd4d2dbd301d54`, report SHA-256 `e583f302b09f130b92e1770c01d9e5dd9e129bb960db7f33468127dbf3db925d`.
