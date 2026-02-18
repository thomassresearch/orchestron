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
