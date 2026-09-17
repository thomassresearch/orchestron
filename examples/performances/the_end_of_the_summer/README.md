# The End of the Summer

A six-minute instrumental dark-wave song at **112 BPM**, in **4/4 and E minor**.
A dry industrial pulse gives way to two brief passages of warm strings and brass.
When the machinery returns, some of that warmth remains underneath it. The ending
leaves an E-minor seventh chord with an F-sharp bell above it.

Load **The End of the Summer** from Orchestron's performance library, or import
[the native performance](The_End_of_the_Summer.orch.json). Press the **Multitrack
Arranger Play** button to play the complete song. All Pad Loopers are enabled,
Repeat is off, and there is no looping playback selection.

## Arrangement

| Bars | Time | Section |
| --- | --- | --- |
| 1–16 | 0:00–0:34 | Clouds: atmospheric pad, a few melodic fragments, then a pulse. |
| 17–48 | 0:34–1:43 | Machinery: distorted kick, clipped bass, metallic punctuation and the main theme. |
| 49–56 | 1:43–2:00 | First sunlight: clean kick, sparse bass, Cmaj7/Gmaj7 strings and gentle brass. |
| 57–88 | 2:00–3:09 | Clouds return: denser rhythmic variants and an upper-register melodic statement. |
| 89–104 | 3:09–3:43 | Open sky: the longest warm opening, with breathing space between drum hits. |
| 105–136 | 3:43–4:51 | Warmth within the machine: the strongest rhythmic return, now admitting warm chords. |
| 137–152 | 4:51–5:26 | Unwinding: layers withdraw and softer answers outlast the lead. |
| 153–168 | 5:26–6:00 | A little warmth survives: drums disappear; strings and bells decay. |

The last four bars contain no new notes. The exported renderer also provides its
standard extra tail buffer beyond the six-minute arranger duration.

The main bass functions are E–C–A–B, with minor/suspended harmony above them. Warm
sections use Cmaj7 and Gmaj7 and later connect through Em7 and Bsus4. The recurring
melodic cell is E–G–F♯–B. Lead registers lift in the later industrial passages;
the brass answers use related notes with slower articulation.

## Rack and sound settings

| Channel | Instrument | Role and customization |
| --- | --- | --- |
| 10 | Analog Drumkit | Clean kick 35, distorted kick 36, snare 38, closed hat 42, open hat 46. Custom per-hit velocities. |
| 1 | EBM DW — Sequencer Bass | Dry 16th-note motor. Tone 600 Hz, decay 90 ms, release 45 ms, drive 1.7, resonance 0.28. |
| 2 | EBM DW — Industrial Stab | Sparse steel strikes. Clang 2.6, noise 0.2, decay 160 ms, drive 2.2, space 0.08. |
| 3 | EBM DW — Dark PWM Pad | Cloud cover. Tone 750 Hz, attack 1.4 s, release 2.4 s, motion depth 0.25, space 0.28. |
| 4 | EBM DW — Dark Saw Lead | Recurring theme. Tone 1800 Hz, vibrato 4 cents, echo 0.15, chorus 0.2, release 220 ms. |
| 5 | EBM DW — String Ensemble | Sunlight. Tone 2300 Hz, attack 0.9 s, release 3 s, chorus 0.6, reverb 0.22. |
| 6 | EBM DW — Analog Brass | Warm answers. Tone 950 Hz, filter envelope 1400 Hz, decay 650 ms, attack 90 ms, release 800 ms, space 0.18. |
| 7 | EBM DW — Glass Bell | Remaining light. Harmonic ratio 2, FM depth 0.7, tone 4200 Hz, decay 2 s, space 0.3. |
| 8 | EBM DW — Noise Metal FX | Weather fronts. Color 1000 Hz, metal blend 0.3, space 0.35, release 2.5 s. |

These are per-instance settings. The library patches retain their existing
defaults. Settings initialize on new notes; internal LFOs supply ongoing motion.
All stereo outputs route through the mixer to the built-in Master. Bass remains
centered, with small opposing balances for the lead, brass, bell and strikes.

## Files and reproduction

- [Native performance](The_End_of_the_Summer.orch.json): complete editable song and nine instrument definitions.
- [MIDI](The_End_of_the_Summer.mid): the exact exported performance events.
- [Csound MIDI export](exports/midi.zip) and [Csound SCORE export](exports/score.zip): portable render packages.
- [Full WAV](auditions/The_End_of_the_Summer.wav) and [first sunlight preview](auditions/First_sunlight_preview.wav): locally generated 48 kHz stereo audio.
- [Score](score.json), [drum patterns](drum_patterns.json), [builder](build_song.py), and [audio validation script](validate_song.py).
- [Library manifest](library_manifest.json): the only performance ID this builder may update.
- [Validation results](validation/README.md).

From the repository root with the backend running:

```sh
.venv/bin/python examples/performances/the_end_of_the_summer/build_song.py stage
.venv/bin/python examples/performances/the_end_of_the_summer/build_song.py export
```

`stage` uses the performance skill CLI to create an isolated draft, discover
instruments, set controls, and apply the JSON score. The builder supplements the
current score parser with per-event velocities and five custom drum rows using
the existing editable pad schema. It also checks the complete stereo routing.

`export` validates the 672-beat duration, creates both Csound packages through the
backend, and checks a native export/import expansion round trip. It does not save
the draft into the library. Render each exported package using its README, keeping
Csound's output in `render.log`:

```sh
cd examples/performances/the_end_of_the_summer/work/midiFile/The_End_of_the_Summer
csound -d -m0 The_End_of_the_Summer.csd > render.log 2>&1
# Repeat in work/score/The_End_of_the_Summer for the SCORE package.
```

From the repository root, using the patch skill's optional audio dependencies:

```sh
uv run --project integrations/skills/orchestron-patch-creator --extra audio --with mido python examples/performances/the_end_of_the_summer/validate_song.py --plots
.venv/bin/python examples/performances/the_end_of_the_summer/build_song.py publish
```

`publish` commits the validated draft via the CLI, preserves explicit instrument
types in the saved snapshot, records its ID and exports the saved configuration.
Reruns update only the ID in this folder's manifest and refuse an unrelated name
collision. Existing library patches and performances are compared with the initial
snapshot. Intermediate files, large WAV files and generated images are ignored by
Git; they remain available locally and are reproducible from the native packages.

Patterns use one or two bars, eight pads per device, eight-bar phrase groups and
section supergroups. The score retains normal GUI chord labels and hold steps.
No application code, opcode catalog, sample files or external services are needed.
