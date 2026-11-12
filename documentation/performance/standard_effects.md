# Standard Effects

**Navigation:** [Up](../supplied/supplied.md) | [Previous](../instrument_design/goa_trance_fm_lead.md) | [Next](../instrument_design/tube_overdrive.md)

These supplied stereo effects can process individual instrument strips or the combined mix as Master inserts. They can also run as separate rack instruments receiving effect sends. Import and save an effect in Instrument Design to make it available in Perform.

## Effect Guides

<!-- manual-contents:start -->
- [Tube Overdrive](../instrument_design/tube_overdrive.md)
- [Stereo Delay](../instrument_design/stereo_delay.md)
- [Stereo Flanger](../instrument_design/stereo_flanger.md)
- [Autopanner](../instrument_design/autopanner.md)
- [Parametric Equalizer](../instrument_design/parametric_equalizer.md)
- [Stereo Widener, Bit Crusher, and Harmonizer](../instrument_design/continuous_effects.md)
- [Granular Capture: Stutter, Freeze and Grains](../instrument_design/granular_capture.md)
- [Stereo Moog Filter](../instrument_design/stereo_moog_filter.md)
- [Stereo Auto Wah Wah](../instrument_design/stereo_auto_wah_wah.md)
- [Trance Gate](../instrument_design/trance_gate.md)
<!-- manual-contents:end -->

## Inserts and Sends

An **insert** processes a strip's entire signal. Select the instrument strip or Master, choose an effect under **Inserts…**, and click **Add**. Use the effect's own Mix control for dry/wet balance.

An **effect send** adds a parallel path to a separate effect instrument, called a **return**. Several instruments can share it, each with its own send level. See [Audio Mixer and Routing](audio_mixer_and_routing.md) for the routing controls.

## Add a Shared Send Effect

1. Stop the instruments before changing the rack or routing. In **Perform → Add Instrument**, select the saved effect. It appears as a continuous instrument with its own mixer strip.
2. Connect the effect's output to **Master**. Keep each source instrument's main output connected to Master as well, so its original signal remains audible.
3. In **Mixer → Audio routing**, select the instrument under **Source** and the effect under **Destination**. Leave **Stereo** checked, verify the channel mapping, choose **Send** in the Route selector, and click **Add**.
4. On the source strip, adjust **Send → [effect name]** to control how much signal reaches the effect. New sends start at silence; try **−12 dB** initially. **Post-fader** follows the source's volume and balance; **Pre-fader** is independent of those controls. Repeat for other instruments that should share the effect.
5. Start the instruments, balance the send levels and the return's fader while listening, then **Save Performance**. Existing send levels remain adjustable during playback.

For a parallel return, use **wet-only** output where supported, so the original signal is not added twice. For example, set Stereo Flanger's **Mix to 1**. The supplied Stereo Delay includes dry audio, and Granular Capture passes dry audio while inactive; these are generally better used as inserts. Each guide below explains the effect's routing and mix behavior.

## Stereo Chorus Depth

[Download Stereo Chorus](../../examples/instruments/Stereo_Chorus.orch.instrument.json)
and add it as a mixer insert. **Amount** ranges from `0.001` to `0.1` seconds (default `0.02`); **LFO Frequency Multiplier** ranges from `0.1` to `10` (default `1`). Higher Amount increases modulation depth and wet delay. Check each control's **Live** or **Requires restart** label.

Update older copies before using large Amount values, then restart the rack. The [technical notes](../../specifications/manual-reference/performance_controllers.md#stereo-chorus-depth) explain the corrected delay range.

**Navigation:** [Up](../supplied/supplied.md) | [Previous](../instrument_design/goa_trance_fm_lead.md) | [Next](../instrument_design/tube_overdrive.md)
