# Csound Opcode Notes Used by VisualCSound

This document stores per-opcode markdown used by the VisualCSound editor.
The text is rewritten for the VisualCSound node model, based on the official Csound manual.

### `const_a`

**Type:** VisualCSound helper node

Generates a constant audio-rate value by emitting an `a`-rate assignment line.

**Outputs**
- `aout` (`a-rate`): constant audio signal.

**Reference**
- [Csound opcode overview](https://csound.com/docs/manual/PartOpcodesOverview.html)

### `const_i`

**Type:** VisualCSound helper node

Generates a constant init-time value by emitting an `i`-rate assignment line.

**Outputs**
- `iout` (`i-rate`): init value.

**Reference**
- [Csound opcode overview](https://csound.com/docs/manual/PartOpcodesOverview.html)

### `const_k`

**Type:** VisualCSound helper node

Generates a constant control-rate value by emitting a `k`-rate assignment line.

**Outputs**
- `kout` (`k-rate`): control signal.

**Reference**
- [Csound opcode overview](https://csound.com/docs/manual/PartOpcodesOverview.html)

### `adsr`

**Underlying opcode:** `madsr`

MIDI-aware ADSR envelope generator. Unlike `adsr`, `madsr` is intended for real-time MIDI note lifecycle behavior.

**VisualCSound syntax**
- `kenv madsr iatt, idec, islev, irel`

**Inputs**
- `iatt` (`i-rate`): attack time.
- `idec` (`i-rate`): decay time.
- `islev` (`i-rate`): sustain level.
- `irel` (`i-rate`): release time.

**Output**
- `kenv` (`k-rate`): envelope signal.

**Reference**
- [madsr](https://csound.com/docs/manual/madsr.html)

### `oscili`

Linear-interpolating oscillator that reads a function table repeatedly at a target frequency.

**VisualCSound syntax**
- `asig oscili amp, freq, ifn`

**Inputs**
- `amp` (`k-rate`): amplitude.
- `freq` (`a/k/i-rate` accepted): frequency in cycles per second.
- `ifn` (`i-rate`): function table number (default `1` in VisualCSound).

**Output**
- `asig` (`a-rate`): oscillator signal.

**Reference**
- [oscili](https://csound.com/docs/manual/oscili.html)

### `vco`

Band-limited analog-modeled oscillator. Can produce saw, PWM/square, and triangle-like variants.

**VisualCSound syntax**
- `asig vco amp, freq, iwave, kpw, ifn`

**Inputs**
- `amp` (`k-rate`): amplitude.
- `freq` (`a/k/i-rate` accepted): oscillator frequency.
- `iwave` (`i-rate`): waveform selector (`1` saw, `2` square/PWM, `3` triangle/saw/ramp).
- `kpw` (`k-rate`, optional): pulse width / shape control.
- `ifn` (`i-rate`, optional): sine table used by internals.

**Output**
- `asig` (`a-rate`): oscillator signal.

**Reference**
- [vco](https://csound.com/docs/manual/vco.html)

### `ftgen`

Creates a function table from orchestra code (equivalent to score `f` statements).

**VisualCSound syntax**
- `ift ftgen ifn, itime, isize, igen, iarg1, ...`

**Inputs**
- `ifn` (`i-rate`): requested table number (`0` for automatic assignment).
- `itime` (`i-rate`): score-style time field (typically `0` for init-time creation).
- `isize` (`i-rate`): table size.
- `igen` (`i-rate`): GEN routine.
- `iarg1..iarg8` (`i-rate`): GEN arguments.

**Output**
- `ift` (`i-rate`): resolved function table number.

**Reference**
- [ftgen](https://csound.com/docs/manual/ftgen.html)

### `moogladder`

Digital Moog ladder low-pass filter model with resonance feedback.

**VisualCSound syntax**
- `aout moogladder ain, kcf, kres`

**Inputs**
- `ain` (`a-rate`): input signal.
- `kcf` (`k-rate`): cutoff frequency.
- `kres` (`k-rate`): resonance amount.

**Output**
- `aout` (`a-rate`): filtered signal.

**Reference**
- [moogladder](https://csound.com/docs/manual/moogladder.html)

### `k_mul`

**Type:** VisualCSound helper node

Multiplies two control-rate signals.

**Inputs**
- `a` (`k-rate`): left operand.
- `b` (`k-rate`): right operand.

**Output**
- `kout` (`k-rate`): product.

**Reference**
- [Csound opcode overview](https://csound.com/docs/manual/PartOpcodesOverview.html)

### `a_mul`

**Type:** VisualCSound helper node

Multiplies two audio-rate signals.

**Inputs**
- `a` (`a-rate`): left operand.
- `b` (`a-rate`): right operand.

**Output**
- `aout` (`a-rate`): product.

**Reference**
- [Csound opcode overview](https://csound.com/docs/manual/PartOpcodesOverview.html)

### `mix2`

**Type:** VisualCSound helper node

Sums two audio signals into one audio output.

**Inputs**
- `a` (`a-rate`): first signal.
- `b` (`a-rate`): second signal.

**Output**
- `aout` (`a-rate`): mixed signal.

**Reference**
- [Csound opcode overview](https://csound.com/docs/manual/PartOpcodesOverview.html)

### `outs`

Stereo audio output opcode.

**VisualCSound syntax**
- `outs left, right`

**Inputs**
- `left` (`a-rate`): left channel signal.
- `right` (`a-rate`): right channel signal.

**Output**
- none (sink node).

**Reference**
- [outs](https://csound.com/docs/manual/outs.html)

### `midi_note`

**Type:** VisualCSound composite node

Convenience MIDI source that combines pitch and velocity extraction.

**VisualCSound expansion**
- `kfreq cpsmidi`
- `kamp ampmidi gain`

**Inputs**
- `gain` (`i-rate`, optional): velocity scaling.

**Outputs**
- `kfreq` (`k-rate`): note frequency in Hz.
- `kamp` (`k-rate`): velocity-derived amplitude.

**Reference**
- [cpsmidi](https://csound.com/docs/manual/cpsmidi.html)
- [ampmidi](https://csound.com/docs/manual/ampmidi.html)

### `cpsmidi`

Reads the current MIDI note and returns pitch in cycles per second.

**VisualCSound syntax**
- `kfreq cpsmidi`

**Inputs**
- none.

**Output**
- `kfreq` (`i-rate` in current VisualCSound typing): MIDI pitch in Hz for the active MIDI-triggered note.

**Reference**
- [cpsmidi](https://csound.com/docs/manual/cpsmidi.html)

### `midictrl`

Reads the value of a MIDI controller, with optional min/max scaling.

**VisualCSound syntax**
- `kval midictrl inum, imin, imax`

**Inputs**
- `inum` (`i-rate`): controller number (`0..127`).
- `imin` (`i-rate`, optional): minimum output value.
- `imax` (`i-rate`, optional): maximum output value.

**Output**
- `kval` (`k-rate`): scaled controller value.

**Reference**
- [midictrl](https://csound.com/docs/manual/midictrl.html)

### `k_to_a`

**Underlying opcode:** `interp`

Converts a control-rate signal to audio-rate with linear interpolation between control steps.

**VisualCSound syntax**
- `aout interp kin`

**Input**
- `kin` (`k-rate`): control signal.

**Output**
- `aout` (`a-rate`): interpolated audio signal.

**Reference**
- [interp](https://csound.com/docs/manual/interp.html)

### `madsr`

MIDI release-sensitive ADSR envelope.

**VisualCSound syntax**
- `kenv madsr iatt, idec, islev, irel, idel`

**Inputs**
- `iatt` (`i-rate`, default `0.01`): Attack.
- `idec` (`i-rate`, default `0.15`): Decay.
- `islev` (`i-rate`, default `0.7`): Sustain.
- `irel` (`i-rate`, default `0.2`): Release.
- `idel` (`i-rate`, optional, default `0`): Delay.

**Outputs**
- `kenv` (`k-rate`): kEnv.

**Reference**
- [madsr](https://csound.com/docs/manual/madsr.html)

### `mxadsr`

Extended MIDI release-sensitive ADSR envelope.

**VisualCSound syntax**
- `kenv mxadsr iatt, idec, islev, irel, idel, iatss, idrss`

**Inputs**
- `iatt` (`i-rate`, default `0.01`): Attack.
- `idec` (`i-rate`, default `0.15`): Decay.
- `islev` (`i-rate`, default `0.7`): Sustain.
- `irel` (`i-rate`, default `0.2`): Release.
- `idel` (`i-rate`, optional, default `0`): Delay.
- `iatss` (`i-rate`, optional, default `0`): AttackScale.
- `idrss` (`i-rate`, optional, default `0`): ReleaseScale.

**Outputs**
- `kenv` (`k-rate`): kEnv.

**Reference**
- [mxadsr](https://csound.com/docs/manual/mxadsr.html)

### `poscil3`

High-precision cubic interpolating oscillator.

**VisualCSound syntax**
- `asig poscil3 amp, freq, ifn, iphs`

**Inputs**
- `amp` (`k-rate; accepts a-rate/k-rate/i-rate`, default `0.4`): Amplitude.
- `freq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `ifn` (`i-rate`, optional, default `1`): FunctionTable.
- `iphs` (`i-rate`, optional): Phase.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [poscil3](https://csound.com/docs/manual/poscil3.html)

### `lfo`

Low-frequency oscillator for control-rate modulation.

**VisualCSound syntax**
- `kout lfo kamp, kcps, itype`

**Inputs**
- `kamp` (`k-rate; accepts a-rate/k-rate/i-rate`, default `0.5`): Amplitude.
- `kcps` (`k-rate; accepts a-rate/k-rate/i-rate`, default `5`): Rate.
- `itype` (`i-rate`, optional, default `0`): Waveform.

**Outputs**
- `kout` (`k-rate`): kOut.

**Reference**
- [lfo](https://csound.com/docs/manual/lfo.html)

### `vibr`

Simple vibrato control oscillator with table lookup.

**VisualCSound syntax**
- `kout vibr amp, cps, ifn, iphs`

**Inputs**
- `amp` (`k-rate; accepts a-rate/k-rate/i-rate`, default `0.01`): Amplitude.
- `cps` (`k-rate; accepts a-rate/k-rate/i-rate`, default `6`): Rate.
- `ifn` (`i-rate`, default `1`): FunctionTable.
- `iphs` (`i-rate`, optional): Phase.

**Outputs**
- `kout` (`k-rate`): kOut.

**Reference**
- [vibr](https://csound.com/docs/manual/vibr.html)

### `vibrato`

Randomized vibrato generator.

**VisualCSound syntax**
- `kout vibrato kavgamp, kavgfreq, krandamp, krandfreq, kampminrate, kampmaxrate, kcpsminrate, kcpsmaxrate, ifn`

**Inputs**
- `kavgamp` (`k-rate`, default `0.01`): AverageAmp.
- `kavgfreq` (`k-rate`, default `6`): AverageFreq.
- `krandamp` (`k-rate`, default `0.05`): RandAmp.
- `krandfreq` (`k-rate`, default `0.1`): RandFreq.
- `kampminrate` (`k-rate`, default `3`): AmpMinRate.
- `kampmaxrate` (`k-rate`, default `7`): AmpMaxRate.
- `kcpsminrate` (`k-rate`, default `3`): FreqMinRate.
- `kcpsmaxrate` (`k-rate`, default `7`): FreqMaxRate.
- `ifn` (`i-rate`, default `1`): FunctionTable.

**Outputs**
- `kout` (`k-rate`): kOut.

**Reference**
- [vibrato](https://csound.com/docs/manual/vibrato.html)

### `fmb3`

Hammond B3-style FM voice from Csound's TX81Z-style FM family.

**VisualCSound syntax**
- `asig fmb3 kamp, kfreq, kindex, kcrossfreq, ifn1, ifn2, ivfn`

This VisualCSound node exposes a compact control set for the B3 preset behavior.

**Inputs**
- `kamp` (`k-rate`, default `0.4`): output amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): played pitch in Hz.
- `kindex` (`k-rate`, default `2`): FM modulation index (higher values increase brightness/complexity).
- `kcrossfreq` (`k-rate`, default `2`): cross-modulation / timbre control between operators.
- `ifn1` (`i-rate`, default `1`): primary waveform table.
- `ifn2` (`i-rate`, default `1`): secondary waveform table.
- `ivfn` (`i-rate`, default `1`): vibrato/LFO table (typically a sine table).

**Outputs**
- `asig` (`a-rate`): synthesized audio output.

**Reference**
- [fmb3](https://csound.com/docs/manual/fmb3.html)

### `fmbell`

Bell FM model.

**VisualCSound syntax**
- `asig fmbell kamp, kfreq, kc1, kc2, kvdepth, ifn1, ifn2, ivfn`

**Inputs**
- `kamp` (`k-rate`, default `0.4`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kc1` (`k-rate`, default `2`): CarrierRatio1.
- `kc2` (`k-rate`, default `3`): CarrierRatio2.
- `kvdepth` (`k-rate`, default `0.1`): VibratoDepth.
- `ifn1` (`i-rate`, default `1`): CarrierTable.
- `ifn2` (`i-rate`, default `1`): ModTable.
- `ivfn` (`i-rate`, default `1`): VibratoTable.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [fmbell](https://csound.com/docs/manual/fmbell.html)

### `fmmetal`

Metallic FM model.

**VisualCSound syntax**
- `asig fmmetal kamp, kfreq, kc1, kc2, kvdepth, ifn1, ifn2, ivfn`

**Inputs**
- `kamp` (`k-rate`, default `0.4`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kc1` (`k-rate`, default `2`): CarrierRatio1.
- `kc2` (`k-rate`, default `3`): CarrierRatio2.
- `kvdepth` (`k-rate`, default `0.1`): VibratoDepth.
- `ifn1` (`i-rate`, default `1`): CarrierTable.
- `ifn2` (`i-rate`, default `1`): ModTable.
- `ivfn` (`i-rate`, default `1`): VibratoTable.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [fmmetal](https://csound.com/docs/manual/fmmetal.html)

### `fmpercfl`

Percussive flute FM model.

**VisualCSound syntax**
- `asig fmpercfl kamp, kfreq, kc1, kc2, kvdepth, ifn1, ifn2, ivfn`

**Inputs**
- `kamp` (`k-rate`, default `0.4`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kc1` (`k-rate`, default `2`): CarrierRatio1.
- `kc2` (`k-rate`, default `3`): CarrierRatio2.
- `kvdepth` (`k-rate`, default `0.1`): VibratoDepth.
- `ifn1` (`i-rate`, default `1`): CarrierTable.
- `ifn2` (`i-rate`, default `1`): ModTable.
- `ivfn` (`i-rate`, default `1`): VibratoTable.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [fmpercfl](https://csound.com/docs/manual/fmpercfl.html)

### `fmrhode`

Rhodes electric piano FM model.

**VisualCSound syntax**
- `asig fmrhode kamp, kfreq, kc1, kc2, kvdepth, ifn1, ifn2, ivfn`

**Inputs**
- `kamp` (`k-rate`, default `0.4`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kc1` (`k-rate`, default `2`): CarrierRatio1.
- `kc2` (`k-rate`, default `3`): CarrierRatio2.
- `kvdepth` (`k-rate`, default `0.1`): VibratoDepth.
- `ifn1` (`i-rate`, default `1`): CarrierTable.
- `ifn2` (`i-rate`, default `1`): ModTable.
- `ivfn` (`i-rate`, default `1`): VibratoTable.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [fmrhode](https://csound.com/docs/manual/fmrhode.html)

### `fmvoice`

Voice-like FM model.

**VisualCSound syntax**
- `asig fmvoice kamp, kfreq, kc1, kc2, kvdepth, ifn1, ifn2, ivfn`

**Inputs**
- `kamp` (`k-rate`, default `0.4`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kc1` (`k-rate`, default `2`): CarrierRatio1.
- `kc2` (`k-rate`, default `3`): CarrierRatio2.
- `kvdepth` (`k-rate`, default `0.1`): VibratoDepth.
- `ifn1` (`i-rate`, default `1`): CarrierTable.
- `ifn2` (`i-rate`, default `1`): ModTable.
- `ivfn` (`i-rate`, default `1`): VibratoTable.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [fmvoice](https://csound.com/docs/manual/fmvoice.html)

### `fmwurlie`

Wurlitzer electric piano FM model.

**VisualCSound syntax**
- `asig fmwurlie kamp, kfreq, kc1, kc2, kvdepth, ifn1, ifn2, ivfn`

**Inputs**
- `kamp` (`k-rate`, default `0.4`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kc1` (`k-rate`, default `2`): CarrierRatio1.
- `kc2` (`k-rate`, default `3`): CarrierRatio2.
- `kvdepth` (`k-rate`, default `0.1`): VibratoDepth.
- `ifn1` (`i-rate`, default `1`): CarrierTable.
- `ifn2` (`i-rate`, default `1`): ModTable.
- `ivfn` (`i-rate`, default `1`): VibratoTable.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [fmwurlie](https://csound.com/docs/manual/fmwurlie.html)

### `pinker`

Pink noise generator.

**VisualCSound syntax**
- `aout pinker`

**Inputs**
- none.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [pinker](https://csound.com/docs/manual/pinker.html)

### `noise`

Variable-color random audio noise.

**VisualCSound syntax**
- `aout noise amp, beta, iseed, iskip`

**Inputs**
- `amp` (`k-rate; accepts a-rate/k-rate/i-rate`, default `0.25`): Amplitude.
- `beta` (`k-rate; accepts k-rate/i-rate`, default `0`): Color.
- `iseed` (`i-rate`, optional): Seed.
- `iskip` (`i-rate`, optional): SkipInit.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [noise](https://csound.com/docs/manual/noise.html)

### `pluck`

Karplus-Strong plucked-string model.

**VisualCSound syntax**
- `asig pluck kamp, kcps, icps, ifn, imeth, iparm1`

**Inputs**
- `kamp` (`k-rate`, default `0.3`): Amplitude.
- `kcps` (`k-rate; accepts a-rate/k-rate/i-rate`, default `220`): Frequency.
- `icps` (`i-rate`, default `220`): InitFrequency.
- `ifn` (`i-rate`, default `1`): FunctionTable.
- `imeth` (`i-rate`, default `1`): Method.
- `iparm1` (`i-rate`, optional): MethodParam.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [pluck](https://csound.com/docs/manual/pluck.html)

### `wgflute`

Waveguide flute model.

**VisualCSound syntax**
- `asig wgflute kamp, kfreq, kjet, iatt, idetk, kngain, kvibf, kvamp, ifn, iminfreq`

**Inputs**
- `kamp` (`k-rate`, default `0.3`): Amplitude.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `440`): Frequency.
- `kjet` (`k-rate`, default `0.2`): Jet.
- `iatt` (`i-rate`, default `0.03`): Attack.
- `idetk` (`i-rate`, default `0.1`): Detune.
- `kngain` (`k-rate`, default `0.1`): NoiseGain.
- `kvibf` (`k-rate`, default `5`): VibratoRate.
- `kvamp` (`k-rate`, default `0.02`): VibratoDepth.
- `ifn` (`i-rate`, default `1`): FunctionTable.
- `iminfreq` (`i-rate`, optional): MinFreq.

**Outputs**
- `asig` (`a-rate`): aSig.

**Reference**
- [wgflute](https://csound.com/docs/manual/wgflute.html)

### `wguide2`

Two-point waveguide resonator.

**VisualCSound syntax**
- `aout wguide2 asig, xfreq, xcutoff, kfeedback`

**Inputs**
- `asig` (`a-rate`): aIn.
- `xfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `220`): Frequency.
- `xcutoff` (`k-rate; accepts a-rate/k-rate/i-rate`, default `4000`): Cutoff.
- `kfeedback` (`k-rate`, default `0.5`): Feedback.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [wguide2](https://csound.com/docs/manual/wguide2.html)

### `vdelay3`

Variable delay line with cubic interpolation.

**VisualCSound syntax**
- `aout vdelay3 asig, adel, imd, iws`

**Inputs**
- `asig` (`a-rate`): aIn.
- `adel` (`k-rate; accepts a-rate/k-rate/i-rate`, default `20`): DelayTime.
- `imd` (`i-rate`, default `100`): MaxDelay.
- `iws` (`i-rate`, optional): WindowSize.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [vdelay3](https://csound.com/docs/manual/vdelay3.html)

### `flanger`

Flanger effect with delay modulation and feedback.

**VisualCSound syntax**
- `aout flanger asig, adel, kfeedback, imaxd`

**Inputs**
- `asig` (`a-rate`): aIn.
- `adel` (`k-rate; accepts a-rate/k-rate/i-rate`, default `3`): DelayTime.
- `kfeedback` (`k-rate`, default `0.3`): Feedback.
- `imaxd` (`i-rate`, optional): MaxDelay.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [flanger](https://csound.com/docs/manual/flanger.html)

### `comb`

Comb filter / feedback delay.

**VisualCSound syntax**
- `aout comb asig, krvt, ilpt, iskip`

**Inputs**
- `asig` (`a-rate`): aIn.
- `krvt` (`k-rate`, default `2`): ReverbTime.
- `ilpt` (`i-rate`, default `0.05`): LoopTime.
- `iskip` (`i-rate`, optional): SkipInit.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [comb](https://csound.com/docs/manual/comb.html)

### `reverb2`

Schroeder reverb processor.

**VisualCSound syntax**
- `aout reverb2 asig, krvt, khf, israte, iskip`

**Inputs**
- `asig` (`a-rate`): aIn.
- `krvt` (`k-rate`, default `1.5`): ReverbTime.
- `khf` (`k-rate`, default `0.5`): HighFreqDamp.
- `israte` (`i-rate`, optional): SampleRateScale.
- `iskip` (`i-rate`, optional): SkipInit.

**Outputs**
- `aout` (`a-rate`): aOut.

**Reference**
- [reverb2](https://csound.com/docs/manual/reverb2.html)

### `limit`

Hard clamp limiter.

**VisualCSound syntax**
- `xout limit xin, xmin, xmax`

**Inputs**
- `xin` (`a-rate; accepts a-rate/k-rate/i-rate`): Input.
- `xmin` (`k-rate; accepts k-rate/i-rate`, default `-0.8`): Min.
- `xmax` (`k-rate; accepts k-rate/i-rate`, default `0.8`): Max.

**Outputs**
- `xout` (`a-rate`): aOut.

**Reference**
- [limit](https://csound.com/docs/manual/limit.html)

### `exciter`

Non-linear harmonic exciter ("filtered distortion") that adds brilliance to input audio.

**VisualCSound syntax**
- `aout exciter asig, kfreq, kceil, kharmonics, kblend`

**Inputs**
- `asig` (`a-rate`): input audio signal to excite.
- `kfreq` (`k-rate; accepts a-rate/k-rate/i-rate`, default `2500`): lower edge of generated harmonics.
- `kceil` (`k-rate; accepts a-rate/k-rate/i-rate`, default `12000`): upper edge of generated harmonics.
- `kharmonics` (`k-rate; accepts k-rate/i-rate`, default `1`): harmonic amount (`0.1..10` typical).
- `kblend` (`k-rate; accepts k-rate/i-rate`, default `0.5`): balance of 2nd/3rd-order harmonics (`-10..10`).

**Outputs**
- `aout` (`a-rate`): excited output audio.

**Notes**
- `exciter` is a plugin opcode; availability depends on the installed Csound build.

**Reference**
- [exciter](https://csound.com/docs/manual/exciter.html)

### `pan2`

Stereo panner.

**VisualCSound syntax**
- `aleft, aright pan2 asig, xp, imode`

**Inputs**
- `asig` (`a-rate`): aIn.
- `xp` (`k-rate; accepts a-rate/k-rate/i-rate`, default `0.5`): Pan.
- `imode` (`i-rate`, optional, default `0`): Mode.

**Outputs**
- `aleft` (`a-rate`): aLeft.
- `aright` (`a-rate`): aRight.

**Reference**
- [pan2](https://csound.com/docs/manual/pan2.html)
