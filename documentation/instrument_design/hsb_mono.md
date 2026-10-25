# HSB Mono

**Navigation:** [Instrument Design](instrument_design.md) · [Monophonic Legato](midi_legato.md)

Import [HSB Mono](../../examples/instruments/HSB_Mono.orch.instrument.json), add it
to the performance rack, and route **Stereo Output → Master**. Play MIDI notes
36–84 for the intended bass/lead range. The sound blends five sine-wave octaves.

| Performance parameter | Range | Default | MIDI CC |
| --- | --- | --- | --- |
| Tonality (octave cycle) | 0–1 | 0 | 20 |
| Brightness (octaves) | −2 to +2 | 0 | 74 |
| Legato half-time (s) | 0.001–0.5, logarithmic | 0.060 | 5 |
| MIDI control channel | 1–16 | 16 | — |

Send CCs on the selected control channel, independently of the note channel.
For each mapped controller, **value 0 recalls the rack setting**; values 1–127
span its full range. Use controller-sequencer **Reset Value 0**. CC changes have
10 ms smoothing and affect held notes; rack settings refresh at phrase start.
Instances sharing a control channel share MIDI automation.

Touching or overlapping notes share one voice and envelope; the newest held note
wins. Gaps up to approximately **20 ms** retain pitch glide, while longer gaps
start directly at the new pitch. A positive gap restarts the amplitude envelope.
Larger half-times produce slower slides. The 20 ms window is fixed in this patch
and quantized to the control block. Existing monophonic support and The Real TB303
are unchanged.

Tonality is cyclic: 0 and 1 give the same pitch class. Brightness moves the
spectral weighting across octaves. The amplitude envelope is 6 ms / 150 ms /
80% / 80 ms and responds to note velocity.

[Authoring details and reproducible previews](../../examples/instruments/hsb_mono/README.md).
