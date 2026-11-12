# Goa Trance FM Lead

**Navigation:** [Up](../supplied/instruments.md) | [Previous](enough_and_logan.md) | [Next](../performance/standard_effects.md)

<a id="goa-trance-fm-lead-pitch-dependent-filter-guards"></a>

<a id="exact-stability-boundary"></a>

<a id="portable-graph-representation"></a>

<a id="reproduction-and-validation"></a>

Import the [Goa Trance FM Lead instrument](../../examples/instruments/Goa_Trance_FM_Lead.orch.instrument.json), save it in Instrument Design, then add it to Perform. Assign a MIDI channel and route its output through the mixer to Master. Use a piano roll or melodic track on that channel to play it.

## Play and shape the sound

The instrument combines cross-FM synthesis with two resonant high-pass filters. Start with its default performance settings and a modest mixer level. Try single notes before adding chords, then adjust the supplied controls while comparing the sound. Save Performance to keep the settings for that rack instance.

The filters track pitch and velocity differently in the two channels. Resonance is limited automatically at settings that would otherwise make a filter unstable. The requested control value is retained, but effective resonance can stop increasing as you move higher in the register. The guard is evaluated for each new note.

Resonant gain can still exceed full scale. Leave mixer headroom, especially for high notes or chords. The guard prevents the known filter runaway; it does not act as an output limiter.

## Edit the instrument

The graph remains editable. If you change the filter structure or oversampling, review the stability protection as part of that change. The [filter stability technical reference](../../specifications/manual-reference/goa_trance_fm_lead.md) preserves the derivation, guard formulas and reproduction procedure.

**Navigation:** [Up](../supplied/instruments.md) | [Previous](enough_and_logan.md) | [Next](../performance/standard_effects.md)
