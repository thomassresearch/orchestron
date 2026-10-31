# Customize Instruments Per Performance

`perf_controller` is an Orchestron virtual opcode exposed as a knob, integer stepper or on/off toggle beneath a rack instrument's patch/channel controls. It produces one I-rate output (`iout`) for instrument settings such as ADSR times, sustain, or distortion gain. It is independent of MIDI CC numbers, controller sequencers, and MIDI learn. Use it when the user wants a different sound configuration for a performance or for two instances of one patch.

## Controller types

Use `controller_type: float | integer | bool`. Missing type means `float` and preserves the previous behavior. All outputs remain numeric I-rate values through `iout`; Bool uses numeric `0`/`1`, not JSON booleans. Node IDs and per-instance numeric override maps are unchanged; no persistence-version change is required.

- **Float:** finite min/max/default, linear or logarithmic scale; defaults `0`, `1`, `0.5`, linear.
- **Integer:** safe whole-number min/max/default (−9007199254740991 through 9007199254740991), `min < max`, default within range, linear only; defaults `0`, `1`, `0`. Perform shows triangle buttons and direct integer entry.
- **Bool:** configure `default: 0` (Off) or `default: 1` (On), plus Label. Omitted default is `0`; min/max/scale are fixed to `0`, `1`, linear. Perform shows an on/off toggle.

For example, a controller definition can use `controller_type: integer, min: -2, max: 2, default: 0` for octaves, or `controller_type: bool, default: 1` for a switch. Preserve the usual `id`, `target`, and `label` fields when authoring a patch spec. CLI `set --value` accepts whole numbers for Integer and `0`/`1` for Bool; invalid values are rejected before saving the staged edit.

The GUI converts existing overrides after patch edits: Integer rounds ties toward positive infinity and clamps; Bool uses a `0.5` threshold. It reports adjustments. API/CLI submissions must already satisfy the selected type. A controller type change while running requires a rack restart, even when min/max/default stay unchanged. Reset removes an override; merely choosing the default value does not remove an existing override.

## Discover and stage settings

The patch must already contain the controls. `GET /patches` includes ordered `performance_controllers` definitions with `node_id`, `controller_type`, `label`, `min`, `max`, `default`, `scale`, and optional `error`. `edit instruments list` includes that metadata and current overrides in its JSON output. If the required control is absent, add it to the patch using the patch-creator skill; do not invent an ID or repurpose a MIDI controller.

From this skill's directory, with a staged edit session:

```bash
uv run --locked orchestron_cli --json edit instruments list
uv run --locked orchestron_cli --json edit performance-controllers list --binding bass
uv run --locked orchestron_cli --json edit performance-controllers set --binding bass --node attack --value 0.04
uv run --locked orchestron_cli --json edit performance-controllers set --binding bass --node drive --value 2.5
uv run --locked orchestron_cli --json edit validate
uv run --locked orchestron_cli --json edit commit
```

Use actual binding IDs and controller node IDs from discovery. The example assumes `bass`, `attack`, and `drive` exist. `list` reports each definition's effective `value` and `overridden` status. `set` modifies only the chosen instance's staged override and rejects unknown IDs, nonfinite values, invalid definitions, and values outside the range. It does not change the patch or contact the live runtime. `edit commit` saves the staged performance through the backend, corresponding to the GUI's Save Performance workflow.

To return to a patch default:

```bash
uv run --locked orchestron_cli --json edit performance-controllers reset --binding bass --node attack
uv run --locked orchestron_cli --json edit validate
uv run --locked orchestron_cli --json edit commit
```

Reset removes the override key; setting a value equal to the default keeps an explicit override. Until reset, explicit settings remain authoritative when the patch default changes. Reset can also remove a stale override for a deleted node. It preserves other controls on the instance.

## Separate values for repeated patches

Two bindings may refer to the same patch while owning different values:

```json
{
  "version": 15,
  "instruments": [
    {"id": "bass", "patchId": "lead-patch-id", "midiChannel": 1,
     "performanceControllerValues": {"attack": 0.01, "drive": 2.5}},
    {"id": "pad", "patchId": "lead-patch-id", "midiChannel": 2,
     "performanceControllerValues": {"attack": 1.2, "drive": 0.5}}
  ]
}
```

This is an assignment excerpt; preserve the performance's sequencer, `audioGraph`, mixer, and other configuration fields. Node IDs identify controls; duplicate labels and moved nodes remain independent. An omitted key follows the patch default. Never materialize defaults into every assignment, because that would freeze untouched settings. If replacing a binding's patch, clear its overrides; copying/importing a patch preserves node IDs and corresponding overrides even when its patch ID is remapped.

The CLI reads performance versions 1–21 and saves version 21 while retaining routing migrations. Overrides survive staged edits, commit/load, native JSON/ZIP imports/exports, and runtime creation. Both CSD (MIDI) and CSD (SCORE) exports initialize resolved instance settings without a controller client or MIDI CC events. Standalone patch compilation/export and isolated audition use defaults; audition within a performance uses that instance's overrides.

## Live updates

### Compressor and reverb settings

Effect parameters are separate from the return fader and send amounts documented in [mixer controls](mixer.md). For a discovered effect binding:

```bash
uv run --locked orchestron_cli --json edit performance-controllers list --binding compressor
# Replace NODE_ID with an actual discovered node, and use its reported range:
uv run --locked orchestron_cli --json edit performance-controllers set --binding compressor --node NODE_ID --value 0.04
```

The Compressor Effect in the inspected TB303 Demo exposes Rise, Fall, Upper, Lower and Threshold. These labels and their units/ranges come from that patch; do not assume conventional compressor parameters or reuse its UUIDs for another library. Reverb and delay patches may expose different controls or none at all. If no suitable control exists, mixer commands can still change the send/return level, but cannot tune the effect algorithm.

Continuous effects keep initialized values until rack restart. Validate and commit the override, then rebuild a CLI-owned runtime to hear it. Ordinary mixer gain, balance, mute and send changes remain live without restarting.

### Apply to an attached runtime

For an existing attached runtime whose rack and patch definitions are unchanged:

```bash
uv run --locked orchestron_cli --json edit performance-controllers set --binding bass --node attack --value 0.08
uv run --locked orchestron_cli --json edit push-runtime
```

`push-runtime` serially sends changed complete override maps through:

```text
PUT /sessions/{session_id}/instruments/{assignment_id}/performance-controllers
{"values": {"attack": 0.08, "drive": 2.5}}
```

The endpoint replaces the entire map for that assignment. Include every override to retain; omitting a previously present key resets it. Session creation uses the snake-case `performance_controller_values` field, whereas saved performance assignments use `performanceControllerValues`. Do not put either map in patch node `params`.

Updates use initialization-time software-channel reads. Sounding notes retain their initialized settings; subsequent notes use the new values. Knob-only changes do not recreate the runtime. Always-on instruments retain their initialized value until rack restart; for a CLI-owned runtime, `edit rebuild-runtime --start` recompiles and starts with the staged settings. For a new runtime, use `edit create-runtime --start`.

Live writes do not save the performance. Commit separately to preserve changes. On a failed push, keep the staged latest values, inspect the structured error, and retry after correcting the cause. Do not report success or resume playback until the update succeeds. Rack/route/patch-definition changes require runtime replacement, not a controller retry. Follow the ownership rules in [effect routing](effect_routing.md) before replacing an attached runtime.

## Patch ranges and edits

Patch definitions have fixed `min`, `max`, `default`, `scale` (`linear` or `logarithmic`), and `label`, with no input sockets. Defaults are 0, 1, 0.5, linear, and Parameter. Numbers must be finite, `min < max`, and default within range. Logarithmic controls require positive minimum; zero-inclusive and bipolar ranges must be linear. Labels must contain 1–128 characters and cannot be blank.

After editing a patch, discover its definitions again. The GUI clamps changed ranges and removes deleted overrides with a visible notice. The CLI preserves explicit staged settings and backend validation rejects stale or out-of-range values; use `set` to choose a valid value or `reset` to remove an obsolete override, then validate and commit. Keep IDs stable when relabeling or moving nodes. Use patch defaults as reusable starting points and performance overrides for instance-specific choices.
