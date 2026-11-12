# If, Switch and Drumset

**Navigation:** [Up](instrument_design.md) | [Previous](gen_table_editor.md) | [Next](midi_legato.md)

<a id="patchapi-format"></a>

## Choose a Synthesis Case at Note Start

**If** and **Switch**, in the **Control flow** catalog category, are editor constructs that generate Csound `if/elseif/else/endif`. Each synthesis voice chooses one case when it starts. Only that case initializes and performs; selection remains fixed until the voice ends. Different notes, including repetitions of the same note, have independent voices.

1. Add If or Switch. New blocks produce stereo audio. If compares two init-rate inputs using `==`, `!=`, `<`, `<=`, `>` or `>=`. Switch compares its init-rate selector with unique numeric case values. For drums, connect `notnum.inote` to `selector`. Input connections and the existing arithmetic Input Formula Assistant take precedence over literal values in **Configure branches**.
2. Expand the cases on the canvas and drag opcodes from the catalog into a case. A valid drop into **Silence** changes it to **Synthesis** and exposes its result inputs. Ordinary canvas drops create main-graph nodes. Dropping onto a collapsed block expands it; drop again into a specific case.
3. Connect each synthesis case to its managed **Case Result** audio inputs. Several sources can sum at an input, or use an input formula. Connect the block's common output to shared processing or a named Stereo Output. Every non-silent case needs a value for every result channel, even if that case is rarely selected.
4. False and Default initially use **Silence**. Silence assigns zero to every output and contains no synthesis nodes. Changing an existing case to Silence previews the nodes, connections and formulas that will be removed. Switch cases can be renamed, reordered, added and deleted; Default remains last and cannot be deleted. If keeps its two ordered True/False cases.
5. Collapse to see the condition, case summary, shared inputs and common output. Node IDs, selection, positions and the viewport survive collapse, save and reload. Captured input formulas are retained; expand to edit them. Format changes show an impact preview: mono preserves `left` and removes `right` wiring only after confirmation; switching back to stereo leaves `right` unconnected. Block/case deletion removes owned content and associated formulas and configuration together.

### Arrange and transfer nodes

The block stays above and left-aligned with the first case, with room for its complete body and buttons. Case frames measure every visible parameter row at any zoom. They automatically grow to the right and bottom and retain their size when nodes move inward, are removed, or become smaller; **Case Result** stays in a separate row at the bottom-right. Later cases move down or up without changing their internal arrangement.

Drag the **Case Result title or unused body** to resize a branch in both dimensions, including shrinking it. This also works for the Silence marker. The pointer displacement sets the requested size; complete node bounds, padding and the reserved result row limit how small it can become. Other selected nodes stay still and selection is preserved. Sockets, formula editing and help buttons keep their usual actions. Release commits the size and managed positions together; **Escape**, cancellation or focus loss restores the full prior layout. Ordinary dragging retains the largest frame size reached during the gesture. Bright purple borders stay about two screen pixels wide at every zoom. Sizes survive collapse, block movement, reordering, save/reload, copies and export/import.

- Drag main-graph nodes into an expanded case to transfer them. Dragging existing case members normally only rearranges them within that case. Their top and left movement limits keep them clear of the header; selected groups keep their relative spacing. Moving the block moves all contents together.
- Hold **Alt/Option before starting the drag** to transfer case members to another case or the main graph. Keep the desired group selected. **Move selected nodes** in Configure branches is the alternative, with identical validation.
- A transfer requires every connection and formula binding touching a moved node to end at another moved node or a node already in the destination scope. A cyan border marks an allowed target; a red border and diagnostic list refused connections and unselected endpoints. Nothing is automatically selected, disconnected or deleted. An isolated ordinary node can always transfer.
- This restriction applies to **membership transfers**. Existing shared main-graph inputs remain valid; you can deliberately connect them after placing the nodes. Case-local values still leave through Case Result only. Main-graph-only constructs, nested blocks and independent Case Result transfers are refused.
- Release to commit positions and membership together. A refused drop, **Escape**, pointer cancellation or loss of focus restores the entire group and clears highlighting. A refused drop leaves Silence unchanged.

### Play the Drumset template

Choose **New from template → Drumset** for 17 analog percussion voices: **35/36** kicks, **37** side stick, **38** snare, **39** clap, **40** electric snare, **41/43/45/47/48/50** toms, **42/46** closed/open hi-hat, **49** crash, **51** ride and **54** tambourine. Other notes select Default Silence. Velocity scales finite envelopes; branch-local `xtratim` preserves tails after short note-offs. Shared BD snappiness, shared hi-hat tuning and snare tuning default to **1**, preserving the previous sounds. Each added voice has one characteristic control. Save, assign a MIDI channel in Perform and route Stereo Output through the mixer. Controls affect newly started notes.

Processing after the block runs **once per voice**. Put effects in the performance mixer when they should process the **sum of the whole kit**. For velocity-dependent timbre, feed `ampmidi` into an If selector and place the alternative sounds in its cases.

Continuous switching, nested blocks, numeric results, raw jumps, crossfades, MIDI learn, ranges and choke groups are outside this release. Keep `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` and `midi_legato` in the main graph. GEN nodes and duration controls may belong to cases. Cycles and illegal scope crossings are compile errors, and all cases are validated.

## Saving and sharing

Save the instrument to retain its branches, case sizes and formulas. Native export/import and performance exports preserve the selected synthesis behavior. For programmatic authoring, see the [control-flow technical reference](../../specifications/manual-reference/control_flow.md).

**Navigation:** [Up](instrument_design.md) | [Previous](gen_table_editor.md) | [Next](midi_legato.md)
