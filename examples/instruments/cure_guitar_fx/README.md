# Cure Guitar FX

[Importable instrument](../Cure_Guitar_FX.orch.instrument.json) ·
[Editable graph](cure_guitar_fx.patch.json) · [Validation results](VALIDATION.md)

A stereo **Continuous** effect for the shimmering, hollow guitar textures
associated with The Cure. Its serial chain is **flanger → chorus → digital
delay → output gain**. It contains no reverb. Place your existing reverb after
this insert.

## Use in Orchestron

Import `Cure_Guitar_FX.orch.instrument.json` in Instrument Design if it is not
already in your library. In Perform, add **Cure Guitar FX** as a guitar mixer
insert, before the existing reverb. Alternatively, explicitly route the guitar's
Stereo Output into this effect's Stereo Input and its Stereo Output onward to
reverb/Master. It includes the dry signal; avoid an extra parallel dry route.

Change its per-instance performance controls, then **restart the rack** to apply
them. These are initialization controls, not live MIDI automation. Save the
performance to retain its settings. Each Mix at **0%** bypasses that stage;
all three mixes at 0% with Output at 0 dB give dry unity. A 100% mix is wet-only.
Setting Depth to zero stops modulation but leaves a fixed short delay.

| Control | Range | Default |
| --- | --- | --- |
| Chorus Mix | 0–100% | 32% |
| Chorus Rate | 0.05–3 Hz | 0.7 Hz |
| Chorus Depth | 0–8 ms | 2.5 ms |
| Flanger Mix | 0–100% | 20% |
| Flanger Rate | 0.02–2 Hz | 0.18 Hz |
| Flanger Depth | 0–3 ms | 2 ms |
| Flanger Feedback | 0–65% | 25% |
| Delay Mix | 0–100% | 22% |
| Delay Time | 40–1000 ms | 350 ms |
| Delay Feedback | 0–75% | 35% |
| Output | −18–0 dB | −3 dB |

The default is a restrained blend for clean picked guitar. For a darker,
flanger-led texture, try Chorus Mix 15%, Flanger Mix 40%, Flanger Feedback 40%,
and Delay Mix 15%. For a broader chorus texture, try Chorus Mix 40%, Flanger Mix
5%, and Delay Mix 25%. These are suggested starting points, not exact settings
from particular recordings.

## Design

Left and right audio stay separate. Modulation is offset by one-quarter cycle
between channels to add width to dual-mono input. The flanger sweeps around
3.5 ms, always staying between 0.5 and 6.5 ms. Chorus varies around 18 ms,
between 10 and 26 ms. Both use smooth audio-rate sine modulation.

The editable graph uses only existing opcodes: `oscil3`, `flanger`, `vdelay3`,
`ntrpol`, `upsamp`, `perf_controller`, and paired `inleta`/`outleta` blocks.
The [Csound flanger](https://csound.com/docs/manual/flanger.html) provides the
short feedback sweep and, with a fixed delay time, the longer digital echoes.
[vdelay3](https://csound.com/docs/manual/vdelay3.html) supplies the chorus delay
with cubic interpolation. There are no sample dependencies or plugin opcodes.

The flanger input is scaled by `1 − feedback` to contain its resonant gain.
The main delay keeps conventional repeat gain: 35% feedback makes each repeat
35% of the preceding one. High delay feedback and wet mix can increase peaks;
reduce Output if necessary. There is no limiter, distortion or amp simulation.

## Rebuild and validate

From the repository root:

```sh
PYTHONPATH=. .venv/bin/python examples/instruments/cure_guitar_fx/build.py
PYTHONPATH=. .venv/bin/python examples/instruments/cure_guitar_fx/validate_audio.py \
  --guitar examples/instruments/E-Guitar_Warm_Electric.orch.instrument.json
```

The optional `--guitar` argument accepts another existing native guitar bundle;
omit it for the self-contained signal checks. The builder validates and compiles
the graph before writing the raw patch and native bundle. The validator uses the
real mixer insert compiler and native Csound, and writes float WAVs and measured
results under `output/cure-guitar-fx/`. It does not edit the running library.

Signal checks cover every controller endpoint, combined extrema, independent
stereo channels, silence, dry unity, echo timing, feedback decay and both offline
input modes. Each controller audition has identical input and a 50-second render
window to retain the longest feedback tail. The optional guitar passage contains
an original minor-key arpeggio, a chord and repeated notes.

For the final visual inspection, generate and open both images for the guitar
audition and `control_comparison.wav` using the skill's spectrogram utility:

```sh
UV_CACHE_DIR=/tmp/orchestron-uv-cache uv run \
  --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  output/cure-guitar-fx/guitar_effect.wav \
  --out-dir output/cure-guitar-fx/spectrograms --n-fft 4096
```

The six five-second sections in `control_comparison.wav` are bypass, default,
Chorus Mix 100%, Flanger Mix 100%, Delay Mix 100%, and all controls at maximum.
No section is independently normalized. Listening remains a separate check.
