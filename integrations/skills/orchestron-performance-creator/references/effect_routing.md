# Always-On Effect Routing

Performance configuration version 11 stores stable rack instance IDs, one authoritative `audioGraph.routes` list, and mixer values keyed by instance/route ID:

```json
{
  "version": 11,
  "instruments": [{"id":"lead","patchId":"lead-patch","midiChannel":1},{"id":"reverb","patchId":"reverb-patch","midiChannel":0}],
  "audioGraph": {"masterId":null,"insertOwners":{},"routes":[{"id":"send-left","sourceId":"lead","sourcePort":"sendl","targetId":"reverb","targetPort":"left","kind":"send","sourceStage":"strip","targetStage":"input"}]},
  "mixer": {"strips":{"lead":{"gainDb":-6,"balance":0,"mute":false,"solo":false}},"sends":{"send-left":{"gainDb":-12,"tap":"post"}}}
}
```

Versions 1–10 are upgraded once. Old Level values become audio dB, including effect slots, and implicit inlet mappings become exact routes. New snapshots omit `level`, `effectRoutes` and `effectSourceIds`. The deprecated `--level` option converts to audio gain and never scales MIDI velocity. Explicit graph, Master, insert ownership and mixer fields survive CLI editing and runtime rebuilds.

## Discover Rack IDs and Ports

```bash
orchestron_cli --json edit instruments list
```

The result includes each `bindingId`, patch, always-on state, MIDI channel, audio gain, available `audioInlets`/`audioOutlets`, and incoming/outgoing route counts. Route commands use binding IDs, not patch IDs or MIDI channels.

## Edit Routes

```bash
orchestron_cli --json edit routes add \
  --source lead \
  --outlet sendl \
  --target reverb --inlet left

orchestron_cli --json edit routes list
orchestron_cli --json edit routes list --target reverb

orchestron_cli --json edit routes remove \
  --source lead \
  --outlet sendl \
  --target reverb

orchestron_cli --json edit routes clear --target reverb
```

Sources can be playable instruments or always-on effects, so chains such as `lead -> reverb -> compressor -> speaker` are supported. A target must expose the selected `inleta` port; activation is independent. The selected outlet must exist on the source patch. Self-routes and indirect cycles are rejected locally and by the backend.

`edit routes list` calls the backend validation endpoint and shows the resolved target inlet for every source outlet. New routes require an explicit `--inlet` when source and destination names differ. An exact existing name can be inferred safely. Legacy stereo/positional/first-inlet fallback is used only during migration, never to choose an ambiguous new route.

## Validate and Run

```bash
orchestron_cli --json edit validate
orchestron_cli --json edit create-runtime --start
```

Validation sends the complete rack to `POST /api/sessions/validate-instruments`. Backend diagnostics cover unknown assignments, duplicate IDs, invalid target types, missing `inleta`/`outleta` ports, unknown outlet labels, and feedback loops.

Rack assignments and Csound `connect` statements are fixed when a runtime session compiles. `edit push-runtime` therefore updates mixer and sequencer/arpeggiator state and refuses to continue if rack assignments or routes differ. Rebuild a CLI-owned runtime after rack or route edits:

```bash
orchestron_cli --json edit rebuild-runtime
```

The replacement is created, configured, and compiled before the old runtime is stopped. By default it preserves the old running state. If replacement startup fails, the CLI attempts to restart the old session and removes the replacement. An externally attached session is never replaced unless `--replace-external` is explicitly supplied.
