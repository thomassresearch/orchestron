# DX7 voice qualification

The three original single-voice SysEx fixtures in [backend/tests/fixtures/dx7](../../backend/tests/fixtures/dx7) exercise different parts of the UDO. Tine Keys uses velocity-sensitive modulators in algorithm 5. Iron Bell mixes fixed-frequency and ratio operators in algorithm 3. Loop Brass uses maximum feedback around the three-operator loop in algorithm 4.

## Measured results

The before render used revision `39d1a6eb`. Both revisions used identical SysEx, MIDI keys 48, 60 and 84, velocities 40 and 112, 64 ms and 640 ms gates, 48 kHz audio and `ksmps=32`. The reference was the dry voice output of **Dexed 0.9.4 EngineMkI** with velocity normalization off. The three fixtures cover 36 cases. Turning off only Loop Brass feedback adds 12 control cases.

Attack covers the first 64 ms. Body covers the second half of the gate. Spectral similarity is the cosine between mean Hann-windowed FFT magnitudes (1,024 samples, 512-sample hop). A value of 1 indicates identical spectral shape under this metric. Relative release compares RMS in the first 128 ms after key-up to the body RMS. Both Orchestron revisions include the 4 ms onset taper and 10 ms minimum release smoothing.

| Voice | Worst attack, before → after | Worst body, before → after | Largest relative release error, before → after |
| --- | ---: | ---: | ---: |
| Tine Keys | 0.99994 → 0.99994 | 0.99993 → 0.99993 | 0.32 → 0.32 dB |
| Iron Bell | 0.99951 → 0.99951 | 0.99788 → 0.99788 | 0.18 → 0.18 dB |
| Loop Brass, feedback 7 | 0.97047 → 0.98285 | 0.94355 → 0.999999 | 0.87 → 0.91 dB |
| Loop Brass, feedback 0 | 0.99749 → 0.99749 | 0.99996 → 0.99996 | 0.62 → 0.62 dB |

**Carrier balance.** With only OP1 turned up, the measured RMS for algorithm 16 went from −41.10 to −25.53 dBFS. Algorithm 32 went from −41.09 to −41.33 dBFS. Their separation is now 15.80 dB. The hardware stores six compensation values in eighths of an octave of amplitude attenuation (0, 8, 13, 16, 19 and 21). The routing selects a value by its total carrier count, including carriers with their output level set to zero. [Decoded OPS compensation ROM](https://www.righto.com/2021/12/yamaha-dx7-chip-reverse-engineering.html)

The dry reference uses the previous fixed gain of one sixth, plus the same −12 dB graph gain and equal-power center pan. The raw `body_db_delta` in [results.json](results.json) therefore includes the change in carrier balance. Its expected gain contribution is +5.78 dB for Tine Keys and +9.54 dB for Iron Bell and Loop Brass. Removing that known difference leaves maximum body level errors of 0.15 dB, 0.23 dB and less than 0.01 dB respectively. The separate carrier probe measures the actual output with one common gain throughout.

### Polyphony

An Apple M2 Max with double-precision Csound 6.18 rendered 385 consecutive 512-frame refills at 48 kHz with `ksmps=32`. All notes started at sample zero. The run includes host MIDI scheduling and the compiled mixer. Each refill has 10.67 ms available.

| Voice | 8 voices, speed | 16 voices, speed | 16 voices, first refill | 16 voices, p99 refill |
| --- | ---: | ---: | ---: | ---: |
| Tine Keys | 8.5× | 4.2× | 18.42 ms | 2.95 ms |
| Iron Bell | 13.5× | 6.7× | 16.88 ms | 1.99 ms |
| Loop Brass | 5.6× | 2.7× | 20.50 ms | 4.39 ms |

Before the change, 16-voice Loop Brass rendered at 4.4× real time. Each 16-voice run exceeded the deadline on its first refill. All subsequent refills met the deadline at both voice counts. The full measurements include the eight-voice attack timings.

## Reproduce

From the repository root, use the project’s Python development environment and Csound, plus a C++ compiler. Download and extract the [Dexed v0.9.4 source](https://github.com/asb2m10/dexed/tree/v0.9.4) in a temporary directory. The tag archive used here has SHA-256 `628741d8cb9f3f3c06da7281ce58145a85d5daeee97c33f368eca88d7c7e666f`.

```sh
DEXED_SRC=/path/to/dexed-0.9.4/Source
c++ -std=c++11 -O2 -fwrapv -I"$DEXED_SRC" tools/dx7/mark_i.cpp \
  "$DEXED_SRC/EngineMkI.cpp" "$DEXED_SRC"/msfa/*.cc -o /tmp/dx7-mark-i
PYTHONPATH=. .venv/bin/python tools/dx7/qualify.py /tmp/dx7-mark-i output/dx7-milestone
```

The command writes the per-note measurements, four audition WAVs and the reference spectra. To refresh the feedback regression fixture, copy the generated `mark_i_feedback_spectra.npz` to `backend/tests/fixtures/dx7/` after verifying the independent reference. The spectra cover the body of MIDI key 60 at velocity 112 and a 64 ms gate using Loop Brass in algorithms 3, 4 and 6. Each WAV plays middle C softly on Orchestron, then Dexed, then repeats the pair with a hard strike. The reference executable is needed only for the comparison. An exported Orchestron CSD renders with stock Csound.

## Fidelity and source credit

The importer also decoded all 1,056 programs in the 33 cartridges supplied with Dexed 0.9.4. Two programs in its starter cartridge use a fine-tuning value of 127. The importer preserves the full seven-bit fine value and the UDO applies the same frequency formula.

The UDO implements all 32 routings, including the multi-operator feedback loops, four-rate/four-level operator and pitch envelopes, fixed and ratio tuning, keyboard and velocity scaling, and pitch/amplitude LFO modulation. Active feedback uses Q24 phase increments at the project sample rate. Each loop operator addresses a 4,096-step midpoint sine in the log domain, combines it with quantized attenuation and feeds the reconstructed signed magnitude to the next operator. The two-sample feedback history belongs to the note. The return gain for a loop ending in a carrier is calibrated separately from its audible output level. Feed-forward operators use floating-point sines. Envelope updates follow the project control interval. [DX7 log-sine ROM](https://www.righto.com/2021/12/yamaha-dx7-reverse-engineering-part-iii.html) · [DX7 exponential circuit](https://www.righto.com/2021/11/reverse-engineering-yamaha-dx7_28.html)

The unsynchronized oscillator phase and sample-and-hold LFO are approximations. A nonzero final carrier level fades out at the end of a finite release. The three-patch comparison covers representative sounds and leaves other parameter combinations and original DX7 hardware unqualified.

The calibration tables and equations in `backend/app/data/dx7_curves.json` and `fm_dx7.orc` adapt the Apache-2.0 MSFA work by Google Inc. (2012–2013) and Pascal Gauthier (2016–2017) to floating-point Csound. The C++ Mark I engine is linked only in the external reference harness. [MSFA source in Dexed](https://github.com/asb2m10/dexed/tree/v0.9.4/Source/msfa) · [Apache 2.0 license](../../backend/app/data/dx7-apache-license.txt) · [DX7 algorithm hardware](https://www.righto.com/2021/12/yamaha-dx7-chip-reverse-engineering.html)
