# HSB Mono

[Native instrument](../HSB_Mono.orch.instrument.json) ·
[Editable patch](hsb_mono.patch.json) ·
[Control guide (EN/DE/FR/ES)](../../../documentation/instrument_design/hsb_mono.md)

A monophonic `hsboscil` instrument with five blended sine-wave octaves, cyclic
tonality, independent brightness and a configurable pitch-glide half-time.
Import the native instrument, add it to the rack and route Stereo Output to Master.
The suggested playing range is MIDI 36–84.

Touching and overlapping notes share their amplitude envelope. The graph retains
pitch memory across gaps of approximately 20 ms; a longer gap starts directly at
the next pitch. Positive gaps restart the envelope. This behavior belongs entirely
to this patch: no existing opcode, compiler behavior or TB303 graph was changed.

| Performance parameter | Range | Default | MIDI CC |
| --- | --- | --- | --- |
| Tonality | 0–1 octave cycle | 0 | 20 |
| Brightness | −2 to +2 octaves | 0 | 74 |
| Legato half-time | 1–500 ms, logarithmic | 60 ms | 5 |
| MIDI control channel | 1–16 | 16 | — |

For each mapped CC, **value 0 recalls the performance parameter**, value 1
selects its minimum, and value 127 selects its maximum. Controllers smooth over
a 10 ms half-time. Set controller-sequencer Reset Value to 0. Larger legato
half-times make slower slides. Rack values refresh at phrase start; MIDI controls
also affect held notes. Tonality wraps at one octave, so its endpoints sound alike.

## Reproduce

From the repository root:

```sh
.venv/bin/python -m examples.instruments.hsb_mono.build
.venv/bin/python -m examples.instruments.hsb_mono.render
.venv/bin/python -m pytest backend/tests/test_hsb_mono.py -q
```

The builder writes only the example graph and native bundle; library creation is
a separate API operation. The renderer writes nine matching stereo previews,
their score and numerical metrics under `output/hsb_mono/audio/`. Tests use the
independent `backend/tests/fixtures/patches/hsb_mono.patch.json` snapshot.

## Patch-local timing

The existing `midi_legato` handles last-note priority and held-note fallback.
A second, inaudible `madsr` senses the gate. Its positive sub-sample attack leaves
one control sample at zero on phrase initialization. A `portk` follower uses zero
half-time while the gate is on, 20 ms while off, and `isig=-1` to retain its state.
It crosses 0.5 approximately 20 ms after note-off.

The pitch `portk` also retains its state. A one-control-sample `linseg` pulse
selects zero half-time only at a new phrase when recent activity is below 0.5.
Otherwise it uses the selected legato half-time, including during release tails.
The gate's first zero sample lets it choose glide or immediate pitch before the
activity follower returns to one. Timing is quantized to the control block
(0.667 ms live; one sample for offline exports). A note must last more than one
control block to establish activity memory.

Pitch is converted to logarithmic octaves relative to C4. Tonality adds a cyclic
offset; brightness shifts the octave weighting. Five sine octaves use a GEN19
raised-cosine blending window. The amplitude envelope is 6 ms attack, 150 ms decay,
80% sustain and 80 ms release, multiplied by live MIDI velocity.

See the official [hsboscil](https://csound.com/docs/manual/hsboscil.html) and
[portk](https://csound.com/docs/manual/portk.html) references.
