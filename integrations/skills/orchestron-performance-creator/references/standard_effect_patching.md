# Optional Reverb and Compressor Preset

Use this preset when the requested mix calls for shared reverb followed by bus compression. Effects are optional; a performance can simply route instruments into the built-in Master.

From this skill's directory, after adding the source instruments:

```bash
uv run orchestron_cli --json edit add-standard-effects --send-gain-db -12
uv run orchestron_cli --json edit routes list
uv run orchestron_cli --json edit mixer list
uv run orchestron_cli --json edit validate
```

The preset requires existing continuous reverb and compressor patches. Discover their actual names/IDs; defaults resolve “reverb effect” and “compressor effect” case-insensitively. Override with `--reverb-patch` and `--compressor-patch`.

## Signal flow

| Connection | Route kind |
| --- | --- |
| Instrument main stereo output → compressor input | main |
| Same instrument output → reverb input | send |
| Reverb output → compressor input | main |
| Compressor output → built-in Master left/right | main |

Only reverb and compressor instances are added. No speaker/output patch is required or created. `--speaker-patch` is obsolete and fails before making changes; omit it.

New sends default to silence/post-fader; `--send-gain-db -12` explicitly initializes new sends at -12 dB. Existing sends retain their gain and tap, even when this flag is supplied again. The preset leaves existing strip gain, balance, mute/solo and performance-controller settings intact; it does not tune compression or reverb parameters.

## Port selection and preservation

Declared main stereo audio-interface groups take precedence. For older outputs, an exact conventional `dryl/dryr` pair is preferred; otherwise one unambiguous `left/right`, `l/r`, or `$direct.left/right` pair is accepted. Inputs require a declared main stereo group or an unambiguous conventional pair. Ambiguous or non-stereo interfaces require explicit routes instead.

Main outputs supply both the dry path and the send, including for direct-output patches. The preset does not clone patches, replace `outs`, require dedicated send outlets, or add `0.1 * in1` formulas. Existing extra outputs/formulas remain unchanged.

Matching existing effect instances retain their binding IDs. Ambiguous repeated effects or conflicts with reserved preset bindings require explicit routing. Insert instances are excluded from effect reuse and source selection. Existing insert ownership and wiring are preserved.

The preset replaces participating main-output destinations, including reverb and compressor outputs, with the matrix above. Unrelated Master inputs, other effect returns, and additional sends remain. By default it removes additional custom connections into the selected reverb/compressor; use `--merge` to retain those custom connections. Review intentional parallel paths to avoid summing unwanted copies.

Matching routes retain their IDs and send controls; repeated application is idempotent. The full candidate is backend-validated before the staged edit is saved. No patch library entries or saved performances are changed by this command. Use `edit commit` to save and `edit rebuild-runtime` after changing a live runtime's topology.

## Relationship to TB303 Demo

The demo illustrates the current Master/mixer model, not a compulsory effect chain. Its dry instruments feed a compressor into Master, while selected pre/post sends feed a Delay Effect that returns **directly to Master**. This preset deliberately sends its reverb return **through the compressor**. See the [mixer walkthrough](mixer.md#tb303-demo-walkthrough) to author either arrangement explicitly.
