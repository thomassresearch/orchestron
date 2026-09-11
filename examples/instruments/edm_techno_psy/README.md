# EDM, techno and psy trance instrument pack

Six dry, velocity-sensitive instruments, each with three performance knobs. All
play individual MIDI notes and support polyphony. There are no samples, built-in
arpeggiators, fixed chords, supersaws, delays, or reverbs.

## Play the instruments

The six instruments are installed in Instrument Design. For another Orchestron
library, use **Instrument Design → Import** and select the corresponding
`*.orch.instrument.json` file in this folder.

Add an instrument to the Perform rack and route its **Stereo Output** through a
mixer channel to **Master**. Add delay/reverb on the mixer as desired. Each patch
has one centered mono source chain distributed equally to its two output
channels; the pad's movement is timbral rather than stereo panning.

Use short, non-overlapping notes for the basses. Play your own chords on Furnace
and Undertow. These instruments do not enforce monophony or provide legato glide.
Pitch ranges below use MIDI note numbers, avoiding octave-label differences.

| Instrument | Playing range and use | Audition |
|---|---|---|
| Psy Rotor Bass | MIDI 28–52; rolling sixteenths with a gap for the kick. Fixed oscillator phase produces consistent attacks. | [WAV](auditions/psy_rotor_bass.wav) |
| Rubber Core FM Bass | MIDI 28–55; syncopated FM bass, rubbery stabs, or held bass tones. A sine reinforces the played fundamental. | [WAV](auditions/rubber_core_fm_bass.wav) |
| Prism FM Pluck | MIDI 48–84; melodic arpeggios and glassy hooks. Early note-off makes the Release knob especially useful. | [WAV](auditions/prism_fm_pluck.wav) |
| Furnace Techno Stab | MIDI 43–79; play minor, major, or extended chords. Each key produces a single pitch. | [WAV](auditions/furnace_techno_stab.wav) |
| Alloy Sequence Voice | MIDI 48–84; metallic ostinatos and pitched percussion. Non-integer Ratio values create inharmonic tones. | [WAV](auditions/alloy_sequence_voice.wav) |
| Undertow Motion Pad | MIDI 43–79; held chords and dark backgrounds. Motion changes the speed of the filter and pulse-width movement. | [WAV](auditions/undertow_motion_pad.wav) |

The bass auditions contain two bars at 138 BPM followed by two at 150 BPM. The
other rhythmic auditions use 138 BPM. All WAVs are unnormalized, 48 kHz, stereo,
16-bit PCM, rendered at patch defaults. The MIDI and CSD files reproduce exactly
the same dry passages.

## Performance controls

Values are **minimum–maximum → default**. All scales are logarithmic except Ratio,
which is linear. `manifest.json` records the installed patch IDs and all stable
controller node IDs, ranges, labels, and defaults.

| Instrument | Knob 1 | Knob 2 | Knob 3 |
|---|---|---|---|
| Psy Rotor Bass | Decay: 0.04–0.25 s → 0.10 | Tone: 100–1800 Hz → 350 | Drive: 1–5 → 1.8 |
| Rubber Core FM Bass | Growl: FM index 0.3–6 → 2 | Tone: 150–3500 Hz → 900 | Decay: 0.08–1.2 s → 0.25 |
| Prism FM Pluck | Color: FM index 0.15–5 → 1.2 | Decay: 0.08–1.8 s → 0.35 | Release: 0.03–1.2 s → 0.15 |
| Furnace Techno Stab | Tone: 200–6000 Hz → 1100 | Decay: 0.06–1 s → 0.22 | Drive: 1–8 → 2 |
| Alloy Sequence Voice | Clang: FM index 0.2–8 → 3 | Ratio: 1–4 → 2.414 | Decay: 0.03–0.7 s → 0.14 |
| Undertow Motion Pad | Tone: 200–6000 Hz → 1400 | Motion: 0.02–1.5 Hz → 0.13 | Release: 0.2–6 s → 2.5 |

Tone is the base filter cutoff: Rotor adds a 3500 Hz envelope sweep; Rubber adds
1700 Hz; Furnace rises to twice Tone on its attack. Undertow moves between 70%
and 130% of Tone while pulse width stays between 0.32 and 0.68. Motion is in Hz,
not synchronized to the performance tempo.

Growl, Color, and Clang set the maximum envelope-scaled FM depth. An additional
pitch-dependent ceiling reduces excessive FM sidebands in high registers. This
can limit the upper end of these knobs on high notes; their normal bass and
middle-register settings retain their full character.

Knob changes are stored per rack instance and take effect on **new notes**.
Already sounding notes keep their initialized settings. These are not MIDI CC
controls. Resetting a knob removes its instance override and follows the patch
default again. Standalone auditions use patch defaults.

Decay controls the envelope while a key remains down. A note-off starts release
immediately; holding a note beyond a zero-sustain decay does not create a new
tail. Rubber has 15% sustain, and Undertow has 70% sustain.

## Reproduce and validate

Run from the repository root with the running backend at `http://localhost:8000/api`:

```sh
.venv/bin/python examples/instruments/edm_techno_psy/build_pack.py build
.venv/bin/python examples/instruments/edm_techno_psy/build_pack.py compile
.venv/bin/python examples/instruments/edm_techno_psy/render_auditions.py
.venv/bin/python examples/instruments/edm_techno_psy/build_pack.py install
.venv/bin/python examples/instruments/edm_techno_psy/build_pack.py verify
```

Pass `--api-url` to `build_pack.py` when using a different backend. Rendering uses
the local Csound executable plus NumPy and mido from the repository environment.

`build_pack.py` is the source of truth for the sound definitions and graph
extensions. It uses the `orchestron_patch_cli` library to generate the base graph,
apply performance controllers and GUI-compatible formulas, check invariants,
and compile-preflight through temporary API patches/sessions. It never opens a
database. Edit the builder to revise this pack, then regenerate its artifacts.

- `specs/`: valid high-level CLI base specs. They omit the additional modulation
  connections; Undertow's third controller is added with its LFO by the builder.
- `graphs/`: complete generated patch payloads, including all three knobs and
  modulation wiring. Use the native exports for Instrument Design import.
- `*.orch.instrument.json`: native instrument exports with installed patch IDs.
- `auditions/`: dry WAV previews, source MIDI, and compiled CSD render harnesses.
- `validation/`: compiled orchestras and machine-readable compilation/audio reports.
- `manifest.json`: installed identities and controller definitions.

Installation requires passing compile and audio reports for the exact generated
payload hashes. It creates new library entries and does not overwrite existing
patches. Repeating install skips entries already recorded in this pack's manifest;
it deliberately does not replace later user edits. Existing performances are not
modified.

The audio checks cover all control corners and individual extremes, three note
registers and velocities, short and held-note release behavior, four-note
stab/pad chords, bass retriggering at 138/150 BPM, and upper-register FM extremes.
They verify non-silent left/right channels, finite samples, headroom, quiet final
tails, audible control differences, Rotor's repeatable phase, and the rule that
channel changes affect new notes while held notes retain their settings.

The delivered pack passed **187 MIDI render checks**. The highest peak across
those cases was approximately **−8.2 dBFS**, without normalization or a limiter.
`verify` additionally compares the installed graphs with their native exports
and compiles two rack instances per instrument with independent minimum/maximum
controller settings. Temporary verification sessions are removed afterward.

To rerender one supplied audition directly, run from this folder:

```sh
csound -W -s -F auditions/prism_fm_pluck.mid -o /tmp/prism.wav auditions/prism_fm_pluck.csd
```

The CSD adds only a sink for the instrument's named stereo outlets and a sine
table used by the FM/oscillator nodes; the instrument body is compiled from the
saved graph. It uses real MIDI note-on/note-off messages, retaining `cpsmidi`,
`ampmidi`, and `madsr` behavior.
