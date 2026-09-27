# Lake Bamboo Flute

A breath-first bamboo-flute synthesis patch, revised on 2026-09-26 following
feedback on **Samurai Flute Sample.m4a**. MIDI velocity controls blowing pressure
and the sounding register as well as loudness.

Air begins with a 4 ms envelope. The bore tone starts later (about 45–60 ms
at the default Attack setting), then builds into resonance. As the tone
establishes, the initial air burst recedes. A hard initial blow has a pressure
peak that relaxes over about half a second. This can drive the octave register
briefly, or sustain it if the remaining pressure is high enough.

| MIDI velocity | Behavior at the default settings |
| --- | --- |
| 1–84 | Breath, then the fundamental |
| 85–102 | Increasing initial overblow, then return to the fundamental; clearest around 90–100 |
| 103–106 | Transition between returning and sustained overblow |
| 107–127 | Sustain the octave while held |

Overblowing transfers energy from the fundamental harmonic family to the
2× family: the original fundamental and odd partials disappear, and the octave
has its own upper harmonics. The transfer is smoothed without gliding the
oscillators between pitches. Falling pressure at note-off allows the register
to relax during the release. This is a pressure-envelope and mode-transfer
approximation, not a complete air-jet/waveguide simulation. The underlying
acoustic principle is described in [UNSW's flute acoustics introduction](https://newt.phys.unsw.edu.au/jw/fluteacoustics.html).

Use **Lake Bamboo Flute** in the library or import the
[native instrument](Lake_Bamboo_Flute.orch.instrument.json). The existing
instrument ID and all five controller IDs/ranges are preserved. Existing
performance overrides continue to apply. The raw
[patch JSON](Lake_Bamboo_Flute.patch.json) contains the complete editable graph.
Both [the original](revisions/2026-09-26-original/) and
[the earlier harmonic revision](revisions/2026-09-26-harmonic-revision/) are backed up.

Play E3–E5 for the low bamboo character; it remains playable through D6.
A hard strike deliberately sounds one octave above the MIDI note. The stereo
output is dry; route it to Master and optionally use a shared room reverb.
No audio from the reference is embedded in the instrument.

| Control | Preserved range | Default |
| --- | --- | --- |
| Attack | 0.015–0.18 s | 0.075 s |
| Release | 0.08–1.2 s | 0.22 s |
| Breath | 0–1 | 0.55 |
| Tone | 1,000–7,500 Hz | 4,800 Hz |
| Vibrato | 0–15 cents | 9 cents |

Attack adjusts tonal buildup and influences bore/pressure timing. Breath
controls air noise; setting it to zero leaves the delayed tone and velocity
register behavior intact. Release controls the bore decay; air stops faster.
The independent releases use explicit [madsr release times](https://csound.com/docs/manual/madsr.html).
Vibrato has gentle rate/depth variation and fades in after 0.32 seconds;
zero removes it while retaining small pitch fluctuations. New notes read
control values. Existing Evening at the Lake overrides remain unchanged.

Listen to the [velocity demonstration](auditions/blowing_dynamics.wav): seven
B3 notes, all two seconds long, at velocities **40, 64, 80, 92, 100, 116, 127**.
The first three stay low, the next two rise then settle, and the final two
stay an octave up. A [register demonstration](auditions/blowing_registers.wav)
compares velocity 92 and 116 at E3, E4 and E5.
The [short phrase](auditions/reference_phrase.wav) uses varied velocities.

[build_flute.py](build_flute.py) is the authoritative graph source. The
[companion spec](Lake_Bamboo_Flute.spec.json) supplies the standard MIDI,
envelope and stereo-output spine. The builder adds the pressure envelope,
independent air envelope, mode transfer, partials and modulation, using only
existing opcodes. [portk](https://csound.com/docs/manual/portk.html) smooths
register transfer over a 10 ms half-time.

From the repository root:

```sh
.venv/bin/python examples/instruments/lake_bamboo_flute/build_flute.py preflight
.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py render
MPLCONFIGDIR=/tmp/orchestron-lake-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py analyze
```

The historical phrase comparison requires `work/original.orc`, compiled
through CLI preflight from the original backed-up patch. Auditions use
Csound 6.18, 48 kHz, stereo and `ksmps=32`. Open the generated Mel and
log-STFT plots before recording `spectrograms_inspected: true` and running
`build_flute.py publish`. Publishing checks the graph hash and refuses to
overwrite a library graph that differs from both the preceding revision
and the new graph.

Eighteen auditions cover controller extremes, E3–D6, velocity response,
rapid retriggers, a four-note chord, seven blowing strengths, an air-muted
comparison, and mode switching across E3/E4/E5. Numerical checks verify:

- Breath is present but tonal output is below −100 dBFS in the first tested
  8–37 ms after note-on at all seven blowing strengths.
- Velocities 40/64/80 stay on the fundamental; 92/100 start on the octave and
  return; 116/127 retain octave dominance while held.
- Those returning/sustained behaviors also hold at E3, E4 and E5.
- Dominant resonant pitch is within 30 cents in the measured attack/sustain
  windows, stereo samples are finite, releases reach silence, and controls
  and velocity affect their intended quantities.

Worst tested peak: **−5.53 dBFS**. Spectrograms were opened and inspected;
**no listening check was performed**. See
[audio and dynamics measurements](validation/audio.json),
[compile results](validation/compile.json), and
[save/export verification](validation/revision.json).
Both frontend builds passed and the shared analog drumkit input remains present.
