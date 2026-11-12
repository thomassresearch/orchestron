# Saving, Workspace Recovery and Defaults

**Navigation:** [Up](configuration.md) | [Previous](browser_clock_latency.md) | [Next](../appendix/appendix.md)

<a id="persistence-and-defaults"></a>

<a id="two-persistence-layers-important"></a>

<a id="1-library-data-explicit-save"></a>

<a id="2-app-state-snapshot-automatic"></a>

<a id="what-this-means-in-practice"></a>

<a id="default-new-patch-values"></a>

<a id="saved-mixes-and-older-performances"></a>

<a id="compile-status-vs-persistence"></a>

<a id="runtime-defaults"></a>

<a id="recommended-habits"></a>

Save library entries to keep and share your work. Workspace recovery helps you resume editing after a reload, but it does not replace saving an instrument or performance.

## Two kinds of saved state

| Action | What it keeps |
| --- | --- |
| Save in Instrument Design | The named instrument graph and its settings in the library |
| Save Performance | The rack, routes, mixer, instance settings and authored musical content |
| Automatic workspace recovery | Working context such as open instrument tabs, selected view, language and browser-clock preferences |
| Native Export | A portable editable instrument or performance bundle |

## Before leaving a session

1. Save instrument changes you want to keep in the library.
2. Save or discard open pattern and structure drafts, with the intended linked/local editing scope.
3. Save the performance.
4. Export important work as a native bundle for a separate backup.

Recovered instrument tabs can contain unsaved graph edits. Musical and structural drafts are session-only: resolve them before reloading.

## What stays temporary

Selections, zoom, scroll and drafts survive view switches and panel collapse. New, Load and Import reset this temporary context. Auditions and arranger lane Mute/Solo are not saved music.

## Compile and save

Compile checks a graph without saving it. Normal Save compiles first; templates may remain incomplete and are excluded from Perform. See [Patch Toolbar and Instrument Tabs](../instrument_design/patch_toolbar_and_tabs.md).

## New instrument defaults

New opens the starter chooser; Empty patch supplies a blank graph. Defaults are 48 kHz audio, a target control rate of 1,500 Hz and a 32-sample synthesis block. See [Audio Engine Settings](audio_engine_settings.md) before changing them.

Internal MIDI works without a keyboard. Select external MIDI explicitly when needed.

## Older performances and large saves

Supported older files receive defaults for settings they did not contain. Review the mixer and Master routes after import, then save a fresh native backup. Keep the original file until you have checked playback.

If a save or import reports a size limit, retain your current draft, reduce unnecessary material or assets, and try again. Server limits protect storage; a failed save is not confirmation that your library has been updated.

For technical storage and migration details, see the [persistence reference](../../specifications/manual-reference/persistence_and_defaults.md).

**Navigation:** [Up](configuration.md) | [Previous](browser_clock_latency.md) | [Next](../appendix/appendix.md)
