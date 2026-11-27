# DX7 voice qualification

The three original single-voice SysEx fixtures in [backend/tests/fixtures/dx7](../../backend/tests/fixtures/dx7) exercise different parts of the UDO. Tine Keys uses velocity-sensitive modulators in algorithm 5. Iron Bell mixes fixed-frequency and ratio operators in algorithm 3. Loop Brass uses maximum feedback around the three-operator loop in algorithm 4.

## Measured results

The comparison used the dry voice output of **Dexed 0.9.4, EngineMkI**, with equal temperament, the velocity-normalization option off and the same SysEx bytes in both engines. The C++ harness links Dexed’s own note, envelope, LFO and Mark I code. Orchestron used its compiled graph, MIDI scheduler, stereo panner and mixer. The reference received the same fixed output gain and center pan. Files for listening use one common gain for both renderers and velocities within each patch.

Each patch played MIDI keys 48, 60 and 84 at velocities 40 and 112, with both a 64 ms and a 640 ms gate. Attack covers the first 64 ms. Body covers the second half of the gate. The spectral metric is cosine similarity of mean Hann-windowed FFT magnitudes (1,024 samples, 512-sample hop). A value of 1 means equal spectral shape under this metric. Level and release measurements use unnormalized RMS. Release compares the first 128 ms after key-up relative to the body for that note.

| Patch | Lowest attack similarity | Lowest body similarity | Largest body level error | Largest relative release error |
| --- | ---: | ---: | ---: | ---: |
| Tine Keys | 0.9999 | 0.9999 | 0.15 dB | 0.13 dB |
| Iron Bell | 0.9995 | 0.9979 | 0.23 dB | 0.19 dB |
| Loop Brass | 0.9705 | 0.9435 | 0.16 dB | 0.56 dB |

### Polyphony

On an Apple M2 Max with Csound 6.18 (double precision), the test rendered 385 consecutive 512-frame refills at 48 kHz, with `ksmps=32`, on one renderer. It included host MIDI scheduling and the compiled rack mixer. All note-ons arrived together at sample zero. Csound reported the requested simultaneous instance count on every refill. A separate regression sums 16 individually rendered notes and compares them with the complete chord, including independent note-offs. The timings below are a local render budget measurement. Browser transport, audio-device latency and additional rack effects are outside the measurement.

| Patch | 8 voices, speed | 16 voices, speed | 16 voices, first refill | 16 voices, p99 refill |
| --- | ---: | ---: | ---: | ---: |
| Tine Keys | 13.2× real time | 6.8× | 11.30 ms | 1.85 ms |
| Iron Bell | 18.2× | 9.5× | 11.24 ms | 1.40 ms |
| Loop Brass | 10.1× | 5.2× | 12.20 ms | 2.52 ms |

All 8-voice refills met the 10.67 ms deadline. At 16 voices, only the first simultaneous attack exceeded it, on each patch. All remaining 384 refills per patch met the deadline. The full per-note and timing measurements are in [results.json](results.json).

## Reproduce

From the repository root, use the project’s Python development environment and Csound, plus a C++ compiler. Download and extract the [Dexed v0.9.4 source](https://github.com/asb2m10/dexed/tree/v0.9.4) in a temporary directory. The tag archive used here has SHA-256 `628741d8cb9f3f3c06da7281ce58145a85d5daeee97c33f368eca88d7c7e666f`.

```sh
DEXED_SRC=/path/to/dexed-0.9.4/Source
c++ -std=c++11 -O2 -fwrapv -I"$DEXED_SRC" tools/dx7/mark_i.cpp \
  "$DEXED_SRC/EngineMkI.cpp" "$DEXED_SRC"/msfa/*.cc -o /tmp/dx7-mark-i
PYTHONPATH=. .venv/bin/python tools/dx7/qualify.py /tmp/dx7-mark-i output/dx7-milestone
```

The command writes the measurements and three WAVs. Each WAV plays middle C softly on Orchestron, then Dexed, then repeats the pair with a hard strike. The reference executable is needed only for the comparison. An exported Orchestron CSD renders with stock Csound.

## Fidelity and source credit

The importer also decoded all 1,056 programs in the 33 cartridges supplied with Dexed 0.9.4. Two programs in its starter cartridge use a fine-tuning value of 127. The importer preserves the full seven-bit fine value and the UDO applies the same frequency formula.

The UDO implements all 32 routings, including the multi-operator feedback loops, four-rate/four-level operator and pitch envelopes, fixed and ratio tuning, keyboard and velocity scaling, and pitch/amplitude LFO modulation. It uses floating-point oscillators at the project sample rate. Envelope updates follow the project control interval and feedback runs sample by sample. The unsynchronized oscillator phase and sample-and-hold LFO are approximations. A nonzero final carrier level fades out at the end of a finite release. The three-patch comparison covers representative sounds and leaves other parameter combinations and original DX7 hardware unqualified.

The calibration tables and equations in `backend/app/data/dx7_curves.json` and `fm_dx7.orc` adapt the Apache-2.0 MSFA work by Google Inc. (2012–2013) and Pascal Gauthier (2016–2017) to floating-point Csound. The C++ Mark I engine is linked only in the external reference harness. [MSFA source in Dexed](https://github.com/asb2m10/dexed/tree/v0.9.4/Source/msfa) · [Apache 2.0 license](../../backend/app/data/dx7-apache-license.txt) · [DX7 algorithm hardware](https://www.righto.com/2021/12/yamaha-dx7-chip-reverse-engineering.html)
