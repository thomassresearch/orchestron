# Analog Drumkit — breakbeat extension

[Importable instrument](../Analog_Drumkit.orch.instrument.json) ·
[Raw starter](../template/analog_drumkit.patch.json) ·
[Original library instrument](Analog_Drumkit.original.orch.instrument.json)

Seventeen velocity-sensitive analog synthesis voices, without samples. MIDI note
numbers follow the General MIDI percussion map. Existing notes, node IDs, four
library controls, output gain and sound at default settings are preserved.
The raw starter retains its own historical gain and distortion settings.

| MIDI note | Sound | Added performance control | Range | Default |
| --- | --- | --- | --- | --- |
| 35 | Existing bass drum | BD snappiness, shared with 36 | 0.25–2 | 1 |
| 36 | Existing distorted bass drum | Same shared BD snappiness | 0.25–2 | 1 |
| 37 | Side stick / cross-stick | Side stick tuning | 0.65–1.5× | 1 |
| 38 | Existing snare | Snare tuning | 0.65–1.5× | 1 |
| 39 | Hand clap | Clap decay (s) | 0.07–0.45 | 0.18 |
| 40 | Electric snare | Electric snare snap | 0.25–2 | 1 |
| 41 | Low floor tom | Low floor tom tuning | 0.7–1.4× | 1 |
| 42 | Existing closed hi-hat | Hi-hat tuning, shared with 46 | 0.7–1.3× | 1 |
| 43 | High floor tom | High floor tom tuning | 0.7–1.4× | 1 |
| 45 | Low tom | Low tom tuning | 0.7–1.4× | 1 |
| 46 | Existing open hi-hat | Same shared Hi-hat tuning | 0.7–1.3× | 1 |
| 47 | Low-mid tom | Low-mid tom tuning | 0.7–1.4× | 1 |
| 48 | High-mid tom | High-mid tom tuning | 0.7–1.4× | 1 |
| 49 | Crash cymbal 1 | Crash decay (s) | 0.35–2.6 | 1.4 |
| 50 | High tom | High tom tuning | 0.7–1.4× | 1 |
| 51 | Ride cymbal 1 | Ride brightness | 0.5–1.5 | 1 |
| 54 | Tambourine | Tambourine decay (s) | 0.07–0.55 | 0.22 |

All added controls use logarithmic scales. BD snappiness increases click level
and speeds the initial pitch fall; 1 reproduces the original attack. Hi-hat
tuning scales both hats' metallic oscillators and filter frequencies. Snare
tuning scales its body and noise filters. Electric snare snap adjusts the
noise/body balance. Ride brightness changes upper partial levels and low-pass
cutoff. The toms have individual tuning. The clap has three short bursts and a
diffuse tail. All new voices have finite one-shot envelopes.

Controls are per rack instance and read when each note starts. Distort Pre,
Distort Post, BD pitch and Dist BD pitch keep their IDs, ranges and defaults.
Resetting the three new controls for existing sounds to 1 restores the previous
sound. Ghost snares use low velocity on 38. Unmapped notes, including 44 (pedal
hat), remain silent. There are no hi-hat choke groups.

The original library kick peaks at approximately 1.081 at velocity 127; this
pre-existing level is retained. Leave mixer headroom for layering. The listening
demo uses a fixed gain of 0.5 (−6.02 dB), without changing the instrument or
normalizing individual sounds.

## Reproduction and validation

`build_analog_drumkit.py` extends the two preserved original files and validates
both graphs with the backend compiler. It writes the native export and raw
starter without modifying the library. `update_library.py` uses the patch skill's
API client and temporary compile preflight, then updates the original patch ID
only with `--apply`. It refuses a library graph edited since the original snapshot.

```sh
.venv/bin/python examples/instruments/analog_drumkit/build_analog_drumkit.py
uv run --extra dev --with soundfile --with librosa --with matplotlib python \
  examples/instruments/analog_drumkit/validate_audio.py /tmp/analog-drumkit-validation
.venv/bin/python examples/instruments/analog_drumkit/update_library.py \
  --out-dir /tmp/analog-drumkit-validation --apply
```

The audio suite checks exact original/default waveforms with seeded noise,
all seventeen notes at soft/hard velocities, finite stereo output, one-shot tails,
silent unmapped notes, each new controller's minimum/default/maximum, real MIDI
input, retriggers and a layered breakbeat. Independent test fixtures under
`backend/tests/fixtures/patches/` cover these contracts without importing developer
examples. The existing five-voice test fixture remains unchanged.

After numerical checks, use the patch skill's `render_spectrograms.py` to generate
and inspect both Mel and log-STFT images. All new voices remain editable as
separate cases of the existing Switch in Instrument Design.

## Verified results — 14 October 2026

- Original/default maximum sample difference: **0** for all five original voices,
  including their maximum-velocity renders. The raw starter also matches its
  original five voices.
- **99 targeted tests passed**, covering the extension and control-flow regressions.
- All 17 notes and all 15 added controls passed the numerical audio suite. The
  [measurement report](auditions/report.json) records levels and controller changes.
- Real MIDI rendering and API compile preflight passed. Both frontend builds
  (local and Docker `frontend-build`) passed.
- The [Mel](auditions/all_voices.mel.png) and [log-STFT](auditions/all_voices.stft.png)
  voice plots and both controller comparison plots were opened and inspected:
  finite decays, expected tuning changes, and both output channels were present.
- A listening preview was rendered; no subjective listening assessment is claimed.

[Breakbeat preview, fixed −6.02 dB audition trim](auditions/Analog_Drumkit_breakbeat.wav)

![Analog Drumkit performance controls](../../../screenshots/analog_drumkit_breakbeat_controls.png)

![Additional tom, cymbal and tambourine controls](../../../screenshots/analog_drumkit_breakbeat_controls_lower.png)
