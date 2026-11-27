# Implementation plan for settled live mixer controls

Optimize the generated Csound mixer for the normal `ksmps=32` render path. Preserve the current 20 ms coefficient waveform, including a new target arriving during an unfinished ramp, the exact saved startup value, and exact silence. The earlier 59% single-instance experiment bypassed smoothing while controls were stationary. Its result motivated this work. The pilot below measures a candidate that can still smooth moving controls.

The [implementation and qualification record](implementation-record.md) tracks the integrated change and the longer trials.

## Pilot results · 27 November 2026

**Proceed with the implementation and qualification steps below.** In the Lake pilot the fast path reduced request time with both renderers, including when the master fader reversed before its previous ramp finished. Each row below has six paired rounds and two baseline controls. Lower times are better.

| Platform | Renderer | Mixer | Current median ms | Fast median ms | Median reduction | p95 reduction | p99 reduction | A/A median drift |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| macOS | single | settled | 5.42 | 1.83 | 66.2% | 57.6% | 49.3% | 1.5% |
| macOS | single | moving | 5.44 | 1.81 | 66.7% | 61.0% | 49.6% | 0.1% |
| macOS | parallel | settled | 3.82 | 1.54 | 59.8% | 45.0% | 34.6% | 0.7% |
| macOS | parallel | moving | 3.91 | 1.70 | 56.6% | 45.2% | 31.7% | 2.9% |
| Linux | single | settled | 5.61 | 2.16 | 61.6% | 53.7% | 47.3% | 1.2% |
| Linux | single | moving | 5.59 | 2.19 | 60.9% | 49.8% | 42.0% | 0.6% |
| Linux | parallel | settled | 3.49 | 1.66 | 52.5% | 37.3% | 28.6% | 0.3% |
| Linux | parallel | moving | 3.66 | 1.87 | 48.8% | 34.5% | 29.1% | 0.6% |

PCM bytes, meter traces and cursor ranges matched the original in every comparison on the same platform and renderer. Each of the 48 paired comparisons showed a median gain greater than 10%. These are 13,824 timed requests in 144 fresh processes, using the nine-channel Lake probe. A single moving fader leaves most of the rack’s 171 ramp calls settled. The result does not measure a densely automated mixer or browser underruns.

A separate macOS waveform check compared double-precision coefficients sample by sample. All ten combinations of rate, block size and initial target matched, including exact zero after a fade. Its 96 kHz case is an extra native diagnostic above the supported engine-setting range. Before rollout, add the lower supported rates and the boundary cases listed below.

## 1. Implement at the mixer compiler boundary

The [live mixer compiler](../../backend/app/services/compiler_mixer.py) emits one ramp opcode definition and a separate call for each live parameter. The Lake Master-insert fixture has 171 call sites. The implementation belongs here so that the canonical single renderer and every compiled partition get the same behavior. Keep the public call signature, control channel identities, write coalescing, mixer manifest and partition ownership. Ordinary MIDI/SCORE exports already use fixed mixer coefficients. No new setting or bundle version is needed.

1. Preserve the current `setksmps 1` routine as a private active-ramp helper. Wrap it with a Csound user-defined opcode running at the caller’s block size. Each call site keeps its own previous target and active-block counter. Only a change in target restarts the counter.
2. Run the helper on the first block, including when the first target differs from the saved value. On a change, run it for `ceil(0.020 * sr / ksmps) + 1` whole blocks. Retargeting uses the helper’s current interpolated value. The extra block lets the helper reach its exact endpoint before its state is parked. The counter controls when work may be skipped, not the duration or shape of the audible fade.
3. Once settled, fill the output block with the current constant. Keep the stateful helper call in one place per parameter so the next change resumes the same state. Use the existing definition at `ksmps=1` in the first production version. A block there is already one sample, and this experiment targets the larger block sizes.
4. Select the definition once from the resolved **performance** engine format during live lowering. Gain, balance/pan, send level, pre/post blends, mute/solo and insert bypass all continue through their existing call sites. Bypassed effect processors must keep running and retain their tails. Rollback consists of selecting the original definition and recompiling the live program.

## 2. Lock down the audio contract before changing the default

Freeze the current ramp from the pre-change revision as the test oracle. Render reference and candidate to opposite channels of a native Csound probe, then compare each coefficient sample by its bit pattern. Include startup with a matching and a differing target, a change after a long idle period, repeated identical writes, rapid reversals, gain above unity, exact zero, and changes one block before, at and after the settling cutoff. Exercise simultaneous independent parameters and stereo asymmetry. Test `ksmps=1`, `32`, non-divisible ramp lengths and blocks longer than 20 ms (the existing 1,920-frame case). Cover supported engine rates including 22.05, 44.1 and 48 kHz.

Run the [native mixer](../../backend/tests/test_mixer_audio.py), [insert bypass](../../backend/tests/test_insert_bypass.py), [partition compiler](../../backend/tests/test_compiler_partitioned.py) and [export profile](../../backend/tests/test_compilation_profiles.py) suites. Extend the [public session PCM test](../../backend/tests/test_api.py) with a live mixer write followed by a reversal. Compare PCM, published meter values and timestamps, frame counts and cursor continuity through the single and default Rust-worker paths. A mismatch blocks promotion regardless of timing.

The existing T04 checks pin canonical CSD **text** to historical hashes. Keep the old fixture and its provenance. For intentional LIVE text changes, verify that replacing just the new definition with the historical definition reproduces the old hash, and assert the candidate was actually emitted. OFFLINE and the retained K=1 definition should still pass their original byte checks. Inspect the emitted diff before accepting new LIVE hashes if the project chooses to pin those as well.

## 3. Measure effective gain at K=32

Use the reference live renderer as the baseline. Keep real-time metering, MIDI, timing, and effect instances active in both arms. Pin source revision, Csound/native worker builds, graph, initial controls, input script, CPU budget and batch/request settings. Run sequentially on each host. Record cold startup separately from warmed service times.

| Qualification workload | What it tests |
| --- | --- |
| Lake Master-insert fixture, static controls | Benefit when a large rack is settled |
| Same fixture, a moving and reversing master fader | Typical editing with most controls settled |
| Dense control writes on many independent parameters, including bypass and pan | Cost when many smoothers stay active, deadline tails, and stereo/retarget correctness |
| Small rack with few controls | Overhead when there is little work to skip |
| Saved Lake arrangement in the browser | Sustained playback, queue headroom, and audible behavior under the normal refill path |

For native trials, use both single and Python-coordinated Rust workers at 48 kHz, K=32, 512-frame requests and 256-frame parallel batches. Use fresh processes, warm up, and rotate two identical baseline arms and the candidate through all six orders. Compute median, p95 and p99 in milliseconds, paired per-round gains, baseline A/A drift, and requests exceeding 10.67 ms of audio. Compare audio and meter traces outside timed intervals. For release qualification, run longer trials than the short pilot and include peak CPU and actual worker layout. Exercise macOS ARM64 and the Linux runtime image with four CPUs.

Then perform matched browser runs on the **saved arrangement**, at least ten minutes per arm with the same queue, device sample rate, and workload. Record underrun/overrun callback increments, queue depth and render/audio ratios. Review any new underruns in a repeat run. Browser service headroom and audible reliability are separate outcomes.

**Proposed adoption criteria.** Require exact reference parity and at least 10% lower median and p95 on the large-rack K=32 settled and moving-fader workloads on both platforms, with a 10% median gain in at least five of six rounds. Treat A/A median drift over 5% as inconclusive. Require no repeatable p95/p99 regression over 5% beyond baseline noise on small-rack and densely moving workloads, and no repeatable deterioration in browser underruns. These are proposed decision thresholds for the implementation, not measured results or a change to project-wide policy.

## Pilot setup and reproduction

The pilot injected the wrapper only while compiling a benchmark session. The [integrated probe](../../tools/experiments/mixer_ramps/probe.py) now runs the production candidate and injects the frozen reference for its two baseline arms. The single path uses the ordinary Csound worker. The parallel path uses the shipped Python coordinator and three Rust workers. The harness checks all compiled programs for the selected definition and compares logical partition membership. It does not use the experimental Rust coordinator.

The Lake Master-insert fixture plays a fixed nine-channel MIDI/CC script. In the settled arm the mixer holds its saved settings. In the moving arm the master gain changes to 0.2 and back to 1.0 eight K-blocks later (5.33 ms), once every 4,096 frames. The same callback runs in both variants. Each native trial renders 2,048 warmup frames and 96 timed 512-frame requests. Timing covers the session render call, with PCM hashing and meter draining afterward. The harness checks PCM bytes, meter traces and cursors starting at the first block, including warmup, and verifies that the fader gesture changes the output. The benchmark uses separate processes for the two reference arms and the candidate.

For a comparable pilot-size run in the integrated checkout, use the development environment, Csound and the built default Rust worker:

```sh
.venv/bin/python -m tools.experiments.mixer_ramps.probe --waveform
.venv/bin/python -m tools.experiments.mixer_ramps.probe --requests 96 --cases settled moving --output output/mixer-ramps/pilot-size
```

For the measured Linux run, the read-only probe source was mounted into a matching app image, with four CPUs, 2 GiB RAM, 64 MiB shared memory and networking disabled. Raw local timings and trace digests are under `output/mixer-ramps/{macos,linux}/`. The integrated comparison uses the opcode frozen from that revision.

Completed report SHA-256 values were `31e145cf71ba4ca4f51291e60aaf8e996040c9c22272fc7c09fb3c306759da0c` (macOS ARM64) and `da20138b13c3b30e83b46eb00d86d0281e76e972e15854ed806d8bc126247c92` (Linux ARM64). Both used Csound 6.18.1. Linux image: `sha256:15b0df8085cda76bc8e40c656aab054a13242c00f0d2673263fd18612dd7488a`.
