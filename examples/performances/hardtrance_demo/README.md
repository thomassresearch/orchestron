# Hardtrance Demo

A slow-building hard trance track in **E minor**, moving from atmospheric pads and
glassy plucks to rolling bass, acid lines and a wide supersaw theme. **146 BPM,
4/4, 256 bars: approximately 7:01**, plus effect tails.

This guide describes the saved live performance on **10 October 2026**. The
[native export](../Hardtrance_Demo.orch.json) is an earlier snapshot from
13 September; its mixer settings differ from those below.

## Instruments and sound

These are the effective per-instance performance controls, including unchanged
defaults. Tone and Cutoff shape brightness; Decay and Release shape note length.
Space controls the instrument's internal spatial effects, separate from the shared
reverb send. Other values are unitless unless marked. Strip gain is in dB;
L/R indicates stereo balance. Values are rounded.

| MIDI | Instrument and purpose | Performance controls | Strip gain / balance |
| --- | --- | --- | --- |
| 1 | **Undertow Motion Pad** - slowly moving harmonic bed | Tone 1,400 Hz; Motion 0.13 Hz; Release 2.5 s | -4.7 / L22% |
| 2 | **Alloy Sequence Voice** - metallic FM counterpulse | Clang 3; Ratio 2.414; Decay 0.14 s | +5.4 / L30% |
| 3 | **Furnace Techno Stab** - saturated, syncopated chord stabs | Tone 1,100 Hz; Decay 0.22 s; Drive 2 | -8.0 / R36% |
| 4 | **Prism FM Pluck** - glassy, unfolding arpeggio | Color 1.2; Decay 0.35 s; Release 0.15 s | -1.6 / L46% |
| 5 | **Rubber Core FM Bass** - weighty offbeat bass | Growl 1.689; Tone 896 Hz; Decay 0.547 s | -4.0 / L19% |
| 6 | **Psy Rotor Bass** - short, rolling bass articulation | Decay 50 ms; Tone 1,459 Hz; Drive 1 | -2.5 / R15% |
| 7 | **JP-8000 Supersaw** - wide main trance melody | Detune 2.927; seven detuned saws with chorus and internal echoes | -6.1 / centre |
| 8 | **Analog Drumkit** - kick, snare and hats | Distort Pre 4; Distort Post 0.8; BD pitch 0.8403x; Dist BD pitch 1.2346x | +12.0 / L2% |
| 9 | **Event Horizon Riser** - tension at transitions | Rise 3 s; Tension 0.6; Space 0.72 | +4.7 / L64% |
| 11 | **Astral Laser Zaps** - brief phrase punctuation | Sweep 8; Decay 0.12 s; Space 0.65 | 0.0 / R56% |
| 12 | **Goa Ray Lead** - late counter-melody | Patch-defined sound; no exposed performance controls | 0.0 / L42% |
| 15 | **Mandala Acid Lead** - squelchy midrange acid line | Squelch 750 Hz; Echo BPM 146; Space 0.35 | 0.0 / R37% |
| 16 | **TB303 style Bass** - resonant answering sequence | Cutoff 1.962x; Resonance 0.892 | 0.0 / L54% |

The Supersaw's internal delay retains its patch tempo of **138 BPM**; the global
sequencer and Mandala echo run at **146 BPM**. Mycelium Stepped Bubbles (10),
Chakra Vowel Talker (13) and Orbit FM Bleeps (14) are loaded but have no arranged part.

**Drum mapping:** the saved kit is on **MIDI channel 8**. Its five supported note
numbers are **35** clean kick, **36** distorted kick, **38** snare, **42** closed
hat (85 ms) and **46** open hat (700 ms). Four drum lanes use these voices;
velocity changes shape accents and builds. Other GM drum numbers are not used.

<div style="page-break-before: always;"></div>

## Mixer and routing

Every playable instrument feeds the shared compressor through its main stereo
route. A separate **post-fader stereo send** feeds the reverb, so changing a source
strip also changes how much of that source reaches the reverb.

```text
Instrument strips --------------------------> Compressor
       |                                           |
       +-- post-fader sends --> Reverb -------------+
                                                   |
                                               Master --> Audio output
```

The saved graph has **two stereo route pairs from Reverb to Compressor**. Both
therefore feed the compressor; the diagram shows their common destination.
There are no direct instrument routes bypassing Master.

| Shared stage | Effective settings | Strip gain |
| --- | --- | --- |
| **Reverb Effect** | Feedback 0.862; Cutoff 9.55 kHz | -10.7 dB |
| **Compressor Effect** | Upper 0.6; Lower 0.998; Rise 41.6 ms; Fall 314 ms; Threshold 0.5 | -5.2 dB |
| **Master** | Built-in stereo output stage; centred | -10.0 dB |

Reverb and compressor are centred too. Upper, Lower and Threshold above retain
their patch knob names and numeric values. All strips are unmuted, with no solos.

The send balance gives the lead and metallic sequence a large space: Supersaw
**+4.5 dB**, Alloy **+6 dB**, Prism **-1.7 dB**, Riser **-1.1 dB** and Undertow
**-5.2 dB**. Rubber and Rotor bass sends are restrained at **-19.1 / -22.2 dB**;
the kit's **-58.7 dB** send keeps the rhythm almost dry. These are send gains,
separate from the instrument strip and reverb return gains.

## Arrangement

The main harmonic cycle is **Em - C - G - D**. Layering and rhythmic density build
the energy gradually, with a central breakdown before the strongest final section.
Times are approximate elapsed positions.

| Bars | Time | Musical development |
| --- | --- | --- |
| 1-32 | 0:00-0:53 | Pad and sparse pluck establish the atmosphere. Clean kick and open hats enter at bar 17, about 0:26. |
| 33-64 | 0:53-1:45 | Stronger kick, offbeat bass, snare and closed hats. Rotor adds movement; acid begins teasing the next section. |
| 65-96 | 1:45-2:38 | Acid groove develops with metallic pulses, chord stabs and the TB303 answer. |
| 97-128 | 2:38-3:30 | Supersaw theme establishes the first crest. |
| 129-160 | 3:30-4:23 | Pad/pluck breakdown removes the rhythm foundation. Supersaw returns at bar 145, about 3:57. |
| 161-192 | 4:23-5:16 | Snare density and risers rebuild tension; rhythm is withheld immediately before the drop. |
| 193-224 | 5:16-6:08 | Main drop and final crest. Goa Ray adds its counter-melody only in bars 217-224. |
| 225-256 | 6:08-7:01 | Layers withdraw into the outro, leaving room for the pad and effects to release. |

The arrangement uses **8 melodic and 8 drummer sequencers**. Four drummer lanes
play the kit; the other four sequence pitched Furnace, Alloy, Astral and TB303
parts. Each lane contains 128 two-bar cells on a sixteenth-note grid. Sixteen-bar
groups A-P sit within four 64-bar sections. The song plays once and retains its
closing rests. There are no controller sequencers or live arpeggiators: the pluck
arpeggio is written as notes, and the build comes from notes, velocities and layers.

To hear this revision, load **Hardtrance Demo** in Perform and start the arranger
from bar 1. The opening is deliberately sparse; the first drums arrive after
approximately 26 seconds.
