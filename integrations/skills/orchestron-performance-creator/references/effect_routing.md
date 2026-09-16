# Audio Routing and Master

Performance configuration v15 stores stable rack instance IDs, one authoritative `audioGraph.routes` list, `audioGraph.insertOwners`, and mixer controls keyed by instance/route ID. The built-in Master is `audioGraph.masterId: "$master"`. Its exact stereo inlets are `left` and `right`; it has no patch, library entry, MIDI channel, or rack assignment. Shell-quote `'$master'` so the dollar sign stays literal.

## Discover ports before connecting

From this skill's directory, with a staged edit:

```bash
uv run orchestron_cli --json edit instruments list
```

Each rack row reports `bindingId`, `audioInlets`, named `audioOutlets`, all routable `audioOutputs`, and `audioInterface` groups. `audioOutputs` includes `$direct.left/right` when a patch contains `outs`. Group names are display metadata; routes use exact member port names. Bindings identify instances, so two instances of one patch can have different routes and settings.

## Main routes and sends

The following assumes the discovered `lead` and `reverb` bindings expose `left/right` ports. Substitute actual ports when they differ.

```bash
# Main dry output to Master:
uv run orchestron_cli --json edit routes add --source lead --outlet left --target '$master' --inlet left --kind main
uv run orchestron_cli --json edit routes add --source lead --outlet right --target '$master' --inlet right --kind main
# Independent stereo send to a shared return:
uv run orchestron_cli --json edit routes add --source lead --outlet left --target reverb --inlet left --kind send
uv run orchestron_cli --json edit routes add --source lead --outlet right --target reverb --inlet right --kind send
# Return output:
uv run orchestron_cli --json edit routes add --source reverb --outlet left --target '$master' --inlet left --kind main
uv run orchestron_cli --json edit routes add --source reverb --outlet right --target '$master' --inlet right --kind main
uv run orchestron_cli --json edit routes list
uv run orchestron_cli --json edit routes list --target reverb
```

New sends start at exact silence and post-fader. Set their gain using [mixer commands](mixer.md). A send uses an ordinary main output; dedicated `sendl/sendr` outlets and patch-level attenuation formulas are unnecessary. Adding a send retains the main route. For parallel reverb or delay, use a return designed to provide the intended wet signal; a pass-through return adds another dry copy.

`--kind` accepts `main`, `send`, or `custom`; omission retains the legacy CLI default `custom`. CLI additions use `sourceStage: strip` and `targetStage: input`. Same endpoints can carry both a main route and a send; repeating the same endpoints, kind, and stages reuses the route ID and settings. A new main route is additive; remove an old destination explicitly when rerouting.

`--inlet` is required when source and destination port names differ. An exact matching name can be inferred. New routes do not use positional or first-inlet fallback. Sources may be playable instruments or continuous generators/effects; the destination needs the selected audio inlet, regardless of activation type.

## Direct Audio Output

`outs` exposes routable `$direct.left/right` ports. No patch cloning or graph rewrite is needed:

```bash
uv run orchestron_cli --json edit routes add --source lead --outlet '$direct.left' --target '$master' --inlet left --kind main
uv run orchestron_cli --json edit routes add --source lead --outlet '$direct.right' --target '$master' --inlet right --kind main
```

An explicit **main** route captures that direct port and replaces its implicit hardware-output path. A send or custom route alone does not capture it. Without main redirection, Direct Audio Output bypasses Master but retains its own strip controls. Other direct output groups can also remain audible: inspect both stereo mappings and routing diagnostics if Master mute does not silence everything.

## Remove or repair connections

Prefer exact IDs from `edit routes list`:

```bash
# Replace ROUTE_ID with an actual ID from the list:
uv run orchestron_cli --json edit routes remove --id ROUTE_ID
```

Exact removal deletes only that connection and its send settings. The older selector remains available and removes all routes matching the source/output/target, including different destination inlets or kinds:

```bash
uv run orchestron_cli --json edit routes remove --source lead --outlet left --target reverb
uv run orchestron_cli --json edit routes clear --target reverb
```

`clear` removes all incoming routes to its target. These are broad operations; use exact IDs when preserving another parallel path or insert connection.

## Inserts and compatibility

A shared return is a continuous rack instance with its own strip and potentially many send sources. An insert is a dedicated processor in one strip's serial chain; its ownership is stored in `insertOwners`, and its explicit routes can use raw-source or strip-return stages. Master can own inserts too.

This CLI preserves existing insert routes, ownership, and settings through edits, commit/import/export, and runtime rebuilds. It does not create/reorder/remove insert chains as a unit; use Orchestron's mixer for those operations. Do not treat arbitrary insert connections as ordinary main routes.

The CLI reads configurations v1–15 and writes v15 (distinct from native bundle envelope v1). Legacy Level values migrate to audio dB, never MIDI velocity. Existing custom/legacy output processors remain supported; do not delete a patch simply because its name contains “speaker” or “Master”.

## Validate and run

```bash
uv run orchestron_cli --json edit validate
uv run orchestron_cli --json edit commit
uv run orchestron_cli --json edit create-runtime --start
```

Route addition and the standard preset validate the complete candidate through `POST /api/sessions/validate-instruments` before saving the draft. `edit routes list` also validates the full graph and displays IDs, exact mappings, kinds, stages, and send values. Invalid ports/references and feedback cycles fail validation; structural validity alone does not prove that a path produces sound.

`edit push-runtime` updates mixer, performance-controller, and sequencer/arpeggiator values only when rack assignments and routes still match. Rack, route, or patch-definition changes require:

```bash
uv run orchestron_cli --json edit rebuild-runtime
```

Rebuild prepares and compiles a replacement before stopping the old runtime and normally preserves its running state. If replacement startup fails, the CLI attempts to restart the old session and removes the replacement. An externally attached session is replaced only with explicit `--replace-external`. Continuous-effect controller changes take effect after rack restart; see [performance controllers](performance_controllers.md). Live updates do not save the performance; commit separately.
