# Performance Controllers — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

Each instrument instance displays matching names inside one thin labeled border.
Groups follow their first occurrence in patch-node order; controls retain their
order within each group. Ungrouped controls share an unbordered block at their
first occurrence. Groups remain expanded and can sit beside one another or wrap.

Perform uses the available browser width. Instrument cards and controller groups
automatically choose widths and rows while retaining the saved instrument,
group and controller order. Group borders fit their controls closely; spare space
stays outside the borders. To avoid tall, narrow groups, the layout may use up to
5% more height than the shortest group arrangement, favoring less empty space
inside groups and horizontal rows. For example, Envelope can display Attack,
Decay, Sustain and Release together in one row when space allows.

Group names belong to the instrument definition, survive native export/import,
and do not change controller identity, saved values, MIDI assignments or sound.
Changing only a group name does not require restarting the rack.

Node IDs identify controls; duplicate labels are allowed. Changing the selected patch clears its overrides. Editing a patch range clamps saved values. Changing to Integer rounds overrides to the nearest integer (ties toward positive infinity) and clamps to the range. Changing to Bool maps values below `0.5` to `0` and values at least `0.5` to `1`. Deleting a controller removes its override. These adjustments show a notice in the rack; untouched defaults remain implicit. External API and CLI submissions must already satisfy the selected type: fractional Integer values and Bool values other than `0`/`1` are rejected. Standalone patch export and isolated audition use defaults; audition within a performance uses the selected instance’s values.

`perf_controller` is an Orchestron editor construct lowered to [chnget](https://csound.com/docs/manual/chnget.html) and channel initialization. Realtime continuous controllers marked Live use K-rate reads; other controllers use I-rate reads. It is not a native Csound opcode.


## Stereo Chorus Depth

[Download Stereo Chorus](../../examples/instruments/Stereo_Chorus.orch.instrument.json)
and add it as a mixer insert. **Amount** controls all twelve LFO amplitudes from
`0.001` to `0.1` seconds (default `0.02`); **LFO Frequency Multiplier** ranges from
`0.1` to `10` (default `1`). Both controls use logarithmic scales; check each control’s **Live** or **Requires restart** label. Existing controller IDs and performance overrides are preserved.

Each tap uses `base delay + Amount + LFO`, with a 250 ms buffer. Since the LFO
swings between negative and positive Amount, taps remain between 14 and 230.5 ms
at the supplied 48 kHz / 32-sample settings. Larger Amount values increase both
modulation depth and wet delay, producing a more pronounced modulated-delay sound.
The dry stereo mix and feedback remain unchanged.

Earlier copies that use only `base delay + LFO` with a 50 ms buffer are unsafe
with large Amount values. Update the instrument and restart the rack to clear
invalid delay-buffer contents. Merely enlarging the buffer does not prevent
negative tap times.

