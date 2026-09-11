# Goa / Psy Explorations — six self-contained instruments

Six new instruments with local echoes, reverb, and gentle stereo movement. Each
has three `perf_controller` knobs. They can be played without global delay or
reverb, and no existing instrument or performance is replaced.

## Play and import

Find the six names below in Instrument Design. Add one to the Perform rack and
route its **Stereo Output → mixer → Master**. Its characteristic effects are
already inside the instrument. To use the pack in another library, import the
individual `*.orch.instrument.json` files using **Instrument Design → Import**.

All instruments are velocity-sensitive and polyphonic. Play short notes for
bleeps and zaps, or hold notes for the talker, stepped bubbles, and riser. The
default auditions include all internal effects and no global effects.

| Instrument | Character / playing range | Preview |
|---|---|---|
| **Mandala Acid Lead** | Resonant, driven saw lead with an envelope sweep and dotted-eighth echoes. MIDI 43–79. | [WAV](auditions/mandala_acid_lead.wav) |
| **Orbit FM Bleeps** | Short FM chirps followed by six fading repeats and a small room tail. MIDI 48–84. | [WAV](auditions/orbit_fm_bleeps.wav) |
| **Chakra Vowel Talker** | Animated dual-formant pulse voice for talking and bubbling phrases. MIDI 43–76. | [WAV](auditions/chakra_vowel_talker.wav) |
| **Astral Laser Zaps** | Descending FM laser sweeps with a fast cluster of echoes. MIDI 36–76. | [WAV](auditions/astral_laser_zaps.wav) |
| **Mycelium Stepped Bubbles** | Held notes become changing, stepped pitch/filter patterns with rhythmic amplitude movement. MIDI 36–76. | [WAV](auditions/mycelium_stepped_bubbles.wav) |
| **Event Horizon Riser** | Rising FM/noise swell that releases into a diffuse echo/reverb cloud. MIDI 36–72. | [WAV](auditions/event_horizon_riser.wav) |

MIDI note numbers avoid differing octave-name conventions. The bass and supersaw
instruments from your existing library remain separate and unchanged.

## Controls

Values below are **range → default**. Space mixes in both local delay and reverb;
zero is dry, and the direct sound remains present throughout its range.

| Instrument | Knob 1 | Knob 2 | Knob 3 |
|---|---|---|---|
| Mandala Acid Lead | Squelch: 180–3600 Hz → 750, logarithmic | Echo BPM: 110–175 → 145 | Space: 0–1 → 0.35 |
| Orbit FM Bleeps | Chirp: 0–3 → 0.8 | Echo: 90–480 ms → 210, logarithmic | Space: 0–1 → 0.65 |
| Chakra Vowel Talker | Vowel: 0–1 → 0.35 | Talk: 1–14 Hz → 4.7, logarithmic | Space: 0–1 → 0.42 |
| Astral Laser Zaps | Sweep: 1–24 → 8, logarithmic | Decay: 0.04–0.45 s → 0.12, logarithmic | Space: 0–1 → 0.65 |
| Mycelium Stepped Bubbles | Steps: 2–24 Hz → 7, logarithmic | Mutation: 0–1 → 0.55 | Space: 0–1 → 0.5 |
| Event Horizon Riser | Rise: 0.3–6 s → 2.4, logarithmic | Tension: 0–1 → 0.6 | Space: 0–1 → 0.72 |

Other scales are linear. Knobs are independent per rack instance and take effect
on **new notes**. Held notes and their existing effect tails retain their
initialized values. These controls do not send MIDI CC.

- **Squelch** sets the base cutoff under Mandala's 4200 Hz envelope sweep.
- **Chirp** adds an upward pitch excursion at the start of each bleep.
- **Vowel** moves two formant bands, while Talk controls their oscillation speed.
- **Sweep** is the laser's initial pitch multiplier. Decay controls both amplitude
  decay and the exponential pitch fall; longer MIDI notes reveal more of the sweep.
- **Steps** drives two LFOs at different rates, quantized into a repeatable stepped
  pattern. Mutation increases pitch excursion and FM intensity. This is a
  deterministic pattern rather than a random note generator.
- **Rise** sets the time to peak. Hold a note for at least this duration to hear
  the full swell. Tension increases pitch excursion, FM depth, and noise brightness.

## Internal effects and tails

| Instrument | Echo timing | Reverb time | Reserved tail after note-off |
|---|---|---|---|
| Mandala | Four dotted-eighth taps, 310 ms at default tempo | 0.85 s | 4.0 s |
| Orbit | Six taps, 210 ms by default | 0.8 s | 4.6 s |
| Chakra | Four taps, 310 ms | 1.1 s | 4.0 s |
| Astral | Eight taps, 75 ms | 1.4 s | 3.6 s |
| Mycelium | Four taps, 210 ms | 1.8 s | 4.8 s |
| Event Horizon | Four taps, 290 ms | 3.2 s | 7.2 s |

**Echo BPM is manual, not synchronized to the host.** Match Mandala's knob to the
performance tempo when needed. Orbit uses milliseconds. Other echo timings are
fixed parts of their sound designs, and the modulation rates are in Hz.

Echoes are filtered before a finite chain of delay taps, with successive taps
at 62% of the preceding tap's level. Local `reverb2` receives both the original
sound and the echoes. A slow pan moves the combined signal between left and
right; these are moving mono effect chains rather than separate ping-pong buses.

The main `madsr` has an explicit short source release. A separate release-aware
tail envelope keeps the effects running and fades them safely to zero. This
prevents both truncated echoes and a dry note accidentally stretching across
the entire reverb tail. Tail duration is an upper bound; most sounds become quiet
earlier. FM frequency and depth are bounded in the upper register for extreme
sweep settings.

The implementation follows the documented [madsr release-time behavior](https://csound.com/docs/manual/madsr.html),
[linsegr lifetime extension](https://csound.com/docs/manual/linsegr.html), and
[reverb2/nreverb damping range](https://csound.com/docs/manual/nreverb.html).

## Files and reproduction

- `*.orch.instrument.json`: native instrument exports for import.
- `manifest.json`: installed patch IDs and all 18 stable controller definitions.
- `specs/`: valid CLI base specs; the builder adds the controls, modulation, and effects.
- `graphs/`: complete final API payloads with graph layout and Stereo Output metadata.
- `auditions/`: 48 kHz stereo WAVs, MIDI passages, and CSDs including the local effects.
- `validation/`: compiled orchestras, audio reports, saved-export verification, and
  fingerprints of all 33 library entries that existed before this pack. The
  original snapshot is retained alongside a snapshot immediately before installation;
  `concurrent_updates.json` records an independent Analog Drumkit edit preserved
  during this session.

Run from the repository root using the repository Python environment:

```sh
.venv/bin/python examples/instruments/goa_psy_explorations/build_pack.py build
.venv/bin/python examples/instruments/goa_psy_explorations/build_pack.py compile
.venv/bin/python examples/instruments/goa_psy_explorations/render_auditions.py
.venv/bin/python examples/instruments/goa_psy_explorations/build_pack.py install
.venv/bin/python examples/instruments/goa_psy_explorations/build_pack.py verify
```

`build_pack.py` contains the source definitions and graph extensions and uses
the `orchestron_patch_cli` library and local backend API. It never edits a
database or updates an existing patch. Compilation uses temporary patches and
sessions, which are cleaned up. Installation requires passing validation reports
for the exact generated payloads. An existing name is a conflict, and repeated
installation skips previously installed entries rather than overwriting them.

The installation guard is tied to the recorded local library. For another
library, use the portable native exports. Compilation accepts `--api-url` for
another backend. For a targeted revision, `compile --instrument SLUG` and
`render_auditions.py --instrument SLUG` preserve the other reports.

The checks cover controller extremes and all eight corners, three playing
registers and velocities, four simultaneous notes with full effects and maximum
controls, dry-versus-wet behavior after a short note, stereo output, finite audio,
headroom, and clean tail completion. Changing a knob mid-note is checked to leave
the held voice and its tail unchanged while affecting the next note. Saved graphs
are compared with exports, and two independent rack instances are compiled per
instrument. The final verification checks that creation of this pack leaves all
pre-existing instruments exactly as they were immediately before installation.

All **186 audio checks** passed. The highest tested peak was approximately
**−4.6 dBFS**, without a limiter or normalization. All six saved graphs matched
their native exports, their rack controls compiled independently, and all
33 pre-existing entries matched the snapshot immediately before installation.

WAVs are 16-bit PCM and are not normalized. To render an audition directly from
this directory:

```sh
csound -W -s -F auditions/orbit_fm_bleeps.mid -o /tmp/orbit.wav auditions/orbit_fm_bleeps.csd
```

The audition harness adds a sine table and an output sink for the instrument's
named stereo ports. It adds no external delay, reverb, or other processing.
