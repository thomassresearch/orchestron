# EBM / Dark Wave instruments

Thirteen sample-free instruments with classic EBM and dark-wave defaults. Each is MIDI-triggered, velocity-sensitive, and ready for the performance rack.

## Use the instruments

The instruments are imported into the local library under **EBM DW —**. To use an export elsewhere, open **Instrument Design → Import** and choose one of the native JSON files below. In **Perform**, assign the instrument and route its **Stereo Output** through the mixer to **Master**.

Attack and Release appear on every instrument. The other knobs vary by sound. These are per-instance initialization settings: changes affect new notes; held notes retain their settings. Internal LFOs continue moving during held notes. Motion rates are in Hz and echoes use fixed millisecond delays, with no automatic tempo synchronization.

Sequencer Bass needs notes from the piano roll or arpeggiator. Choir Drone and Noise Metal FX need sustained notes. All voices allow overlapping MIDI notes; bass auditions use monophonic patterns. Spatial processing is built in, while basses stay dry and centered.

## Instruments and auditions

| Instrument | Type / suggested MIDI register | Native export | WAV audition |
| --- | --- | --- | --- |
| Analog Brass | melody · 43–79 | [Import](exports/analog_brass.orch.instrument.json) | [Listen](auditions/analog_brass.wav) |
| Choir Drone | melody · 43–76 | [Import](exports/choir_drone.orch.instrument.json) | [Listen](auditions/choir_drone.wav) |
| Dark PWM Pad | melody · 43–79 | [Import](exports/dark_pwm_pad.orch.instrument.json) | [Listen](auditions/dark_pwm_pad.wav) |
| Dark Saw Lead | melody · 48–84 | [Import](exports/dark_saw_lead.orch.instrument.json) | [Listen](auditions/dark_saw_lead.wav) |
| EBM Analog Bass | bass · 28–55 | [Import](exports/ebm_analog_bass.orch.instrument.json) | [Listen](auditions/ebm_analog_bass.wav) |
| FM Bass | bass · 28–55 | [Import](exports/fm_bass.orch.instrument.json) | [Listen](auditions/fm_bass.wav) |
| Glass Bell | melody · 48–88 | [Import](exports/glass_bell.orch.instrument.json) | [Listen](auditions/glass_bell.wav) |
| Industrial Stab | percussion · 36–84 | [Import](exports/industrial_stab.orch.instrument.json) | [Listen](auditions/industrial_stab.wav) |
| Noise Metal FX | effects_noise · 36–79 | [Import](exports/noise_metal_fx.orch.instrument.json) | [Listen](auditions/noise_metal_fx.wav) |
| PWM Lead | melody · 48–84 | [Import](exports/pwm_lead.orch.instrument.json) | [Listen](auditions/pwm_lead.wav) |
| Resonant Pluck | melody · 43–84 | [Import](exports/resonant_pluck.orch.instrument.json) | [Listen](auditions/resonant_pluck.wav) |
| Sequencer Bass | bass · 28–60 | [Import](exports/sequencer_bass.orch.instrument.json) | [Listen](auditions/sequencer_bass.wav) |
| String Ensemble | melody · 43–84 | [Import](exports/string_ensemble.orch.instrument.json) | [Listen](auditions/string_ensemble.wav) |

## Sound and controls

Times are seconds unless labelled otherwise. Logarithmic controls have finer resolution at the low end. Chorus/Reverb/Echo/Space are bounded effect amounts, not calibrated wet percentages. Space controls the sound’s documented ambience; PWM Lead keeps a light chorus even with Space at zero.

### Analog Brass

Dramatic saw brass with a separate opening filter envelope and a quiet room tail.

Source specification: [analog_brass.json](specs/analog_brass.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.02 | logarithmic |
| Release (s) | 0.02–1.5 | 0.25 | logarithmic |
| Tone (Hz) | 200–5000 | 1500 | logarithmic |
| Filter Envelope (Hz) | 0–7000 | 3200 | linear |
| Filter Decay (s) | 0.05–1.5 | 0.3 | logarithmic |
| Detune (cents) | 0–14 | 4 | linear |
| Space | 0–0.5 | 0.08 | linear |

### Choir Drone

Synthetic gothic choir using three animated vowel formants, detuned pulses and a trace of breath. Sample-free, played with sustained notes.

Source specification: [choir_drone.json](specs/choir_drone.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–4 | 1.2 | logarithmic |
| Release (s) | 0.02–8 | 4 | logarithmic |
| Vowel (Oo–Ah) | 0–1 | 0.6 | linear |
| Breath | 0–1 | 0.16 | linear |
| Motion | 0–1 | 0.3 | linear |
| Tone (Hz) | 700–8000 | 4300 | logarithmic |
| Reverb | 0–0.7 | 0.32 | linear |

### Dark PWM Pad

Shadowy triangle/pulse pad with slow PWM and filter movement, chorus and restrained reverb.

Source specification: [dark_pwm_pad.json](specs/dark_pwm_pad.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–4 | 1.2 | logarithmic |
| Release (s) | 0.02–8 | 4 | logarithmic |
| Tone (Hz) | 200–5000 | 1300 | logarithmic |
| Pulse Blend | 0–1 | 0.55 | linear |
| Motion Depth | 0–1 | 0.45 | linear |
| Motion Rate (Hz) | 0.02–0.8 | 0.13 | logarithmic |
| Space | 0–0.7 | 0.3 | linear |

### Dark Saw Lead

Cold expressive saw lead with modest detune, subtle vibrato, animated stereo chorus and quiet filtered echoes.

Source specification: [dark_saw_lead.json](specs/dark_saw_lead.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.01 | logarithmic |
| Release (s) | 0.02–1.5 | 0.25 | logarithmic |
| Tone (Hz) | 300–7000 | 2600 | logarithmic |
| Detune (cents) | 0–18 | 6 | linear |
| Vibrato (cents) | 0–25 | 3 | linear |
| Chorus | 0–1 | 0.2 | linear |
| Echo | 0–0.65 | 0.12 | linear |

### EBM Analog Bass

Hard dry EBM bass with a snappy resonant filter, quiet octave sub and compensated saturation.

Source specification: [ebm_analog_bass.json](specs/ebm_analog_bass.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 | logarithmic |
| Release (s) | 0.02–1.5 | 0.06 | logarithmic |
| Cutoff (Hz) | 80–3000 | 380 | logarithmic |
| Resonance | 0–0.8 | 0.3 | linear |
| Filter Decay (s) | 0.025–0.5 | 0.13 | logarithmic |
| Sub | 0–1 | 0.3 | linear |
| Drive | 1–8 | 2 | logarithmic |

### FM Bass

Metallic two-operator bass with a fast index envelope and a steady low body.

Source specification: [fm_bass.json](specs/fm_bass.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 | logarithmic |
| Release (s) | 0.02–1.5 | 0.06 | logarithmic |
| FM Depth | 0.05–8 | 2.8 | logarithmic |
| Ratio | 0.5–4 | 2 | linear |
| FM Decay (s) | 0.02–0.6 | 0.09 | logarithmic |
| Tone (Hz) | 300–9000 | 4000 | logarithmic |
| Drive | 1–6 | 1.4 | logarithmic |

### Glass Bell

Cold glass bell with an inharmonic two-operator FM strike, decaying brightness and dark echoes/reverb.

Source specification: [glass_bell.json](specs/glass_bell.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 | logarithmic |
| Release (s) | 0.02–4 | 1.5 | logarithmic |
| Ratio | 1–5 | 2.414 | linear |
| FM Depth | 0.05–6 | 1.8 | logarithmic |
| Decay (s) | 0.3–5 | 2.5 | logarithmic |
| Tone (Hz) | 800–12000 | 6500 | logarithmic |
| Space | 0–0.7 | 0.25 | linear |

### Industrial Stab

Pitched metallic FM strike with a separate short noise transient, distortion and compact room ambience.

Source specification: [industrial_stab.json](specs/industrial_stab.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 | logarithmic |
| Release (s) | 0.02–1.5 | 0.15 | logarithmic |
| Clang | 0.2–8 | 3 | logarithmic |
| Noise | 0–1 | 0.32 | linear |
| Decay (s) | 0.04–1 | 0.25 | logarithmic |
| Drive | 1–8 | 3 | logarithmic |
| Space | 0–0.6 | 0.13 | linear |

### Noise Metal FX

Sustained mechanical noise/FM texture with slow spectral sweeps and dark ambience. Note pitch controls the metal layer.

Source specification: [noise_metal_fx.json](specs/noise_metal_fx.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–4 | 0.8 | logarithmic |
| Release (s) | 0.02–8 | 3 | logarithmic |
| Metal Blend | 0–1 | 0.4 | linear |
| Color (Hz) | 200–7000 | 1700 | logarithmic |
| Sweep Depth | 0–1 | 0.6 | linear |
| Motion Rate (Hz) | 0.02–2 | 0.15 | logarithmic |
| Space | 0–0.75 | 0.4 | linear |

### PWM Lead

Hollow pulse lead with true pulse-width modulation, light stereo chorus and filtered echoes.

Source specification: [pwm_lead.json](specs/pwm_lead.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.01 | logarithmic |
| Release (s) | 0.02–1.5 | 0.25 | logarithmic |
| Tone (Hz) | 300–7000 | 2300 | logarithmic |
| Pulse Width | 0.25–0.65 | 0.45 | linear |
| PWM Depth | 0–0.2 | 0.13 | linear |
| Motion Rate (Hz) | 0.05–3 | 0.45 | logarithmic |
| Space | 0–0.7 | 0.22 | linear |

### Resonant Pluck

Nasal resonant pluck with independent filter movement and finite filtered echoes.

Source specification: [resonant_pluck.json](specs/resonant_pluck.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 | logarithmic |
| Release (s) | 0.02–1.5 | 0.15 | logarithmic |
| Tone (Hz) | 200–5000 | 850 | logarithmic |
| Resonance | 0–0.82 | 0.48 | linear |
| Filter Envelope (Hz) | 0–8000 | 3600 | linear |
| Decay (s) | 0.04–1.5 | 0.25 | logarithmic |
| Echo | 0–0.7 | 0.2 | linear |

### Sequencer Bass

Lean dry pulse/saw bass for short external sixteenth-note sequences. Velocity changes filter brightness; no built-in sequencer.

Source specification: [sequencer_bass.json](specs/sequencer_bass.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–0.5 | 0.003 | logarithmic |
| Release (s) | 0.02–1.5 | 0.06 | logarithmic |
| Tone (Hz) | 120–3500 | 650 | logarithmic |
| Resonance | 0–0.75 | 0.2 | linear |
| Decay (s) | 0.03–0.4 | 0.11 | logarithmic |
| Accent | 0–1 | 0.65 | linear |
| Drive | 1–6 | 1.3 | logarithmic |

### String Ensemble

Melancholic three-layer string ensemble with independent stereo chorus movement and dark reverb.

Source specification: [string_ensemble.json](specs/string_ensemble.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.

| Knob | Range | Default | Scale |
| --- | --- | --- | --- |
| Attack (s) | 0.001–4 | 0.6 | logarithmic |
| Release (s) | 0.02–8 | 2.5 | logarithmic |
| Tone (Hz) | 300–7000 | 3200 | logarithmic |
| Detune (cents) | 0–20 | 8 | linear |
| Chorus | 0–1 | 0.55 | linear |
| Reverb | 0–0.7 | 0.2 | linear |

## Reproduce the pack

Run from the repository root with its installed Python dependencies and Csound on PATH. The builder uses the [patch-creator skill](../../../integrations/skills/orchestron-patch-creator/SKILL.md) for its base specs, MIDI/envelope foundation, validation, backend client and compile preflight; it then adds the custom modulation/effect graph nodes. It does not edit SQLite or modify application code.

```sh
uv run python examples/instruments/ebm_darkwave/build_pack.py build
uv run python examples/instruments/ebm_darkwave/audition_pack.py
uv run python examples/instruments/ebm_darkwave/build_pack.py import
uv run --project integrations/skills/orchestron-patch-creator --extra audio python examples/instruments/ebm_darkwave/spectrogram_pack.py
uv run python examples/instruments/ebm_darkwave/document_pack.py
```

The importer accepts `--api-url` and records the saved IDs in `library_manifest.json`. Reruns update only those recorded IDs and check the existing name before writing. A different backend requires a separate pack checkout without that backend-specific manifest. Imports are paced to respect session admission limits. After an interrupted batch, use `--only` with the unfinished specification slugs to resume.

All builders and renderers accept `--only` except this documentation generator. Add `--quick` to the audition command for a preliminary sound check; quick results cannot authorize import. A complete control sweep must pass against the current graph hash first.

Native exports, default WAVs and MIDI, specifications, scripts, and compact reports are retained in the pack. Generated graphs, CSD/log files, full control-sweep WAVs, spectral images and review sheets are reproducible local intermediates ignored by Git. Full validation can use several gigabytes of disk space.

## Validation

See [validation results](validation/README.md). Auditions use real Csound 6.18 at 48 kHz, stereo, 32-bit float. The offline wrapper connects each unchanged Stereo Output to a monitor instrument; it does not add direct outputs to saved patch graphs.

The checks cover note ranges, velocities 40/80/120, short retriggers, sixteenth-note patterns, chords where appropriate, controller minima/defaults/maxima, overlapping releases, DC, channel output and clipping. Percussive control probes include early note-off so Release is exercised before the envelope reaches zero.

The final spectral review uses both channels with a fixed reference: Hann FFT 4096, hop 512, 128 Mel bands, 20–24,000 Hz, and −100–0 dB display limits. Spectrograms support inspection of pitch, movement, attacks and tails; they do not establish subjective sound quality. Actual listening is reported separately.
