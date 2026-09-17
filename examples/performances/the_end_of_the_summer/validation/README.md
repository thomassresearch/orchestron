# Validation results

Validated on 2026-09-16. Saved performance ID:
`5f8b713f-1490-4369-ad7c-c29617f062cf`.

## Rendering and numerical checks

Both backend-generated export packages compiled and rendered completely with
**Csound 6.18**, at **48 kHz**, **ksmps 1**, stereo **32-bit float WAV**. Both
completed with zero Csound errors. MIDI rendering reported zero forced decays and
zero extra note-offs.

| Check | MIDI export | SCORE export |
| --- | --- | --- |
| Arranger duration | 360 seconds / 168 bars | 360 seconds / 168 bars |
| WAV duration including export tail | 363.494 seconds | 363.495 seconds |
| Highest sample peak | −12.897 dBFS | −12.833 dBFS |
| Stereo RMS, L / R | −34.539 / −34.644 dBFS | −34.540 / −34.640 dBFS |
| Clipped samples | 0 | 0 |
| Nonfinite samples | 0 | 0 |
| Absolute mean DC, either channel | < 0.000028 | < 0.000028 |
| Final second | Exact silence | Exact silence |

The full mix keeps at least 12.8 dB of measured peak headroom. It is intentionally
dynamic, with quieter openings and an especially soft ending. The two export
modes have matching section RMS levels within 0.02 dB; stochastic/noise sources
mean their waveforms are not expected to be sample-identical.

The MIDI contains **3,028 notes** across all nine assigned channels. Every note-on
has a matching note-off. Drum events use only the five supported keys, and the
last four bars contain no new notes. All thirteen runtime note tracks (eight
melodic voices plus five drum rows) resolve to 672 beats with Repeat off.

Details: [audio measurements](audio.json), [MIDI checks](midi.json),
[structure](structure.json), [routing](routing.json), and
[controller/port discovery](instrument_discovery.json).

## Visual inspection

Opened and inspected all four generated stereo images after the final audio
render:

- [Complete song — Mel](The_End_of_the_Summer.mel.png)
- [Complete song — log-frequency STFT](The_End_of_the_Summer.stft.png)
- [First sunlight — Mel](First_sunlight_preview.mel.png)
- [First sunlight — log-frequency STFT](First_sunlight_preview.stft.png)

Both channels carry signal. The passages around 103–120 and 189–223 seconds show
sustained harmonic bands replacing dense high-frequency drum attacks. The detail
view shows separated bass attacks and overlapping chord decays through the first
transition. The ending loses its drum transients and decays to silence. Images
are locally generated artifacts and can be regenerated with `validate_song.py`.

## Live playback and actual listening

Loaded the saved song in the running Orchestron app and started its arranger.
The engine and global sequencer reported running, the playhead advanced into the
first sunlight passage, and both Audio Output meters showed signal. Stopped the
engine afterward and reset the playhead to **1/8, cycle 0**. The song remains loaded
in the delivered browser tab, ready for Arranger Play.

**Subjective listening was not performed:** no audio-listening tool was available.
Playback state, meter readings, numerical checks and visual inspection do not
constitute an auditory judgment of the music. [Live evidence](live.json).

## Persistence and repository checks

- Native backend export/import expansion preserved the complete bundle exactly,
  including the arrangement, nine graphs, explicit instrument types, controllers,
  formulas and stereo routing. [Round-trip result](roundtrip.json).
- The exported configuration equals the saved library configuration. Its sound
  fingerprint equals the configuration used for both full renders; re-exporting
  the saved song only changes CSD attribution timestamps. [Saved-state check](saved.json).
- All **52 existing patches** and **13 existing performances** remained unchanged.
  [Preservation check](preservation.json).
- `npm --prefix frontend run build`: passed.
- `docker build --target frontend-build .`: passed, including the preserved raw
  Analog Drumkit dependency and shared fixture inputs.
- Ruff, all new Markdown local links and `git diff --check`: passed.
- The examples index already contained two links to absent EDM/Goa pack README
  files. Those pre-existing links were left unchanged; the new song link resolves.

No application API, schema, opcode catalog or frontend source changes were made.
