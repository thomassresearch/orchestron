# Control Flow — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

## Patch/API format

Existing patches remain at `schema_version: 1`. Adding a block promotes the patch to **2**; removing the last block does not downgrade it. Create, update and compile use the existing APIs. Unsupported versions and malformed structural records are rejected. Native instrument/performance exports, application state, patch copies, audition and both CSD export modes retain the configuration.

The graph remains flat. Add a typed `graph.control_flow` map keyed by the structural node's ID; each key must reference an `If` or `Switch` node. The example below describes a mono Switch whose ordinary flat node array also contains `kit`, `kick`, `kick_result` and `default_result`:

```json
{
  "kit": {
    "kind": "switch",
    "output_format": "mono",
    "operator": "==",
    "cases": [
      {"id": "kick_case", "name": "Kick", "value": 36,
       "node_ids": ["kick", "kick_result"],
       "result_node_id": "kick_result", "silence": false},
      {"id": "default_case", "name": "Default", "value": null,
       "node_ids": ["default_result"],
       "result_node_id": "default_result", "silence": true}
    ]
  }
}
```

- `kind`: `if` or `switch`; `output_format`: `mono` or `stereo`.
- `operator`: one of the six comparison operators; only If uses it.
- `cases`: ordered records with stable `id`, editable `name`, numeric `value` for Switch cases, and `null` for Default or both If cases.
- `node_ids`: exclusive membership, including the managed `CaseResult` node identified by `result_node_id`. Nesting and overlapping membership are invalid.
- `silence`: explicit boolean. A silent case contains only its result marker, with no input wiring, parameters or formulas.
- Block inputs: `lhs`/`rhs` for If, `selector` for Switch, all init-rate. Result and block output ports: `left`, plus `right` for stereo. CaseResult has no output ports.
- `graph.ui_layout.editor_state`: optional presentation with `selection` (`nodeIds` and canonical `connections`) and `viewport` (`x`, `y`, positive zoom `k`).
- `graph.ui_layout.control_flow_blocks[blockId]`: `true` means collapsed.
- `graph.ui_layout.control_flow_case_sizes[blockId][caseId]`: optional `{ "width": 1200, "height": 900 }` dimensions in graph units. Missing or malformed entries are initialized after all visible bodies are measured. Case/block deletion removes corresponding entries. Positions stay on ordinary node records; measured bounds and drag previews are transient. Input formulas retain their existing `ui_layout.input_formulas["nodeId::portId"]` format. Presentation never defines execution scope.

The compiler orders the main graph with each block as one operation, orders each case separately, emits shared dependencies first and downstream consumers afterwards, and assigns the common audio variables on every path. Score export retains the `notnum` to score-note conversion. Use the [full drumset fixture](../../backend/tests/fixtures/patches/drumset.patch.json) as a complete authoring reference.

## Case frame layout

The title band is 40 graph units, padding is 24, and cases have a 32-unit gap. Empty cases keep a 240 × 160 content area. Frames grow to contain visible nodes without shrinking after inward moves or removal; Case Result retains its separate bottom-right row.
