# Lake Bamboo Flute

A synthesized bamboo flute revised against **Samurai Flute Sample.m4a** on
2026-09-26. The second and third harmonics now supply a fuller low-register
body. Breath has a short attack, a broad air band, and a pitch-following bore
resonance. Slight pressure fluctuations, a small initial pitch scoop, harmonic
bloom and irregular delayed vibrato give sustained notes movement.

Use **Lake Bamboo Flute** in the library or import the
[native instrument](Lake_Bamboo_Flute.orch.instrument.json). The existing
instrument ID and all five controller IDs/ranges are preserved. Existing
performance overrides continue to apply. The raw
[patch JSON](Lake_Bamboo_Flute.patch.json) contains the complete editable graph.
The original graph, source and default audition are retained in
[the original revision](revisions/2026-09-26-original/).

Play E3–D6; E3–E5 best demonstrates the reference's low bamboo character.
MIDI velocity changes volume, harmonics and breath. The stereo output is dry;
route it to Master and optionally use a shared room reverb. No audio from the
reference is embedded in the instrument. Its recorded room/background noise
is not part of the synthesized tone.

| Control | Preserved range | Revised default |
| --- | --- | --- |
| Attack | 0.015–0.18 s | 0.075 s |
| Release | 0.08–1.2 s | 0.22 s |
| Breath | 0–1 | 0.55 |
| Tone | 1,000–7,500 Hz | 4,800 Hz |
| Vibrato | 0–15 cents | 9 cents |

Vibrato controls nominal depth; its rate/depth gently vary and fade in after
0.32 seconds. Setting it to zero removes the cyclic vibrato while retaining
small breath/pitch fluctuations. Breath zero removes the noise layers.
Controls take effect on new notes. Existing Evening at the Lake overrides
remain unchanged; reset the five controls on an instance to hear these defaults.

Compare the same MIDI phrase at the same velocities, without normalization:
[original](auditions/original_phrase.wav) and
[revised](auditions/reference_phrase.wav). This is a short test phrase in the
reference's register, not an exact transcription of its performance.

[build_flute.py](build_flute.py) is the authoritative graph source. The
[companion spec](Lake_Bamboo_Flute.spec.json) supplies the standard MIDI,
envelope and stereo-output spine; the builder adds the detailed synthesis.
It uses the patch CLI's graph validation, API client and compile preflight.
Only existing application opcodes are used. Random interpolation follows the
[Csound randomi semantics](https://csound.com/docs/manual/randomi.html);
[jitter](https://csound.com/docs/manual/jitter.html) varies the vibrato rate.

From the repository root:

```sh
.venv/bin/python examples/instruments/lake_bamboo_flute/build_flute.py preflight
.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py render
MPLCONFIGDIR=/tmp/orchestron-lake-mpl integrations/skills/orchestron-patch-creator/.venv/bin/python examples/instruments/lake_bamboo_flute/validate_audio.py analyze
```

Rendering the original comparison also requires `work/original.orc`, compiled
through the same CLI preflight from the backed-up original patch. Both versions
were compiled and rendered with Csound 6.18, 48 kHz, stereo and `ksmps=32`.
Open all generated Mel and log-STFT plots before recording
`spectrograms_inspected: true` and running `build_flute.py publish`.
Publishing checks the graph hash and refuses to overwrite a library graph
that differs from both the backup and this revision.

Fifteen MIDI auditions cover E3–D6, velocities 24–127, five controller
minimum/maximum comparisons, rapid retriggers, a four-note chord and matched
before/after phrases. Checks passed for finite stereo samples, headroom,
velocity response, fundamental pitch, complete release, and measured controller
effects. The worst tested peak was **−4.13 dBFS**. On the matched B3 phrase,
H2/H3 changed from approximately −16.8/−25.5 dB to −4.2/−4.0 dB relative to
the fundamental. This approaches the reference's prominent low harmonics;
it is not a perceptual similarity score.

Both suite spectrograms, four detailed comparison plots and both reference
plots were opened and visually inspected. **No listening check was performed.**
See [audio/controller measurements](validation/audio.json),
[reference measurements](validation/reference_measurements.json),
[compile results](validation/compile.json), and
[save/export verification](validation/revision.json).
The frontend build and Docker frontend-build target both passed; the shared
raw analog drumkit build input remains present.
