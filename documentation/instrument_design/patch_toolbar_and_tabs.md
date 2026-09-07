# Patch Toolbar and Instrument Tabs

**Navigation:** [Up](instrument_design.md) | [Prev](instrument_design.md) | [Next](opcode_catalog_and_documentation.md)

The patch toolbar is the main control surface for patch metadata, patch library operations, and instrument-level file actions.

## Patch Toolbar Layout

The toolbar includes:

- Instrument tabs (multiple editable patch workspaces)
- Patch metadata fields (`Patch Name`, `Description`)
- Patch picker (`Load Patch`)
- Action buttons (`New`, `Clone`, `Delete`, `Save`, `Compile`, `Export`, `Import`, `Export CSD`)

## Instrument Tabs

- Use the `+` button to add a new instrument tab.
- Each tab stores its own editable patch snapshot (graph + metadata).
- Tabs can be switched without losing the current edit state.
- Tabs can be closed with the `x` button.
- Tabs are persisted in app state (see Configuration chapter), so drafts can be restored after reload.

## Patch Metadata

- `Patch Name` is the display name used in the patch library and performance rack dropdowns for normal patches.
- `Description` is a three-line patch note field and accepts up to 2048 characters.
- `Template?` marks the patch as a reusable starter graph. Template patches show a `TEMPLATE` token beside their name and are excluded from Perform rack instrument choices.
- `Activation: MIDI notes / Continuous` controls scheduling. Continuous patches run when added to the Perform rack and started. They may generate audio without an inlet. Receiving audio requires an actual inlet, independently of activation. Musical role is separate interface metadata.
- Metadata updates affect the current tab immediately, but they are not stored in the patch library until you save.

## Patch Library Loading

- `Load Patch` loads an existing saved patch from the backend patch library into the active tab.
- The dropdown shows saved patch names, including template patches marked with `TEMPLATE`.
- Loading a patch replaces the active tab contents with that saved patch snapshot.

## Actions

### New

- Opens the built-in creation chooser: Playable instrument, Audio effect, Output / Master processor, or Empty patch.
- Creates an unsaved draft with the selected starter graph and default engine settings.
- This draft is not yet stored in the patch library until `Save` is used.

### New from Template

- Opens the same chooser with the four built-in starters plus any saved templates.
- Creates a new unsaved normal patch with the chosen template's graph and description.
- Built-in choices remain available when the library has no saved templates.

### Clone

- Creates a new saved patch by duplicating the current patch graph and metadata.
- Preserves the `Template?` and `Activation` flags from the source patch.
- If the name already exists, Orchestron generates a `(... copy)` style name.
- The cloned patch is loaded automatically after creation.

### Delete

- Deletes the currently saved patch from the patch library.
- Requires confirmation.
- After delete, Orchestron loads another available patch or creates a new draft if none remain.

### Compile

- Compiles the current instrument graph into generated Csound ORC/CSD artifacts.
- Updates compile status badge state.
- Does not save the patch or start audio automatically. Use [Audition](runtime_panel_and_compilation.md#audition-a-draft) in the graph header to hear an unsaved draft.

### Save

- Performs compile validation first for normal patches.
- If compile succeeds, persists the patch to the backend patch library.
- If compile fails, save is blocked and the patch remains unsaved.
- Template patches skip compile validation so incomplete starter graphs can be saved.
- Always-on patches still save as normal patch definitions; they run continuously only after they are added to a started Perform rack. A continuous source need not be an effect or have audio inlets.

### Export / Import

- `Export` writes an Orchestron instrument definition bundle (`.orch.instrument.json` or `.orch.instrument.zip`).
- `Import` loads an instrument definition bundle and supports conflict handling (overwrite / rename / skip).
- Details are in [Instrument Import / Export and CSD Export](instrument_import_export.md).

### Export CSD

- Triggers compile and downloads the compiled `.csd` file.
- Useful for running the generated instrument outside Orchestron.

## Practical Notes

- `Compile` is the fast iteration action while designing.
- `Save` is the persistence action for the patch library.
- `Export` is the sharing/transfer action for Orchestron-specific instrument bundles.
- `Export CSD` is the interoperability action for raw Csound usage.
- The integrated `?` help for this toolbar now focuses on tab-local draft state versus saved library state, plus the difference between `Compile`, `Save`, `Clone`, and export actions.

## Built-in creation choices

New and New from template offer Playable instrument (MIDI pitch/velocity, sine oscillator and madsr), Audio effect (stereo pass-through), Output / Master processor (stereo input to direct output), and Empty patch. These choices work without saved templates. Guided instruments connect to an ordinary neutral Master when added to a performance.

### Choose a starter

| Choice | Activation and audio interface | Next step |
| --- | --- | --- |
| Playable instrument | MIDI notes; named stereo output; pitch, velocity, sine oscillator and envelope | Save, add to Perform, and play its MIDI channel. |
| Audio effect | Continuous; named stereo input and output, initially pass-through | Add processing between the input and output before using it as an effect. |
| Output / Master processor | Continuous; stereo input to Direct Audio Output (`outs`) | Save for use as a Master/output processor. |
| Empty patch | Empty graph for custom design | Build and compile the required signal path. |

Role describes the patch's audio interface; Activation determines when it runs. Naming a patch “Master” alone does not select it as the performance's Master. Use the Mixer Master selector or Create neutral Master.

<p align="center">
  <img src="../../screenshots/instrument_builtin_patch_chooser.png" alt="Built-in patch creation chooser" width="600" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>New opens the starter chooser even when no saved templates exist.</em></p>

## Screenshots

<p align="center">
  <img src="../../screenshots/instrument_patch_toolbar_tabs_actions.png" alt="Patch toolbar and instrument tabs" width="900" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Patch toolbar with a continuous stereo-effect draft, Activation selection and library actions.</em></p>

**Navigation:** [Up](instrument_design.md) | [Prev](instrument_design.md) | [Next](opcode_catalog_and_documentation.md)
