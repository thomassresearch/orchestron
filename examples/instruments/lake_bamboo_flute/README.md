# Lake Bamboo Flute

A breath-first bamboo-flute synthesis patch, with gapless legato added on 27 September 2026. The tone revision used
**Samurai Flute Sample.m4a**, public shakuhachi recordings, and feedback on the
register transition. [Reference recordings, comparison plots and limitations](research/README.md)
document the evidence behind this revision.

Air begins with a 4 ms envelope. The bore tone starts about 45–60 ms later at
the default Attack setting. The initial pressure peak relaxes over roughly half
a second. MIDI velocity sets this blowing profile as well as loudness.

The ground and octave harmonic families now overlap. Their strengths trade
unevenly near the register boundary, with different buildup/decay memories and
additional instability during the attack. Stronger sustained blows can settle
into the upper register. This is a modal-envelope synthesis approximation, not
a complete air-jet or waveguide simulation. Velocity stands in for a player's
combined breath and embouchure gesture.

| Tested MIDI velocity | Default response |
| --- | --- |
| 40, 64, 80 | Air-first attack, predominantly the played pitch |
| 92 | Lower and octave components trade dominance during onset, then settle low |
| 100 | More upper-register attack and overlap; returns toward the lower register |
| 116 | Predominantly upper register with continued fluctuation |
| 127 | Uneven onset, then a steadier upper register |

The boundary is gradual, so neighboring velocities vary continuously. A quieter
lower component remains even in the stable upper sound; this is a musical choice
for the requested character. Both families stay at their harmonic frequencies
rather than gliding between pitches.

Use **Lake Bamboo Flute** in the library or import the
[native instrument](Lake_Bamboo_Flute.orch.instrument.json). Its library ID,
instrument type and five controller IDs/ranges are preserved. Existing performance
overrides still apply. The [raw patch](Lake_Bamboo_Flute.patch.json) contains the
complete editable graph. Previous versions remain under [revisions](revisions/),
including the preceding [pressure-switch version](revisions/2026-09-26-pressure-switch/).

Touching or overlapping notes now continue one voice, with immediate pitch changes
and no glide. The newest held note wins; releasing it returns to the preceding
held note. Velocity follows with a 10 ms half-time. A real gap starts a fresh
breath/tone phrase, even during a release tail. The engine adds no timing grace
period. Connected notes preserve resonance, oscillator phase and vibrato and do
not repeat pressure overshoot. This uses the new opt-in `midi_legato` opcode.

The [legato-versus-separated audition](auditions/Legato_vs_separated.wav) plays
**legato first (0–9 s)**, then the same notes with 80 ms articulation gaps
**(9.5–18.5 s)**. Velocities vary from 50 to 116. Numerical and visual verification
are recorded separately from listening.

Play E3–E5 for the low bamboo character; it remains playable through D6. High
velocities emphasize the octave above the MIDI note. The output is dry stereo;
route it to Master and optionally use a shared room reverb. No reference audio
is embedded in the patch.

| Control | Range | Default |
| --- | --- | --- |
| Attack | 0.015–0.18 s | 0.075 s |
| Release | 0.08–1.2 s | 0.22 s |
| Breath | 0–1 | 0.55 |
| Tone | 1,000–7,500 Hz | 4,800 Hz |
| Vibrato | 0–15 cents | 9 cents |

Attack adjusts tonal buildup and pressure timing. Breath controls air noise;
zero preserves the delayed tone and register response. Release controls bore
decay while air stops faster. Vibrato fades in after 0.32 seconds; zero removes
it while retaining small pitch fluctuations. New phrases read the control values; connected notes retain them.

Listen to the [velocity demonstration](auditions/blowing_dynamics.wav): seven
B3 notes held for two seconds, velocities **40, 64, 80, 92, 100, 116, 127**.
The [register demonstration](auditions/blowing_registers.wav) compares velocity
92 and 116 at E3, E4 and E5. The [short phrase](auditions/reference_phrase.wav)
uses varied velocities. [Before/after envelopes](research/patch_comparison.png)
show how the fundamental now persists through the transition.

[build_flute.py](build_flute.py) is the authoritative source. The companion
builder applies an idempotent migration to the saved 56-node graph in
[the pre-legato backup](revisions/2026-09-27-pre-legato/library_patch.json). All existing node IDs, positions, the maxalloc/constant connection, routing and five controllers survive. Three added nodes supply live legato pitch/velocity and separate the pressure ramp and overshoot from current velocity. The older modal generator remains available for historical reproduction.
The irregular exchange uses a wandering 6.7 Hz modulation rate plus faster random
variation, weighted by proximity to the transition and onset instability.
The ground and upper envelopes use 22 ms and 9 ms smoothing half-times.

```sh
.venv/bin/python examples/instruments/lake_bamboo_flute/build_flute.py preflight
.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py render
MPLCONFIGDIR=/tmp/orchestron-lake-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py analyze
```

The historical phrase requires `work/original.orc`, compiled from the original
backup. Twenty 48 kHz stereo auditions (241 seconds total) cover controller extremes, E3–D6,
velocities, retriggers, a chord, air-muted onset checks, and multiple registers.
Numerical checks cover finite samples, both channels, headroom, release silence,
pitch, controller response and velocity-dependent overlap/stability. At velocity
92, the measured onset octave/lower ratio spans approximately **15.0 dB** between
its 10th and 90th percentiles; both components take turns dominating. Velocity
127 settles with much less fluctuation. Worst tested current-flute peak: **−13.60 dBFS**. The former four-note chord now exercises monophonic last-note priority.

Both Mel and log-STFT images must be opened after the final audio checks before
marking `spectrograms_inspected: true` and running `build_flute.py publish`.
Publishing checks the graph hash and refuses to overwrite unexpected library
changes. Native export/import preview verifies the saved graph and controls.
Both frontend builds passed; the shared analog drumkit build input is present.
**No listening check was performed.** See [audio measurements](validation/audio.json),
[compile results](validation/compile.json), and [save/export verification](validation/legato_revision.json).
