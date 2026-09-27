# Lake Bamboo Flute

A soft, sample-free flute designed for the main melody of **Evening at the Lake**.
It uses a sine-dominant tone with three quiet upper harmonics, filtered breath,
and 5.1 Hz vibrato that enters gradually after the note begins. MIDI velocity
changes both level and harmonic colour. The useful musical range is A3–D6.
This is a synthesized bamboo-flute-inspired sound, not a recorded bansuri.

Import [the native instrument](Lake_Bamboo_Flute.orch.instrument.json), or use
**Lake Bamboo Flute** in the library. Its left/right stereo outlets route to
Master. The patch is dry; Evening at the Lake supplies shared reverb.

| Control | Range | Default | Song setting |
| --- | --- | --- | --- |
| Attack | 0.015–0.18 s | 0.06 s | 0.04 s |
| Release | 0.08–1.2 s | 0.38 s | 0.42 s |
| Breath | 0–1 | 0.38 | 0.45 |
| Tone | 1,000–7,500 Hz | 3,600 Hz | 3,000 Hz |
| Vibrato | 0–15 cents | 7 cents | 9 cents |

[build_flute.py](build_flute.py) is the complete reproducible graph source.
The companion spec supplies the standard MIDI, envelope and stereo-output
spine; the builder adds the bore harmonics, breath and delayed vibrato.
The raw [patch JSON](Lake_Bamboo_Flute.patch.json) preserves the complete graph.
No application API or opcode definitions were changed.

From the repository root:

```sh
.venv/bin/python examples/instruments/lake_bamboo_flute/build_flute.py preflight
.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py render
MPLCONFIGDIR=/tmp/orchestron-lake-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py analyze
```

Open both generated spectrograms before marking `spectrograms_inspected` in
the report and running `build_flute.py publish`. Publishing checks the graph
hash and refuses to overwrite a differently authored instrument with this name.

Thirteen MIDI auditions cover A3–D6, velocities 24–127, all five controls at
both extremes, quick repeated notes and a four-note chord. Numerical checks
passed: finite 48 kHz stereo audio, monotonic velocity response, stable pitch,
no clipping, and clean releases. Worst tested peak was −4.51 dBFS. Both Mel
and log-STFT comparison plots were opened and inspected after the final gain
adjustment. **No listening check was performed.** See
[audio measurements](validation/audio.json) and [compile results](validation/compile.json).
