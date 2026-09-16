# Mixer Controls and Shared Effects

Build connections with [audio routing](effect_routing.md), then set the scalar mix controls. Mixer commands edit the staged performance; commit saves it and push-runtime applies compatible values to an attached runtime.

## Strip, return, and Master controls

From this skill's directory, after discovering the actual binding IDs:

```bash
uv run orchestron_cli --json edit mixer list
uv run orchestron_cli --json edit mixer strip set --binding lead --gain-db -6 --balance 0.25
uv run orchestron_cli --json edit mixer strip set --binding reverb --gain-db -12
uv run orchestron_cli --json edit mixer strip set --binding '$master' --gain-db -3
uv run orchestron_cli --json edit mixer strip set --binding lead --mute
uv run orchestron_cli --json edit mixer strip set --binding lead --no-mute --solo
uv run orchestron_cli --json edit mixer strip set --binding lead --no-solo
uv run orchestron_cli --json edit mixer strip set --binding lead --gain-db silence
```

Only specified fields change. `silence` stores `gainDb: null`; restore an audible level with another `--gain-db` value. Strip gain spans -60 to +12 dB and balance spans -1 to +1. New strips start at 0 dB, centered, unmuted and unsoloed. Master supports gain/balance/mute but no solo. Mixer gain changes audio, not MIDI note velocity.

Returns have ordinary strip controls. An instrument strip processes summed voices through its inserts, then balance and fader. Master processes its incoming stereo sum through Master inserts, balance, fader and final output. Direct Audio Output bypasses Master unless explicitly redirected by a main route.

## Stereo send settings

Each exact channel connection has a route ID. Discover both IDs for a stereo send:

```bash
uv run orchestron_cli --json edit routes list --target reverb
```

The listing includes `kind`, `sourceStage`, `targetStage` and `send: {gainDb, tap}`. Use only IDs whose kind is `send`. Substitute the two actual IDs for `LEFT_ROUTE_ID` and `RIGHT_ROUTE_ID` below:

```bash
uv run orchestron_cli --json edit mixer send set --route LEFT_ROUTE_ID --route RIGHT_ROUTE_ID --gain-db -12 --tap post
uv run orchestron_cli --json edit mixer send set --route LEFT_ROUTE_ID --route RIGHT_ROUTE_ID --tap pre
uv run orchestron_cli --json edit mixer send set --route LEFT_ROUTE_ID --route RIGHT_ROUTE_ID --gain-db silence
```

All selected routes are checked before saving; an invalid ID or value leaves the draft unchanged. A repeated `--route` makes the stereo update atomic. New sends start silent and post-fader. Send gain spans -60 to +6 dB, plus exact silence. Changing only the tap preserves the amount.

| Tap | Source signal |
| --- | --- |
| pre | After inserts, before strip balance and fader |
| post | After inserts, balance and fader |

Mute blocks outgoing paths including pre-fader sends. Multiple solos are possible; required upstream inputs/downstream processors remain connected and mute takes precedence. Gain, balance and send changes ramp over 20 ms. No limiter or normalization is automatically applied; use meters to assess the result.

## Save and live updates

```bash
uv run orchestron_cli --json edit validate
uv run orchestron_cli --json edit commit
uv run orchestron_cli --json edit push-runtime
```

Mixer-only updates use the existing `/sessions/{id}/mixer` endpoint without recompilation or transport reset. Route/rack/patch-definition changes require runtime rebuild. Effect parameter overrides are separate from mixer settings; continuous effects need a rack restart to adopt new I-rate values. See [performance controllers](performance_controllers.md).

In saved configuration v15, strip controls are `mixer.strips[bindingId]`, Master is `mixer.strips['$master']`, and send controls are `mixer.sends[routeId]`. Stereo routes keep separate IDs and values. Save/load, native bundles, and runtime rebuilds retain them, including insert-owned routes and instance overrides.

## TB303 Demo walkthrough

The saved example inspected on 2026-09-16 has this structure:

| Sources | Destination |
| --- | --- |
| The Real TB303, Analog Drumkit, FM bell, Furnace Techno Stab main outputs | Compressor Effect → Master |
| FM bell `dryl/dryr`, post-fader sends | Delay Effect |
| Furnace Techno Stab `left/right`, pre-fader sends | Delay Effect |
| Delay Effect output | Master, separately from the compressor |

There is no speaker instance, and Master consumes no rack slot. Its saved `insertOwners` is empty. The bell uses the same `dryl/dryr` ports for both dry routing and sends, demonstrating that a mixer send does not need a dedicated patch output.

Inspect a user's copy without changing it:

```bash
uv run orchestron_cli --json performances get "TB303 Demo"
```

The response is under `result.config`. Map `instruments[].id` to `patchName`, then inspect `audioGraph.routes` and `mixer`; never assume the demo's UUIDs exist in another library. Its levels and compressor settings are mix-specific examples, not defaults for other music. Its delay has no exposed performance-controller knobs in this snapshot; the compressor exposes Rise, Fall, Upper, Lower and Threshold. Discover current node IDs/ranges before changing them.

The optional standard preset sends reverb through the compressor, whereas this demo returns its delay directly to Master. Both topologies use the same routing and mixer commands.
