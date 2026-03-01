# Supported Opcodes

**Navigation:** [Up](instrument_design.md) | [Prev](instrument_import_export.md) | [Next](../performance/performance.md)

This appendix is generated from `backend/app/services/opcode_service.py` and currently lists **99** user-selectable opcodes in the Instrument Design opcode catalog.

## How To Use This Appendix

- Use the table for quick discovery (category, signal I/O, one-line purpose).
- In the app, click the `?` on an opcode node to open the integrated, localized documentation with port-level details and a Csound reference link.
- The `Inputs` / `Outputs` columns show port count and signal-rate shorthand.
- Signal legend: `a` = audio-rate, `k` = control-rate, `i` = init-rate, `S` = string, `f` = phase-vocoder frame signal.

## Category Counts

| Category | Count |
| --- | --- |
| analysis | 2 |
| constants | 3 |
| delay | 10 |
| distortion | 3 |
| dynamics | 2 |
| envelope | 7 |
| filter | 12 |
| fm | 7 |
| math | 2 |
| midi | 6 |
| mixer | 2 |
| modulation | 4 |
| noise | 3 |
| oscillator | 10 |
| output | 1 |
| physical_modeling | 5 |
| reverb | 1 |
| routing | 4 |
| soundfont | 3 |
| spectral | 8 |
| tables | 3 |
| utility | 1 |

## Opcode Index

### analysis

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| follow2 | 3 (a, k, k) | 1 (a) | Envelope follower with independent attack and release controls. |
| rms | 3 (a, i, i) | 1 (k) | RMS envelope follower for an audio signal. |

### constants

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| const_a | - | 1 (a) | Audio-rate constant value. |
| const_i | - | 1 (i) | Init-rate constant value. |
| const_k | - | 1 (k) | Control-rate constant value. |

### delay

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| comb | 4 (a, k, i, i) | 1 (a) | Comb filter / feedback delay. |
| delay | 3 (a, i, i) | 1 (a) | Simple non-interpolating audio delay line. |
| delayk | 3 (k, i, i) | 1 (k) | Control-rate delay line. |
| delayr | 2 (i, i) | 1 (a) | Read tap from a classic delay-line memory buffer. |
| delayw | 1 (a) | - | Write into the delay-line memory buffer. |
| deltap | 1 (k) | 1 (a) | Read a delay tap using linear interpolation. |
| deltap3 | 1 (k) | 1 (a) | Read a delay tap using cubic interpolation. |
| flanger | 4 (a, k, k, i) | 1 (a) | Flanger effect with delay modulation and feedback. |
| vdelay3 | 4 (a, k, i, i) | 1 (a) | Variable delay line with cubic interpolation. |
| vdelayxs | 5 (a, a, i, i, i) | 1 (a) | Variable delay with high-quality sinc interpolation. |

### distortion

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| clip | 4 (a, i, i, i) | 1 (a) | Signal clipper with selectable transfer curves. |
| distort1 | 6 (a, k, k, k, k, i) | 1 (a) | Waveshaping distortion with configurable transfer curve. |
| powershape | 3 (a, k, i) | 1 (a) | Power-law waveshaper for controllable nonlinear distortion. |

### dynamics

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| dam | 6 (a, k, i, i, i, i) | 1 (a) | Dynamic amplitude processor (downward compressor/noise suppressor). |
| limit | 3 (a, k, k) | 1 (a) | Hard clamp limiter. |

### envelope

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| adsr | 4 (i, i, i, i) | 1 (k) | Control-rate ADSR envelope. |
| expseg | 9 (i, i, i, i, i, i, i, i, i) | 1 (k) | Control-rate exponential breakpoint envelope generator. |
| expsega | 9 (i, i, i, i, i, i, i, i, i) | 1 (a) | Audio-rate exponential breakpoint envelope generator. |
| linseg | 7 (i, i, i, i, i, i, i) | 1 (k) | Control-rate linear breakpoint envelope generator. |
| linsegr | 5 (i, i, i, i, i) | 1 (k) | Control-rate linear breakpoint envelope with release segment. |
| madsr | 6 (i, i, i, i, i, i) | 1 (k) | MIDI release-sensitive ADSR envelope. |
| mxadsr | 6 (i, i, i, i, i, i) | 1 (k) | Extended MIDI release-sensitive ADSR envelope. |

### filter

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| butterbp | 4 (a, k, k, i) | 1 (a) | Second-order Butterworth band-pass filter. |
| butterbr | 4 (a, k, k, i) | 1 (a) | Second-order Butterworth band-reject filter. |
| butterhp | 3 (a, k, i) | 1 (a) | Second-order Butterworth high-pass filter. |
| butterlp | 3 (a, k, i) | 1 (a) | Second-order Butterworth low-pass filter. |
| diode_ladder | 6 (a, k, k, i, i, i) | 1 (a) | Diode ladder low-pass filter model. |
| exciter | 5 (a, k, k, k, k) | 1 (a) | Harmonic exciter that adds controlled upper partials. |
| fofilter | 5 (a, k, k, k, i) | 1 (a) | Formant filter. |
| moogladder | 3 (a, k, k) | 1 (a) | Moog ladder low-pass filter. |
| moogladder2 | 3 (a, k, k) | 1 (a) | Nonlinear Moog-style ladder filter with audio-rate modulation support. |
| rezzy | 5 (a, k, k, i, i) | 1 (a) | Resonant low-pass or high-pass filter. |
| tbvcf | 6 (a, k, k, k, k, i) | 1 (a) | TB-303 style voltage-controlled filter model. |
| vclpf | 4 (a, k, k, i) | 1 (a) | Virtual-analog low-pass filter. |

### fm

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| fmb3 | 10 (k, k, k, k, k, i, i, i, i, i) | 1 (a) | B3 organ FM model. |
| fmbell | 12 (k, k, k, k, k, k, i, i, i, i, i, i) | 1 (a) | Bell FM model. |
| fmmetal | 11 (k, k, k, k, k, k, i, i, i, i, i) | 1 (a) | Metallic FM model. |
| fmpercfl | 11 (k, k, k, k, k, k, i, i, i, i, i) | 1 (a) | Percussive flute FM model. |
| fmrhode | 11 (k, k, k, k, k, k, i, i, i, i, i) | 1 (a) | Rhodes electric piano FM model. |
| fmvoice | 11 (k, k, k, k, k, k, i, i, i, i, i) | 1 (a) | Voice-like FM model. |
| fmwurlie | 11 (k, k, k, k, k, k, i, i, i, i, i) | 1 (a) | Wurlitzer electric piano FM model. |

### math

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| a_mul | 2 (a, a) | 1 (a) | Multiply two audio signals. |
| k_mul | 2 (k, k) | 1 (k) | Multiply two control signals. |

### midi

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| ampmidi | 2 (i, i) | 1 (i) | Generate init-rate amplitude from MIDI note velocity. |
| ampmidicurve | 3 (k, k, k) | 1 (k) | Map MIDI velocity to gain using dynamic range and curve exponent. |
| ampmidid | 2 (k, i) | 1 (k) | Map MIDI velocity to amplitude using a decibel range. |
| cpsmidi | - | 1 (i) | Read active MIDI note pitch as cycles-per-second. |
| midi_note | 1 (i) | 2 (k, k) | Extract MIDI note frequency and velocity amplitude. |
| midictrl | 3 (i, i, i) | 1 (k) | Read a MIDI controller value with optional scaling. |

### mixer

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| mix2 | 2 (a, a) | 1 (a) | Mix two audio signals. |
| pan2 | 3 (a, k, i) | 2 (a, a) | Stereo panner. |

### modulation

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| lfo | 3 (k, k, i) | 1 (k) | Low-frequency oscillator for control-rate modulation. |
| samphold | 4 (k, k, i, i) | 1 (k) | Control-rate sample-and-hold processor. |
| vibr | 4 (k, k, i, i) | 1 (k) | Simple vibrato control oscillator with table lookup. |
| vibrato | 9 (k, k, k, k, k, k, k, k, i) | 1 (k) | Randomized vibrato generator. |

### noise

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| noise | 4 (k, k, i, i) | 1 (a) | Variable-color random audio noise. |
| pinker | - | 1 (a) | Pink noise generator. |
| pinkish | 2 (a, i) | 1 (a) | Pinkening filter for shaping white noise toward a pink spectrum. |

### oscillator

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| fof | 15 (k, k, k, k, k, k, k, k, i, i, i, i, i, i, i) | 1 (a) | Formant/granular source using sinusoid bursts. |
| fof2 | 15 (k, k, k, k, k, k, k, k, i, i, i, i, k, k, i) | 1 (a) | FOF source with per-grain phase indexing and glissando. |
| foscili | 7 (k, k, k, k, k, i, i) | 1 (a) | Audio-rate FM oscillator with harmonic ratios. |
| gbuzz | 7 (k, k, k, k, k, i, i) | 1 (a) | Generalized buzz oscillator with controllable harmonics. |
| oscil3 | 4 (k, k, i, i) | 1 (a) | Cubic-interpolating oscillator with low distortion. |
| oscili | 3 (k, k, i) | 1 (a) | Classic interpolating oscillator. |
| poscil3 | 4 (k, k, i, i) | 1 (a) | High-precision cubic interpolating oscillator. |
| syncphasor | 3 (k, a, i) | 2 (a, a) | Audio-rate normalized phase generator with sync trigger I/O. |
| vco | 5 (k, k, i, k, i) | 1 (a) | Band-limited voltage-controlled oscillator. |
| vco2 | 6 (k, k, i, k, k, i) | 1 (a) | Improved anti-aliased analog-style oscillator. |

### output

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| outs | 2 (a, a) | - | Stereo output sink. |

### physical_modeling

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| dripwater | 8 (k, i, i, i, i, i, i, i) | 1 (a) | Stochastic dripping-water physical model source. |
| marimba | 11 (k, k, i, i, i, k, k, i, i, i, i) | 1 (a) | Physical model of a marimba bar and resonator. |
| pluck | 6 (k, k, i, i, i, i) | 1 (a) | Karplus-Strong plucked-string model. |
| wgflute | 10 (k, k, k, i, i, k, k, k, i, i) | 1 (a) | Waveguide flute model. |
| wguide2 | 4 (a, k, k, k) | 1 (a) | Two-point waveguide resonator. |

### reverb

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| reverb2 | 5 (a, k, k, i, i) | 1 (a) | Schroeder reverb processor. |

### routing

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| inleta | 1 (S) | 1 (a) | Receive an audio-rate signal from a named instrument inlet port. |
| inletk | 1 (S) | 1 (k) | Receive a control-rate signal from a named instrument inlet port. |
| outleta | 2 (S, a) | - | Send an audio-rate signal to a named instrument outlet port. |
| outletk | 2 (S, k) | - | Send a control-rate signal to a named instrument outlet port. |

### soundfont

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| sfinstr3 | 8 (i, i, k, k, i, i, i, i) | 2 (a, a) | Play a SoundFont instrument as stereo audio with cubic interpolation. |
| sfload | 1 (S) | 1 (i) | Load a SoundFont2 file and return a file handle. |
| sfplay3 | 8 (i, i, k, k, i, i, i, i) | 2 (a, a) | Play a SoundFont preset as stereo audio with cubic interpolation. |

### spectral

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| pvsanal | 7 (a, i, i, i, i, i, i) | 1 (f) | Phase-vocoder analysis from an audio input to an fsig stream. |
| pvsmorph | 4 (f, f, k, k) | 1 (f) | Morph between two fsig streams by amplitude and frequency interpolation. |
| pvsmooth | 3 (f, k, k) | 1 (f) | Smooth fsig amplitude and frequency trajectories with lowpass filtering. |
| pvsosc | 8 (k, k, k, i, i, i, i, i) | 1 (f) | Generate oscillator spectra directly as an fsig stream. |
| pvshift | 6 (f, k, k, k, k, k) | 1 (f) | Shift fsig partial frequencies by a fixed amount in Hz. |
| pvsynth | 2 (f, i) | 1 (a) | Resynthesize audio from an fsig stream via overlap-add. |
| pvsvoc | 5 (f, f, k, k, k) | 1 (f) | Cross-synthesize fsig amplitudes and excitation frequencies. |
| pvswarp | 7 (f, k, k, k, k, k, k) | 1 (f) | Warp and shift the spectral envelope of an fsig stream. |

### tables

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| GEN | - | 1 (i) | Routine-aware function table generator (meta-opcode) that renders ftgen/ftgenonce from a specialized editor. |
| ftgen | 12 (i, i, i, i, i, i, i, i, i, i, i, i) | 1 (i) | Create a function table at init time using a GEN routine. |
| ftgenonce | 12 (i, i, i, i, i, i, i, i, i, i, i, i) | 1 (i) | Generate a function table once and reuse it across instances. |

### utility

| Opcode | Inputs | Outputs | Short Description |
| --- | --- | --- | --- |
| k_to_a | 1 (k) | 1 (a) | Interpolate control signal to audio-rate. |

**Navigation:** [Up](instrument_design.md) | [Prev](instrument_import_export.md) | [Next](../performance/performance.md)
