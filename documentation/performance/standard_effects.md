# Standard Effects

**Navigation:** [Up](performance.md) | [Prev](live_status_and_safety_controls.md) | [Next](../instrument_design/tube_overdrive.md)

These supplied stereo effects can process individual instrument strips or the combined mix as Master inserts. They can also run as separate rack instruments receiving effect sends. Import and save an effect in Instrument Design to make it available in Perform.

## Inserts and Sends

An **insert** sits in the signal path: the strip's entire signal passes through the effect before continuing to its destination. Select the instrument strip or Master, choose the effect under **Inserts…**, and click **Add**. Each insert has its own instance inside that strip's chain. This suits EQ, distortion or other processing applied directly to a sound. Any dry/wet blend comes from the effect's own controls, where available.

An **effect send** creates a parallel path: the instrument keeps its main output route and sends an adjustable copy to a separate effect instrument, called a **return**. The processed return is mixed with the main signal. Several instruments can share one return, each with its own send level; the return's fader controls their combined effect output.

## Add a Shared Send Effect

1. Stop the instruments before changing the rack or routing. In **Perform → Add Instrument**, select the saved effect. It appears as a continuous instrument with its own mixer strip.
2. Connect the effect's output to **Master**. Keep each source instrument's main output connected to Master as well, so its original signal remains audible.
3. In **Mixer → Audio routing**, select the instrument under **Source** and the effect under **Destination**. Leave **Stereo** checked, verify the channel mapping, choose **Send** in the Route selector, and click **Add**.
4. On the source strip, adjust **Send → [effect name]** to control how much signal reaches the effect. New sends start at silence; try **−12 dB** initially. **Post-fader** follows the source's volume and balance; **Pre-fader** is independent of those controls. Repeat for other instruments that should share the effect.
5. Start the instruments, balance the send levels and the return's fader while listening, then **Save Performance**. Existing send levels remain adjustable during playback.

For a parallel return, use **wet-only** output where supported, so the original signal is not added twice. For example, set Stereo Flanger's **Mix to 1**. The supplied Stereo Delay includes dry audio, and Granular Capture passes dry audio while inactive; these are generally better used as inserts. Each guide below explains the effect's routing and mix behavior.

## Effect Guides

- [Tube Overdrive](../instrument_design/tube_overdrive.md)
- [Stereo Delay](../instrument_design/stereo_delay.md)
- [Stereo Flanger](../instrument_design/stereo_flanger.md)
- [Autopanner](../instrument_design/autopanner.md)
- [Parametric Equalizer](../instrument_design/parametric_equalizer.md)
- [Stereo Widener, Bit Crusher, and Harmonizer](../instrument_design/continuous_effects.md)
- [Granular Capture](../instrument_design/granular_capture.md)
- [Stereo Moog Filter](../instrument_design/stereo_moog_filter.md)

**Navigation:** [Up](performance.md) | [Prev](live_status_and_safety_controls.md) | [Next](../instrument_design/tube_overdrive.md)
