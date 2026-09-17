# EBM / Dark Wave instruments

Thirteen sample-free instruments with classic EBM and dark-wave defaults. Each is MIDI-triggered, velocity-sensitive, and ready for the performance rack.

## Use the instruments

Instrument names use the prefix **EBM DW —**. To import an instrument, open **Instrument Design → Import** and choose one of the native JSON files below. In **Perform**, assign the instrument and route its **Stereo Output** through the mixer to **Master**.

Attack and Release appear on every instrument. The other knobs vary by sound. These are per-instance initialization settings: changes affect new notes; held notes retain their settings. Internal LFOs continue moving during held notes. Motion rates are in Hz and echoes use fixed millisecond delays, with no automatic tempo synchronization.

Sequencer Bass needs notes from a sequencer, piano roll or arpeggiator. Choir Drone and Noise Metal FX need sustained notes. All voices allow overlapping MIDI notes; monophonic patterns suit the basses. Spatial processing is built in, while basses stay dry and centered.

## Instruments

| Instrument | Native export |
| --- | --- |
| Analog Brass | [Import](analog_brass.orch.instrument.json) |
| Choir Drone | [Import](choir_drone.orch.instrument.json) |
| Dark PWM Pad | [Import](dark_pwm_pad.orch.instrument.json) |
| Dark Saw Lead | [Import](dark_saw_lead.orch.instrument.json) |
| EBM Analog Bass | [Import](ebm_analog_bass.orch.instrument.json) |
| FM Bass | [Import](fm_bass.orch.instrument.json) |
| Glass Bell | [Import](glass_bell.orch.instrument.json) |
| Industrial Stab | [Import](industrial_stab.orch.instrument.json) |
| Noise Metal FX | [Import](noise_metal_fx.orch.instrument.json) |
| PWM Lead | [Import](pwm_lead.orch.instrument.json) |
| Resonant Pluck | [Import](resonant_pluck.orch.instrument.json) |
| Sequencer Bass | [Import](sequencer_bass.orch.instrument.json) |
| String Ensemble | [Import](string_ensemble.orch.instrument.json) |

## Sound and controls

Times are seconds unless labelled otherwise. Chorus/Reverb/Echo/Space are bounded effect amounts, not calibrated wet percentages. Space controls the sound’s documented ambience; PWM Lead keeps a light chorus even with Space at zero.

### Analog Brass

**Type:** Melody. **Suggested MIDI register:** 43–79.

Dramatic saw brass with a separate opening filter envelope and a quiet room tail.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.02 |
| Release (s) | 0.02–1.5 | 0.25 |
| Tone (Hz) | 200–5000 | 1500 |
| Filter Envelope (Hz) | 0–7000 | 3200 |
| Filter Decay (s) | 0.05–1.5 | 0.3 |
| Detune (cents) | 0–14 | 4 |
| Space | 0–0.5 | 0.08 |

### Choir Drone

**Type:** Melody. **Suggested MIDI register:** 43–76.

Synthetic gothic choir using three animated vowel formants, detuned pulses and a trace of breath. Sample-free, played with sustained notes.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–4 | 1.2 |
| Release (s) | 0.02–8 | 4 |
| Vowel (Oo–Ah) | 0–1 | 0.6 |
| Breath | 0–1 | 0.16 |
| Motion | 0–1 | 0.3 |
| Tone (Hz) | 700–8000 | 4300 |
| Reverb | 0–0.7 | 0.32 |

### Dark PWM Pad

**Type:** Melody. **Suggested MIDI register:** 43–79.

Shadowy triangle/pulse pad with slow PWM and filter movement, chorus and restrained reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–4 | 1.2 |
| Release (s) | 0.02–8 | 4 |
| Tone (Hz) | 200–5000 | 1300 |
| Pulse Blend | 0–1 | 0.55 |
| Motion Depth | 0–1 | 0.45 |
| Motion Rate (Hz) | 0.02–0.8 | 0.13 |
| Space | 0–0.7 | 0.3 |

### Dark Saw Lead

**Type:** Melody. **Suggested MIDI register:** 48–84.

Cold expressive saw lead with modest detune, subtle vibrato, animated stereo chorus and quiet filtered echoes.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.01 |
| Release (s) | 0.02–1.5 | 0.25 |
| Tone (Hz) | 300–7000 | 2600 |
| Detune (cents) | 0–18 | 6 |
| Vibrato (cents) | 0–25 | 3 |
| Chorus | 0–1 | 0.2 |
| Echo | 0–0.65 | 0.12 |

### EBM Analog Bass

**Type:** Bass. **Suggested MIDI register:** 28–55.

Hard dry EBM bass with a snappy resonant filter, quiet octave sub and compensated saturation.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 |
| Release (s) | 0.02–1.5 | 0.06 |
| Cutoff (Hz) | 80–3000 | 380 |
| Resonance | 0–0.8 | 0.3 |
| Filter Decay (s) | 0.025–0.5 | 0.13 |
| Sub | 0–1 | 0.3 |
| Drive | 1–8 | 2 |

### FM Bass

**Type:** Bass. **Suggested MIDI register:** 28–55.

Metallic two-operator bass with a fast index envelope and a steady low body.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 |
| Release (s) | 0.02–1.5 | 0.06 |
| FM Depth | 0.05–8 | 2.8 |
| Ratio | 0.5–4 | 2 |
| FM Decay (s) | 0.02–0.6 | 0.09 |
| Tone (Hz) | 300–9000 | 4000 |
| Drive | 1–6 | 1.4 |

### Glass Bell

**Type:** Melody. **Suggested MIDI register:** 48–88.

Cold glass bell with an inharmonic two-operator FM strike, decaying brightness and dark echoes/reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 |
| Release (s) | 0.02–4 | 1.5 |
| Ratio | 1–5 | 2.414 |
| FM Depth | 0.05–6 | 1.8 |
| Decay (s) | 0.3–5 | 2.5 |
| Tone (Hz) | 800–12000 | 6500 |
| Space | 0–0.7 | 0.25 |

### Industrial Stab

**Type:** Percussion. **Suggested MIDI register:** 36–84.

Pitched metallic FM strike with a separate short noise transient, distortion and compact room ambience.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 |
| Release (s) | 0.02–1.5 | 0.15 |
| Clang | 0.2–8 | 3 |
| Noise | 0–1 | 0.32 |
| Decay (s) | 0.04–1 | 0.25 |
| Drive | 1–8 | 3 |
| Space | 0–0.6 | 0.13 |

### Noise Metal FX

**Type:** Effects / Noise. **Suggested MIDI register:** 36–79.

Sustained mechanical noise/FM texture with slow spectral sweeps and dark ambience. Note pitch controls the metal layer.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–4 | 0.8 |
| Release (s) | 0.02–8 | 3 |
| Metal Blend | 0–1 | 0.4 |
| Color (Hz) | 200–7000 | 1700 |
| Sweep Depth | 0–1 | 0.6 |
| Motion Rate (Hz) | 0.02–2 | 0.15 |
| Space | 0–0.75 | 0.4 |

### PWM Lead

**Type:** Melody. **Suggested MIDI register:** 48–84.

Hollow pulse lead with true pulse-width modulation, light stereo chorus and filtered echoes.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.01 |
| Release (s) | 0.02–1.5 | 0.25 |
| Tone (Hz) | 300–7000 | 2300 |
| Pulse Width | 0.25–0.65 | 0.45 |
| PWM Depth | 0–0.2 | 0.13 |
| Motion Rate (Hz) | 0.05–3 | 0.45 |
| Space | 0–0.7 | 0.22 |

### Resonant Pluck

**Type:** Melody. **Suggested MIDI register:** 43–84.

Nasal resonant pluck with independent filter movement and finite filtered echoes.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 |
| Release (s) | 0.02–1.5 | 0.15 |
| Tone (Hz) | 200–5000 | 850 |
| Resonance | 0–0.82 | 0.48 |
| Filter Envelope (Hz) | 0–8000 | 3600 |
| Decay (s) | 0.04–1.5 | 0.25 |
| Echo | 0–0.7 | 0.2 |

### Sequencer Bass

**Type:** Bass. **Suggested MIDI register:** 28–60.

Lean dry pulse/saw bass for short external sixteenth-note sequences. Velocity changes filter brightness; no built-in sequencer.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 |
| Release (s) | 0.02–1.5 | 0.06 |
| Tone (Hz) | 120–3500 | 650 |
| Resonance | 0–0.75 | 0.2 |
| Decay (s) | 0.03–0.4 | 0.11 |
| Accent | 0–1 | 0.65 |
| Drive | 1–6 | 1.3 |

### String Ensemble

**Type:** Melody. **Suggested MIDI register:** 43–84.

Melancholic three-layer string ensemble with independent stereo chorus movement and dark reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Attack (s) | 0.001–4 | 0.6 |
| Release (s) | 0.02–8 | 2.5 |
| Tone (Hz) | 300–7000 | 3200 |
| Detune (cents) | 0–20 | 8 |
| Chorus | 0–1 | 0.55 |
| Reverb | 0–0.7 | 0.2 |
