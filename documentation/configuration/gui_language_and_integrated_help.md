# GUI Language and Integrated Help

**Navigation:** [Up](configuration.md) | [Previous](configuration.md) | [Next](audio_engine_settings.md)

Orchestron includes multilingual UI labels and integrated documentation so you can stay inside the app while learning and working.

## GUI Language Selector

Use the circuit board for **Instrument Design** and the beamed notes for **Perform**. The gear opens **Audio settings**. The adjacent menu shows the current language. Open it and choose your language by name.

Supported languages:

- Deutsch
- English
- Español
- Français

![Orchestron header with the language selector and the two workspaces and Audio settings](../../screenshots/workspace-header.png)

## What Changes When You Switch Language

Language switching affects user-facing text such as:

- Page labels (`Instrument Design`, `Perform`, `Audio settings`)
- Toolbar/button labels
- Context help pages (integrated help modals)
- Opcode documentation modal content (localized generated markdown)
- Many labels inside advanced editors (including the GEN editor)

<p align="center">
  <img src="../../screenshots/integrated_help_pages_multilingual.png" alt="Integrated help pages in multiple languages" width="980" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Integrated help and UI localization in multiple supported languages.</em></p>

## Integrated Help (`?` Buttons)

Orchestron provides context help buttons (`?`) across the UI.

Examples include:

- Instrument patch toolbar
- Opcode catalog
- Graph editor header/area
- Runtime panel
- Sequencer sections (rack, Mixer, tracks, Score Sequencers, both multitrack arrangers, piano rolls, MIDI controllers)
- Audio settings sections

Choose **?** to open help for the current tool. Keyboard focus moves into the dialog. Press Escape or choose **Close** to return to the help button. In Perform, open **Keyboard** and choose the **?** beside the keyboard name for help with scales, MIDI channels and Autochord.

![Keyboard help button beside the piano roll name in Perform](../../screenshots/perform-keyboard-help.png)

Mixer help covers levels, routing, sends, inserts, bypass and feedback diagnostics. Its button remains available while collapsed. The new Multitrack Arranger opens clip-specific guidance for fixed windows, reusable content, drafts, save scopes and playback; pad-based performances retain their compatibility-arranger help. Both use the same localized dialog as the rack, live keyboard and live MIDI controllers.

The Score Sequencer uses this same top-right button in its panel and clip pattern
editor, including while collapsed. Its help explains keyboard auditioning,
double-click quarter-note insertion, drawing, editing and playback in all four
GUI languages.

On the Instrument Design, Perform, and Audio settings pages, these help modals focus on the current tool, device, transport section, or engine setting panel instead of repeating generic UI conventions.

![Mixer and clip arranger help buttons](../../screenshots/performance-help-buttons.png)

<p align="center">
  <img src="../../screenshots/integrated_help_pages.png" alt="Integrated help pages" width="980" style="max-width: 100%; height: auto;" />
</p>
<p align="center"><em>Context help modal integrated into the workflow.</em></p>

## Opcode Documentation (`?` On Opcode Node)

Placed opcode nodes provide a node-level `?` button that opens opcode documentation.

The modal includes:

- Localized description
- Inputs and outputs (with detailed port descriptions)
- Syntax/template summary
- Tags
- `Open Csound Reference` link to the official Csound documentation page for that opcode

## Modal Behavior

Both help modals and opcode documentation modals support:

- Close button
- Click outside modal to close
- `Esc` key to close

## Best Practice

Use context help for workflow guidance and opcode docs for technical/operator details.

This combination is faster than switching repeatedly between the app and external documentation while designing patches.

**Navigation:** [Up](configuration.md) | [Previous](configuration.md) | [Next](audio_engine_settings.md)
