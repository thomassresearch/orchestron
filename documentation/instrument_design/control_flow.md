# If, Switch and Drumset

**Navigation:** [Graph Editor](graph_editor.md) | [Supported constructs](supported_opcodes.md) | [Audio Mixer](../performance/audio_mixer_and_routing.md)

## Choose a Synthesis Case at Note Start

**If** and **Switch**, in the **Control flow** catalog category, are editor constructs that generate Csound `if/elseif/else/endif`. Each synthesis voice chooses one case when it starts. Only that case initializes and performs; selection remains fixed until the voice ends. Different notes, including repetitions of the same note, have independent voices.

1. Add If or Switch. New blocks produce stereo audio. If compares two init-rate inputs using `==`, `!=`, `<`, `<=`, `>` or `>=`. Switch compares its init-rate selector with unique numeric case values. For drums, connect `notnum.inote` to `selector`. Input connections and the existing arithmetic Input Formula Assistant take precedence over literal values in **Configure branches**.
2. Expand the cases on the canvas and drag opcodes from the catalog into a case. A valid drop into **Silence** changes it to **Synthesis** and exposes its result inputs. Ordinary canvas drops create main-graph nodes. Dropping onto a collapsed block expands it; drop again into a specific case.
3. Connect each synthesis case to its managed **Case Result** audio inputs. Several sources can sum at an input, or use an input formula. Connect the block's common output to shared processing or a named Stereo Output. Every non-silent case needs a value for every result channel, even if that case is rarely selected.
4. False and Default initially use **Silence**. Silence assigns zero to every output and contains no synthesis nodes. Changing an existing case to Silence previews the nodes, connections and formulas that will be removed. Switch cases can be renamed, reordered, added and deleted; Default remains last and cannot be deleted. If keeps its two ordered True/False cases.
5. Collapse to see the condition, case summary, shared inputs and common output. Node IDs, selection, positions and the viewport survive collapse, save and reload. Captured input formulas are retained; expand to edit them. Format changes show an impact preview: mono preserves `left` and removes `right` wiring only after confirmation; switching back to stereo leaves `right` unconnected. Block/case deletion removes owned content and associated formulas and configuration together.

### Arrange and transfer nodes

The block stays above and left-aligned with the first case, with room for its complete body and buttons. Case frames measure every visible parameter row at any zoom. They automatically grow to the right and bottom and retain their size when nodes move inward, are removed, or become smaller; **Case Result** stays in a separate row at the bottom-right. Later cases move down or up without changing their internal arrangement. The title band is 40 graph units, padding is 24, and cases have a 32-unit gap. Empty cases keep a 240 × 160 content area.

Drag the **Case Result title or unused body** to resize a branch in both dimensions, including shrinking it. This also works for the Silence marker. The pointer displacement sets the requested size; complete node bounds, padding and the reserved result row limit how small it can become. Other selected nodes stay still and selection is preserved. Sockets, formula editing and help buttons keep their usual actions. Release commits the size and managed positions together; **Escape**, cancellation or focus loss restores the full prior layout. Ordinary dragging retains the largest frame size reached during the gesture. Bright purple borders stay about two screen pixels wide at every zoom. Sizes survive collapse, block movement, reordering, save/reload, copies and export/import.

- Drag main-graph nodes into an expanded case to transfer them. Dragging existing case members normally only rearranges them within that case. Their top and left movement limits keep them clear of the header; selected groups keep their relative spacing. Moving the block moves all contents together.
- Hold **Alt/Option before starting the drag** to transfer case members to another case or the main graph. Keep the desired group selected. **Move selected nodes** in Configure branches is the alternative, with identical validation.
- A transfer requires every connection and formula binding touching a moved node to end at another moved node or a node already in the destination scope. A cyan border marks an allowed target; a red border and diagnostic list refused connections and unselected endpoints. Nothing is automatically selected, disconnected or deleted. An isolated ordinary node can always transfer.
- This restriction applies to **membership transfers**. Existing shared main-graph inputs remain valid; you can deliberately connect them after placing the nodes. Case-local values still leave through Case Result only. Main-graph-only constructs, nested blocks and independent Case Result transfers are refused.
- Release to commit positions and membership together. A refused drop, **Escape**, pointer cancellation or loss of focus restores the entire group and clears highlighting. A refused drop leaves Silence unchanged.

### Play the Drumset template

Choose **New from template → Drumset**. Notes **36**, **38**, and **42** play kick, snare, and hi-hat; all other notes select Default Silence. The kick uses a falling-pitch sine, the snare combines filtered noise and tone, and the hi-hat uses high-pass-filtered noise. Velocity scales finite amplitude envelopes. Branch-local `xtratim` preserves their decays after short MIDI notes. Audition offers a **Test MIDI note** field; for this template it starts at 36. Save, assign the patch to a MIDI channel in Perform, and route its named Stereo Output to the mixer destination. Send 36, 38 and 42 together to play all three sounds.

Processing after the block runs **once per voice**. Put effects in the performance mixer when they should process the **sum of the whole kit**. The [velocity-dependent If example](../../backend/tests/fixtures/patches/velocity_if.patch.json) uses `ampmidi` and If to choose sine or saw timbre by velocity; it requires no separate layering subsystem.

Continuous switching, nested blocks, numeric results, raw jumps, crossfades, MIDI learn, ranges and choke groups are outside this release. Keep `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` and `midi_legato` in the main graph. GEN nodes and duration controls may belong to cases. Cycles and illegal scope crossings are compile errors, and all cases are validated.

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
