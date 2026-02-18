# CSound Opcodes Implemented in VisualCSound

This file documents the opcode nodes currently implemented in VisualCSound.

Rate types used below:
- `a-rate`: audio signal
- `k-rate`: control signal
- `i-rate`: init-time value

## Constants

### `const_a`
Audio-rate constant value source.

**Inputs**
- None

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `aout` | `a-rate` | Constant audio-rate value. |

### `const_i`
Init-rate constant value source.

**Inputs**
- None

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `iout` | `i-rate` | Constant init-time value. |

### `const_k`
Control-rate constant value source.

**Inputs**
- None

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kout` | `k-rate` | Constant control-rate value. |

## Envelopes

### `adsr` (compiled with `madsr`)
Control-rate ADSR envelope generator.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `iatt` | `i-rate` | Attack time. |
| `idec` | `i-rate` | Decay time. |
| `islev` | `i-rate` | Sustain level. |
| `irel` | `i-rate` | Release time. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kenv` | `k-rate` | Envelope output. |

## Oscillators

### `oscili`
Classic interpolating oscillator.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `amp` | `k-rate` | Oscillator amplitude. |
| `freq` | `a-rate` / `k-rate` / `i-rate` | Oscillator frequency input (port is control-rate but accepts audio/control/init connections). |
| `ifn` | `i-rate` | Function table number. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `asig` | `a-rate` | Oscillator audio output. |

### `vco`
Band-limited voltage-controlled oscillator.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `amp` | `k-rate` | Oscillator amplitude. |
| `freq` | `a-rate` / `k-rate` / `i-rate` | Oscillator frequency input (port is control-rate but accepts audio/control/init connections). |
| `iwave` | `i-rate` | Waveform selector. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `asig` | `a-rate` | Oscillator audio output. |

## Tables

### `ftgen`
Create a function table at init time using a GEN routine.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `ifn` | `i-rate` | Table number to create (use `0` for auto-allocation). |
| `itime` | `i-rate` | Start time for table creation (typically `0`). |
| `isize` | `i-rate` | Table size in points (power of two recommended). |
| `igen` | `i-rate` | GEN routine number (for example `10` for sine-partials). |
| `iarg1..iarg8` | `i-rate` | GEN routine arguments (`iarg1` required, others optional). |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `ift` | `i-rate` | Generated table number for routing into `ifn` inputs. |

## Filters

### `moogladder`
Moog ladder low-pass filter.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `ain` | `a-rate` | Input audio signal. |
| `kcf` | `k-rate` | Cutoff frequency control. |
| `kres` | `k-rate` | Resonance control. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `aout` | `a-rate` | Filtered audio output. |

## Math

### `k_mul`
Multiply two control-rate signals.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `a` | `k-rate` | Left control operand. |
| `b` | `k-rate` | Right control operand. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kout` | `k-rate` | Control-rate product. |

### `a_mul`
Multiply two audio-rate signals.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `a` | `a-rate` | Left audio operand. |
| `b` | `a-rate` | Right audio operand. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `aout` | `a-rate` | Audio-rate product. |

## Mixer

### `mix2`
Mix (sum) two audio-rate signals.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `a` | `a-rate` | First audio input. |
| `b` | `a-rate` | Second audio input. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `aout` | `a-rate` | Mixed audio output. |

## Output

### `outs`
Stereo output sink.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `left` | `a-rate` | Left channel signal. |
| `right` | `a-rate` | Right channel signal. |

**Outputs**
- None (sink node)

## MIDI

### `midi_note` (composite node)
Extract MIDI note frequency and velocity amplitude.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `gain` | `i-rate` | Gain multiplier for MIDI velocity amplitude. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kfreq` | `k-rate` | MIDI note frequency. |
| `kamp` | `k-rate` | MIDI note amplitude (velocity-based). |

### `cpsmidi`
Read active MIDI note pitch in cycles per second.

**Inputs**
- None

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kfreq` | `i-rate` | MIDI note frequency value. |

### `midictrl`
Read a MIDI controller value with optional scaling.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `inum` | `i-rate` | MIDI controller number. |
| `imin` | `i-rate` | Output minimum value. |
| `imax` | `i-rate` | Output maximum value. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kval` | `k-rate` | Scaled controller value. |

## Utility

### `k_to_a` (compiled with `interp`)
Convert a control-rate signal to audio-rate.

**Inputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `kin` | `k-rate` | Input control signal. |

**Outputs**
| Parameter | Type | Description |
| --- | --- | --- |
| `aout` | `a-rate` | Interpolated audio-rate signal. |
