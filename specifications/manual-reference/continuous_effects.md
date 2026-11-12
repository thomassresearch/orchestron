# Continuous Effects — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

The graph computes `M=(L+R)/2`, `S=(L−R)/2`, then `S'=Width × (S + MonoWidening × (M−delayedM)/2)`. Its outputs are `M+S'` and `M−S'`, followed by Output gain.

Quantization uses signed codes from −1 to `1−1/Q`, with `Q=2^(BitDepth−1)`, rounding to the nearest code. Zero remains zero; no dither is added. At 2 bits, quiet inputs below ±0.25 quantize to silence; raise Drive to bring them above that threshold. The sample holder initializes to silence for its first sample. Drive affects the processed path only. Mix 0 gives the original input, and Mix 1 gives the processed signal; Output gain follows the blend. For a send return use Mix 1.

Two spectral pitch shifters add fixed harmony voices. Intervals round with `floor(interval+0.5)` and convert to frequency ratios using `2^(interval/12)`. The defaults add a fifth and an octave. Set either voice level to zero to mute it. If the level sum exceeds 1, both levels are divided by their sum before mixing with the dry signal.

The graph uses a 1024-sample Hann analysis window and FFT, with a 256-sample hop, followed by `pvscale` and `pvsynth`. **Measured processing latency is 1536 samples (32 ms at 48 kHz)** on the validated Csound 6.18 runtime. The dry path uses the same delay, including at Mix 0. Use Mix 1 for a send return; a separate undelayed parallel dry route will still differ in timing. This measured delay supersedes the 1024-sample figure in the manual's illustrative example.

See the [example README](../../examples/instruments/continuous_effects/README.md) for builders and validation commands. Auditions compare mono chords, stereo pitches, and transient noise at defaults and controller endpoints. Tests use independent fixtures. Audio and measurements are written under `output/continuous-effects/`.
