# Instrument Design

**Navigation:** [Up](../user_documentation.md) | [Prev](../user_documentation.md) | [Next](patch_toolbar_and_tabs.md)

This chapter covers the complete **Instrument Design** workflow on the `Instrument Design` page.

## What You Can Do Here

- Build instruments visually from Csound opcodes using the graph editor.
- Maintain multiple instrument tabs (parallel drafts or different patches).
- Use localized integrated help and opcode-level documentation without leaving the app.
- Compile the current graph, inspect generated ORC, and test runtime behavior with MIDI input.
- Define advanced input-combine formulas when multiple signals feed the same input.
- Configure function tables with the `GEN` meta-opcode (including `GEN01` audio-file tables and `GENpadsynth`).
- Export instruments as Orchestron bundle files and as `.csd`.

## Chapter Contents

- [Patch Toolbar and Instrument Tabs](patch_toolbar_and_tabs.md)
- [Opcode Catalog and Integrated Documentation](opcode_catalog_and_documentation.md)
- [Graph Editor](graph_editor.md)
- [Input Formula Assistant](input_formula_assistant.md)
- [GEN Table Editor (GEN Meta-Opcode)](gen_table_editor.md)
- [Runtime Panel and Compilation Workflow](runtime_panel_and_compilation.md)
- [Instrument Import / Export and CSD Export](instrument_import_export.md)
- [Supported Opcodes](supported_opcodes.md)

## Recommended Workflow

1. Create or load a patch in the patch toolbar.
2. Add opcodes from the catalog (click or drag-and-drop).
3. Connect signals and set constant values.
4. If needed, define an Input Formula on a socket with multiple inputs.
5. Compile and inspect the runtime panel output.
6. Save the patch.
7. Export a `.csd` or an Orchestron instrument bundle.

## Important Behavior

- The compile status badge is per active instrument tab/patch snapshot (`compiled`, `pending changes`, `errors`).
- The runtime panel can be collapsed to give more graph space and reopened with the `Show runtime` button.
- Saving a patch performs compile validation first; a failing compile prevents a bad save.

## Screenshots

<p align="center">
  <img src="../../screenshots/instrument_design.png" alt="Instrument Design page overview" width="1100" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Instrument Design page overview with catalog, graph editor, and runtime panel.</em></p>

**Navigation:** [Up](../user_documentation.md) | [Prev](../user_documentation.md) | [Next](patch_toolbar_and_tabs.md)
