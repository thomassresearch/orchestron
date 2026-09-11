# Authoring Performance Controllers

`perf_controller` is an Orchestron virtual opcode for adapting an instrument to a performance. Use it for note-initialization settings such as ADSR times, sustain, or distortion amount. Use MIDI controller opcodes and CC tracks when the user wants MIDI-driven automation instead.

## Patch-spec authoring

Add an ordered `performance_controllers` list to a normal patch spec:

```yaml
name: Customizable Lead
family: simple_osc
effects:
  - opcode: distort1
    pre_gain: 1
    post_gain: 0.3
performance_controllers:
  - id: attack
    target: amp_madsr.iatt
    min: 0.001
    max: 5
    default: 0.01
    scale: logarithmic
    label: Attack (s)
  - id: sustain
    target: amp_madsr.islev
    min: 0
    max: 1
    default: 0.7
    scale: linear
    label: Sustain
  - id: drive
    target: effect_1_distort1.kpregain
    min: 0.1
    max: 20
    default: 1
    scale: logarithmic
    label: Drive
```

Save as `customizable-lead.yaml`, then run the skill CLI:

```bash
uv run orchestron_patch_cli --json spec validate customizable-lead.yaml
uv run orchestron_patch_cli --json graph render customizable-lead.yaml --out customizable-lead.graph.json
uv run orchestron_patch_cli --json patch create customizable-lead.yaml --compile
```

`id` is the new stable node ID; it must be unique in the generated graph. `target` names an existing input. Render the base spec to discover target IDs when needed. Each entry replaces inbound connections and the literal parameter at that target, then connects the new node's `iout`. Existing generated constants may remain unused. Definitions retain list order in the graph and rack. The final Stereo Output pair remains last. Input formulas are applied afterward, so a formula at the target can intentionally scale the controller connection.

Configuration defaults when omitted: `min: 0`, `max: 1`, `default: 0.5`, `scale: linear`, `label: Parameter`. All three numbers must be finite, `min < max`, and default within range. Logarithmic ranges require `min > 0`; use linear for zero-inclusive or bipolar ranges. Labels must contain 1–128 characters and cannot be blank. Do not store formulas or connections on these configuration fields. Backend compilation verifies the target port and rate compatibility; I-rate may feed compatible K-rate inputs, but the value still changes only at initialization.

## Existing graph representation

For an existing full graph, add or edit an ordinary node:

```json
{
  "id": "attack",
  "opcode": "perf_controller",
  "params": {"min": 0.001, "max": 5, "default": 0.01, "scale": "logarithmic", "label": "Attack (s)"},
  "position": {"x": 40, "y": 650}
}
```

Connect `attack.iout` to the intended I-rate input, replacing that input's old connection. The node has no connectable inputs. Preserve the rest of the graph, including control-flow ownership, audio mappings, and layout. The high-level patch-spec command regenerates its graph; for custom graphs, use a targeted backend graph update with compile preflight instead of replacing the patch with a new generated spec.

## Identity, defaults, and performance handoff

- Node IDs identify controllers. Preserve them across edits and copied-patch imports. Duplicate labels are allowed; labels and positions do not identify a setting.
- Patch `default` is the reusable instrument default. Instance overrides belong in a performance's instrument assignment as `performanceControllerValues: {attack: 0.08, drive: 2.5}`. Never write an instance value into the shared patch's `default` merely to customize one performance.
- Untouched controls follow the default. Once changed, an explicit override remains authoritative even when equal to the default. Reset removes the key. Changing the rack binding to another patch clears its overrides.
- The GUI reconciles patch edits by clamping overrides to changed ranges and dropping deleted controllers, with a notice. When editing through backend utilities, validate existing settings after a patch change and explicitly correct out-of-range or removed IDs before saving or starting a runtime.
- New notes read new values; sounding notes retain their initialized value. Always-on instruments require rack restart. Standalone patch export/compilation and isolated audition use defaults; performance-instance audition uses that instance's overrides.
- Hand off the patch ID plus the controller node IDs, ranges, and defaults to the performance task. The performance skill provides `edit performance-controllers list`, `set`, and `reset` commands. Native performance JSON/ZIP and both CSD (MIDI) and CSD (SCORE) exports retain resolved settings without MIDI CC events or an external controller client.
