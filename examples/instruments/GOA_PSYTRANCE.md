# Goa / Psytrance instruments

Six sample-free instruments from the Goa / Psy Explorations collection: acid lead, FM bleeps, vowel talker, laser zaps, stepped bubbles and a rising FM/noise effect. Each is MIDI-triggered, velocity-sensitive and polyphonic, with built-in filtered echoes, reverb and stereo movement.

## Use the instruments

Open **Instrument Design → Import** and choose one of the native JSON files below. In **Perform**, assign the instrument and route its **Stereo Output** through the mixer to **Master**.

Each instrument exposes three per-instance controls. Changes affect new notes; held notes retain their settings while internal envelopes and LFOs continue moving. Space adds echoes and reverb to the dry sound: zero removes those effects, while one gives the largest built-in effect amount. It is not a wet percentage, and stereo pan movement remains active at zero.

Echoes and modulation do not automatically follow the performance tempo. Mandala’s Echo BPM is a manual timing setting; Orbit uses milliseconds; the other echo times are fixed. Suggested registers below are MIDI note numbers.

## Instruments

| Instrument | Native export |
| --- | --- |
| Mandala Acid Lead | [Import](Mandala_Acid_Lead.orch.instrument.json) |
| Orbit FM Bleeps | [Import](Orbit_FM_Bleeps.orch.instrument.json) |
| Chakra Vowel Talker | [Import](Chakra_Vowel_Talker.orch.instrument.json) |
| Astral Laser Zaps | [Import](Astral_Laser_Zaps.orch.instrument.json) |
| Mycelium Stepped Bubbles | [Import](Mycelium_Stepped_Bubbles.orch.instrument.json) |
| Event Horizon Riser | [Import](Event_Horizon_Riser.orch.instrument.json) |

## Sound and controls

Ranges and defaults below match the controls stored in the native exports. Times are seconds unless labelled otherwise; modulation rates are in Hz.

### Mandala Acid Lead

**Type:** Melody. **Suggested MIDI register:** 43–79.

Driven saw lead with a resonant envelope sweep, four fading echoes and a short reverb tail. Use short notes for acid sequences or longer notes for sustained lead phrases.

Squelch sets the filter’s base cutoff; the envelope opens it further at each attack. Echo BPM sets dotted-eighth repeats using a manually entered tempo: 145 BPM gives about 310 ms between taps. Space adds echoes and reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Squelch (Hz) | 180–3600 | 750 |
| Echo BPM | 110–175 | 145 |
| Space | 0–1 | 0.35 |

### Orbit FM Bleeps

**Type:** Effects / Noise. **Suggested MIDI register:** 48–84.

Short FM chirps with six fading echoes, reverb and an orbiting stereo pan. Sparse notes leave room for the repeat pattern.

Chirp increases the upward pitch excursion at the attack before it settles toward the played note. Echo sets the time between repeats in milliseconds. Space adds echoes and reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Chirp | 0–3 | 0.8 |
| Echo (ms) | 90–480 | 210 |
| Space | 0–1 | 0.65 |

### Chakra Vowel Talker

**Type:** Melody. **Suggested MIDI register:** 43–76.

Pulse voice through two animated formant bands, with a little direct oscillator body, four filtered repeats and a chamber tail. Held notes reveal the talking motion.

Vowel shifts both formant bands. Talk sets their movement rate in Hz. Space adds echoes and reverb; echo spacing is fixed at about 310 ms, equivalent to a dotted eighth at 145 BPM.

| Knob | Range | Default |
| --- | --- | --- |
| Vowel | 0–1 | 0.35 |
| Talk (Hz) | 1–14 | 4.7 |
| Space | 0–1 | 0.42 |

### Astral Laser Zaps

**Type:** Effects / Noise. **Suggested MIDI register:** 36–76.

Descending FM laser with an exponential pitch sweep, eight clustered 75 ms echoes and a bright room tail. Use isolated notes as rhythmic accents or transition effects.

Sweep sets the starting pitch multiplier relative to the played note; 1 removes the pitch excursion. Decay sets both the sweep time and amplitude decay. Space adds echoes and reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Sweep | 1–24 | 8 |
| Decay (s) | 0.04–0.45 | 0.12 |
| Space | 0–1 | 0.65 |

### Mycelium Stepped Bubbles

**Type:** Effects / Noise. **Suggested MIDI register:** 36–76.

Burbling FM voice with stepped pitch and resonant filter movement, four 210 ms echoes and reverb. Hold a note to hear the evolving pattern. Two LFOs generate deterministic movement rather than random steps.

Steps sets the primary LFO rate; the second runs at 0.731 times that rate, so this is not a sequencer clock or a fixed number of steps per second. Mutation increases pitch excursion and FM depth; the filter continues moving at zero. Space adds echoes and reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Steps (Hz) | 2–24 | 7 |
| Mutation | 0–1 | 0.55 |
| Space | 0–1 | 0.5 |

### Event Horizon Riser

**Type:** Effects / Noise. **Suggested MIDI register:** 36–72.

Rising FM/noise swell with four 290 ms echoes and a diffuse reverb tail. Hold a note through the rise, then release it into the ambience.

Rise sets the time to the peak. Tension increases the pitch climb, filter opening, FM depth and noise contribution. Space adds echoes and reverb.

| Knob | Range | Default |
| --- | --- | --- |
| Rise (s) | 0.3–6 | 2.4 |
| Tension | 0–1 | 0.6 |
| Space | 0–1 | 0.72 |
