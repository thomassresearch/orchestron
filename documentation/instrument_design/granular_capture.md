# Granular Capture: Stutter, Freeze and Grains

**Navigation:** [Standard Effects](../performance/standard_effects.md) | [Prev](continuous_effects.md) | [Next](stereo_moog_filter.md) | [Mixer and routing](../performance/audio_mixer_and_routing.md) | [Performance controllers](../performance/performance_controllers.md)

**Granular Capture** is one continuous stereo effect with Stutter and Granular playback and a shared Freeze control. Add it as a mixer insert, feed its grouped stereo input, and route its grouped output onward. It records incoming audio continuously, even while playing a frozen snapshot. The two channels keep separate samples and share capture timing and grain positions.

![Granular Capture compiled in Instrument Design](../../screenshots/granular_capture_library.png)

## MIDI switches

The default **MIDI Control Channel is 16**. This setting is independent of MIDI note activation: the instrument remains Continuous and needs no note channel. Each switch has its own configurable CC number. Choose distinct CCs and avoid collisions with other receivers. Mapping knobs stop at 95 because Csound handles RPN/NRPN and some higher CCs specially. Send the initial Reset Value 0 before recording; standard CCs such as volume can start above zero. Instances sharing a channel and CC respond together; select another channel or CC set for independent instances.

| Switch | Default CC | 0–63 | 64–127 |
| --- | --- | --- | --- |
| Stutter | 20 | Release stutter | Capture and repeat the recent slice; an existing Freeze snapshot is retained |
| Freeze | 21 | Release frozen source | Capture and hold the recent slice |
| Capture | 22 | Arm the next trigger | Rising edge replaces the snapshot, including while frozen |
| Granular | 23 | Loop playback when Stutter/Freeze is on; otherwise dry | Play windowed grains from live history or the held snapshot |

Use **0 and 127** in step cells. Capture is a value-edge trigger: put **0 between successive 127 values**. Repeating 127 sends another MIDI message but does not produce another rising edge. Capture alone updates the snapshot without enabling wet playback. Stutter or Freeze alone produces a loop; Granular on produces grains. Freeze off resumes live grains unless Stutter is still holding the snapshot. All three playback/hold switches off returns to dry audio with Output gain.

<!-- pagebreak -->

## Configure a step pattern

1. Add a Controller Sequencer and select **Step Mode**.
2. Select only MIDI channel **16** and set **Controller # 20**.
3. Set **Reset Value 0**. Enter `127` where stutter should begin and `0` where it should end. Empty cells hold the current state.
4. Add lanes for CC21, CC22 and CC23 when needed, each with Reset Value 0. Enable Freeze before switching to Granular to turn a repeat into a sustained texture.
5. For recapture while frozen, send CC22 `127`, then `0`, then another `127` at the next capture point.

A four-beat pattern at 120 BPM with four steps per beat can use:

| Lane | Populated steps (one-based) |
| --- | --- |
| Stutter, CC20 | 3: 127; 7: 0 |
| Freeze, CC21 | 9: 127; 15: 0 |
| Capture, CC22 | 13: 127; 14: 0 |
| Granular, CC23 | 11: 127; 16: 0 |

The [reproducible example](../../examples/instruments/granular_capture/README.md) includes the matching API sequencer configuration. Sequencer start/stop and finite endings send Reset Value. Pad changes and loops hold the current value. A controller stopped with a nonzero Reset Value can leave an effect active. Muted controller lanes do not send their reset; release the corresponding CC manually or restart the rack. A separately running Manual pads controller also remains independent of Arranger Stop.

## Performance settings

These are per-instance I-rate settings. Restart the rack after changing them; MIDI switches act during playback.

| Setting | Range | Default |
| --- | --- | --- |
| MIDI Control Channel | 1–16, rounded | 16 |
| Stutter / Freeze / Capture / Granular CC | 0–95, rounded | 20 / 21 / 22 / 23 |
| Slice | 20–1000 ms | 125 ms |
| Grain Size | 5–200 ms | 50 ms |
| Grains / Second | 1–80 | 40 |
| Grain Pitch | −24–24 semitones, fractional allowed | 0 |
| Position Spread | 0–1 | 0.5 |
| Mix | 0–1 | 1 |
| Output | −24–0 dB | −6 dB |

Slice is the **stutter repeat period**, with an extra 5 ms of history captured for its overlapping seam. At 120 BPM, 125 ms is a sixteenth note. This is a millisecond setting, not automatic tempo synchronization: use `60000 / BPM / subdivisions per beat` and restart after adjusting. Grain Pitch affects granular playback only. Position Spread zero starts each grain at the beginning of the slice; higher values scatter starts within it. Sparse short grains sound choppy; overlapping long grains produce a smoother sustained texture.

Mix zero preserves dry audio, with Output gain and no processing delay. Inactive playback also passes dry. Use an insert: a parallel send would duplicate dry audio while inactive. Freeze can intentionally sustain indefinitely, so send a release before the end of an offline render. Capture before enough history exists includes silence. Engine stop/restart clears both history and snapshot buffers.

<!-- pagebreak -->

## Implementation and limits

The editable graph uses four native [ctrl7](https://csound.com/docs/manual/ctrl7.html) readers feeding the Orchestron `stereo_capture` processor. The processor is an application-defined Csound UDO, not a stock Csound opcode. Its generated code is included in standalone compilation and both CSD exports. SCORE mode rewrites explicit-channel readers to the score controller array, including channels with no note instrument. No channel assignment or persistence schema extension is needed.

Each instance owns separate two-second live and snapshot stereo tables, freed when the instance ends. Captures copy the live tables once per rising edge; recording continues. Loop seams overlap for 5 ms. State changes crossfade from the preceding output sample over 5 ms. Up to 16 Hann-windowed grains share a deterministic private position sequence; summed gain is bounded by their window weights. Pitch shifting uses interpolated resampling, so high transpositions can alias. This is a time-domain freeze, not a spectral freeze.

MIDI switch changes are observed on the engine control-block boundary. The internal processor runs sample by sample, independently of the parent block size. MIDI and SCORE paths may differ by one control block because of event ordering. Very short high/low pulses within the same block are not guaranteed to be observed; normal sequencer steps leave ample separation.

## Files and validation

- [Native instrument](../../examples/instruments/Granular_Capture.orch.instrument.json)
- [Builder, step pattern and auditions](../../examples/instruments/granular_capture/README.md)
- Independent DSP, API, native round-trip, per-instance settings, controller-step and export tests use committed fixtures.
- Audio validation checks dry identity, held history, recapture, reset tails, stereo isolation, grain pitches, extremes, and finite preview headroom. Mel and log-STFT plots accompany the auditions. Listening is reported separately.
