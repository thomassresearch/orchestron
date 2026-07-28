# Always-On Effect Routing

Performance config version 10 gives every rack assignment a stable `id` and stores incoming audio routes on always-on targets:

```json
{
  "id": "reverb",
  "patchId": "reverb-patch-id",
  "midiChannel": 0,
  "effectSourceIds": ["lead"],
  "effectRoutes": [
    {"sourceId": "lead", "channel": "sendl"},
    {"sourceId": "lead", "channel": "sendr"}
  ]
}
```

`effectRoutes` is authoritative. `effectSourceIds` is retained as derived compatibility metadata. Opening or validating an older staged performance upgrades it to version 10, generates stable assignment IDs, forces always-on assignments to MIDI channel 0, and expands legacy source-only routing into one explicit route per available source `outleta` label.

## Discover Rack IDs and Ports

```bash
orchestron_cli --json edit instruments list
```

The result includes each `bindingId`, patch, always-on state, MIDI channel, level, available `audioInlets`/`audioOutlets`, and incoming/outgoing route counts. Route commands use binding IDs, not patch IDs or MIDI channels.

## Edit Routes

```bash
orchestron_cli --json edit routes add \
  --source lead \
  --outlet sendl \
  --target reverb

orchestron_cli --json edit routes list
orchestron_cli --json edit routes list --target reverb

orchestron_cli --json edit routes remove \
  --source lead \
  --outlet sendl \
  --target reverb

orchestron_cli --json edit routes clear --target reverb
```

Sources can be playable instruments or always-on effects, so chains such as `lead -> reverb -> compressor -> speaker` are supported. A target must be an always-on patch with at least one `inleta` port. The selected outlet must exist on the source patch. Self-routes and indirect cycles are rejected locally and by the backend.

`edit routes list` calls the backend validation endpoint and shows the resolved target inlet for every source outlet. Inlet selection uses this order:

1. Exact label match.
2. Stereo-style matching (`left`/`right`, `l`/`r`, and paired suffixes such as `sendl`/`sendr`).
3. Positional matching when the source and target expose the same number of ports.
4. The first target inlet as a mono fallback.

## Validate and Run

```bash
orchestron_cli --json edit validate
orchestron_cli --json edit create-runtime --start
```

Validation sends the complete rack to `POST /api/sessions/validate-instruments`. Backend diagnostics cover unknown assignments, duplicate IDs, invalid target types, missing `inleta`/`outleta` ports, unknown outlet labels, and feedback loops.

Rack assignments and Csound `connect` statements are fixed when a runtime session compiles. `edit push-runtime` therefore updates only sequencer/arpeggiator state and refuses to continue if rack assignments or routes differ. Rebuild a CLI-owned runtime after rack or route edits:

```bash
orchestron_cli --json edit rebuild-runtime
```

The replacement is created, configured, and compiled before the old runtime is stopped. By default it preserves the old running state. If replacement startup fails, the CLI attempts to restart the old session and removes the replacement. An externally attached session is never replaced unless `--replace-external` is explicitly supplied.
