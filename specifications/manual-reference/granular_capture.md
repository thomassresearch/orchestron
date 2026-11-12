# Granular Capture — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

## Implementation and limits

The editable graph uses four native [ctrl7](https://csound.com/docs/manual/ctrl7.html) readers feeding the Orchestron `stereo_capture` processor. The processor is an application-defined Csound UDO, not a stock Csound opcode. Its generated code is included in standalone compilation and both CSD exports. SCORE mode rewrites explicit-channel readers to the score controller array, including channels with no note instrument. No channel assignment or persistence schema extension is needed.

Each instance owns separate two-second live and snapshot stereo tables, freed when the instance ends. Captures copy the live tables once per rising edge; recording continues. Loop seams overlap for 5 ms. State changes crossfade from the preceding output sample over 5 ms. Up to 16 Hann-windowed grains share a deterministic private position sequence; summed gain is bounded by their window weights. Pitch shifting uses interpolated resampling, so high transpositions can alias. This is a time-domain freeze, not a spectral freeze.

MIDI switch changes are observed on the engine control-block boundary. The internal processor runs sample by sample, independently of the parent block size. MIDI and SCORE paths may differ by one control block because of event ordering. Very short high/low pulses within the same block are not guaranteed to be observed; normal sequencer steps leave ample separation.

## Files and validation

- [Native instrument](../../examples/instruments/Granular_Capture.orch.instrument.json)
- [Builder, step pattern and auditions](../../examples/instruments/granular_capture/README.md)
- Independent DSP, API, native round-trip, per-instance settings, controller-step and export tests use committed fixtures.
- Audio validation checks dry identity, held history, recapture, reset tails, stereo isolation, grain pitches, extremes, and finite preview headroom. Mel and log-STFT plots accompany the auditions. Listening is reported separately.
