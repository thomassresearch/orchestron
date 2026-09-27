# World Drumkit

Sample-free, velocity-sensitive world percussion: 55 strokes, selected by If + MIDI notnum. Custom map; other notes are silent. Short notes retain decay; held notes do not sustain. Four performance controls: Kit tuning, Decay, Brightness, Tabla tuning (independent multiplier; default dayan C4, 261.63 Hz). Synthetic tabla bol approximations; ge bend is preset, not live pressure. Mono voices feed Stereo Output; route to Master.

Deep foundation
- 36: Dunun open; 37: Dunun muted
- 38: Surdo open; 39: Surdo damped

Hand drums
- 40: Djembe bass; 41: tone; 42: slap; 43: muted
- 44: Conga low open; 45: high open; 46: muted; 47: slap
- 48: Bongo low open; 49: high open; 50: rim; 51: muted
- 52: Darbuka doum; 53: tek; 54: ka; 55: slap

Resonant / expressive
- 56: Frame drum centre; 57: rim; 58: muted
- 60: Tabla dayan na; 61: tin; 62: tun; 63: te (dry)
- 64: Tabla bayan ge; 65: ke (muted); 66: pressure bend
- 67: Tabla dha (na + ge); 68: dhin (tin + ge)
- 70: Udu bass air pulse; 71: clay tap; 72: hole slap

Wood / dry accents
- 74: Cajon bass; 75: snare slap; 76: edge
- 77: Claves; 78: Woodblock low; 79: Woodblock high

Metal
- 80: Cowbell open; 81: damped
- 82: Agogo low; 83: Agogo high

Shakers / scrapers / jingles
- 84: Shekere short; 85: accent; 86: long
- 87: Cabasa short; 88: Cabasa long
- 89: Guiro short; 90: Guiro long
- 91: Tambourine hit; 92: shake; 93: damped

## Performance controls

| Control | Range | Default |
| --- | --- | --- |
| Kit tuning | 0.8–1.25× | 1× |
| Decay | 0.6–1.6× | 1× |
| Brightness | 0.6–1.4× | 1× |
| Tabla tuning | 0.75–1.5× | 1× |

## Design

All 18 instrument families live in one percussion patch. Each of the 55 MIDI notes selects its own `If` synthesis branch; the false branch is silent. Open, muted, slap, rim and combined tabla strokes have separate oscillator balances, decays and attack textures. Notes outside the map are silent. There are no sample dependencies, choke groups or automatic rolls. Repeated notes are independent voices.

Tabla uses near-harmonic decaying partials for the loaded dayan membrane and a low resonant bayan with preset pitch movement. The bol names describe synthetic approximations. The `Tabla tuning` multiplier adjusts both drums independently of the other kit voices; it combines with `Kit tuning`. A `dha` or `dhin` note contains both drums.

Shekere combines the dedicated `sekere` model with a softer noise texture. Cabasa and guiro use pulsed, filtered noise; tambourine adds inharmonic jingles. Other drums, bells and wood sounds use damped sinusoidal partials and filtered attacks. Shared envelopes and attack textures keep the graph at 412 nodes. Tonal sources are local to their selected branch. No opcode support or application behavior was changed.

The main `madsr` gate has a long, decay-scaled release to preserve short-trigger tails. Finite exponential envelopes determine the actual sound lengths. Voices are centred through `pan2` into the mapped Stereo Output; route it to Master in Perform. The knobs apply to new notes and are stored per rack instance.

## Files and reproduction

- [Native instrument](../World_Drumkit.orch.instrument.json) — ready to import.
- [Voice specification](World_Drumkit.spec.json) — all frequencies, balances, decays and variants.
- [Graph builder](build_world_drumkit.py) — builds the full graph using the patch-creator CLI library and validates its invariants and API model.
- [MIDI renderer](validate_audio.py) — renders the backend-compiled `world.orc` without touching an active session.
- [Numerical checks](check_audio.py) — verifies the generated auditions.

Run the builder from the repository root:

```bash
.venv/bin/python examples/instruments/world_drumkit/build_world_drumkit.py /tmp/world-drumkit-validation/World_Drumkit.patch.json
```

The patch uses custom branching beyond the CLI's simple layer spec, so compile-preflight the full payload using the CLI's `ApiClient` and `compile_payload_preflight` before saving through the backend. Never replace it with the `spine` alone. The four stable controller IDs begin with `world_`.

Audio verification requires Csound and the patch-creator skill's optional audio dependencies. Render with `validate_audio.py`, check with `check_audio.py`, then generate and inspect both Mel and log-STFT views with the skill's `render_spectrograms.py`. Keep identical settings across comparisons.

## Validation — 2026-09-26

Saved in the local library as patch `7cf6abaf-31f2-4b4a-858c-09b078a7d729`. Backend compile and native export/import-parser checks passed. The graph contains 412 nodes and 941 connections.

Eighteen 48 kHz stereo renders covered all 55 notes at velocities 100 and 127, unmapped notes, velocity response, short and held triggers, retriggers, eight simultaneous notes, all four controller extremes, and a tabla-led demonstration. All samples were finite; both channels were present; unmapped keys were exactly silent; final tails reached silence. The highest measured peak was 0.6792 (about −3.36 dBFS) in the repeated/polyphonic audition.

Both Mel and log-STFT spectrograms were generated and visually inspected for the full map, four minimum/default/maximum controller comparisons, and the demonstration. Expected resonances, tuning changes, bayan pitch movement, and tail lengths were visible. No listening check was performed. [Detailed measurements](validation.json) distinguish the checks.

The frontend build and Docker `frontend-build` target passed. Existing examples and the shared analog-drumkit build dependency were preserved.
