# Performance Import / Export

**Navigation:** [Up](performance.md) | [Previous](live_status_and_safety_controls.md) | [Next](../supplied/supplied.md)

<a id="performance-export-export"></a>

<a id="what-gets-exported"></a>

<a id="offline-render-export-export-csd-midi--export-csd-score"></a>

<a id="performance-import-import"></a>

<a id="1-full-orchestron-performance-export-recommended"></a>

<a id="2-raw-sequencer-snapshot-json"></a>

<a id="import-options-dialog-performance-bundle"></a>

<a id="conflict-resolution-dialog"></a>

<a id="for-patches"></a>

<a id="for-performance"></a>

<a id="patch-id-remapping-during-performance-import"></a>

<a id="import-validation-resolvable-instruments-required"></a>

<a id="related-workflows"></a>

<a id="mixer-snapshot"></a>

<a id="performance-controller-settings-version-12"></a>

<a id="midi-controller-channel-selections-version-13"></a>

<a id="internal-master-version-14"></a>

<a id="saved-patterns-and-arrangement"></a>

<a id="performance-controller-midi-assignments"></a>

<a id="clip-transposition"></a>

Use **Export** for an editable backup or to share a complete performance. Use **Export CSD (MIDI)** or **Export CSD (SCORE)** to render a song outside Orchestron with Csound.

## Choose an export

| Action | Use it for | Result |
| --- | --- | --- |
| Export | Backup, sharing or later editing in Orchestron | A native `.orch.json` or `.orch.zip` bundle |
| Export CSD (MIDI) | Offline rendering with a separate MIDI score | A ZIP containing CSD, MIDI, assets and rendering instructions |
| Export CSD (SCORE) | Offline rendering with notes and controllers in the Csound score | A ZIP containing CSD, assets, rendering instructions and any warnings |

Save open musical and structural drafts before exporting. Temporary auditions are not authored content. Exporting does not replace **Save Performance** in your library.

## Native performance export

Choose **Export** on the Perform page. The bundle preserves the whole rack, instrument definitions, routes, Master and inserts, mixer settings, device names and channels, saved patterns, arrangement, transposition, instrument settings and MIDI mappings. Arranger Undo/Redo history is also retained when compatible.

When instruments use uploaded audio samples, SoundFonts or analysis files, Orchestron creates a ZIP containing the required assets. Otherwise it can use JSON. Keep the downloaded bundle intact for importing on another machine.

## Import a performance

1. Choose **Import** and select an Orchestron performance bundle.
2. In the import options, choose whether to import the performance, its patch definitions, or both. Import both for a self-contained transfer.
3. Resolve any existing names in the conflict dialog.
4. Check the rack and routing, then play and save the imported performance.

![Choose the performance and patch definitions to import](../../screenshots/perform_import_options_dialog.png)

For patch-name conflicts, choose overwrite, rename or skip. For the performance itself, choose overwrite or rename; to omit the performance, change the import options instead. Skipping patch definitions requires suitable instruments to exist in the destination library. Import validation reports unresolved instrument assignments.

![Resolve existing patch and performance names](../../screenshots/perform_import_conflict_dialog.png)

## Render with Csound

1. Finish the arrangement and set a finite song end. Disable looping for the offline export.
2. Choose **Export CSD (MIDI)** or **Export CSD (SCORE)**.
3. If SCORE export asks for controller accuracy, choose a maximum deviation and continue.
4. Extract the ZIP. Open the included `README.txt` and run its Csound command from the extracted directory.
5. Read `WARNINGS.txt` when present before relying on the rendered result.

The packages render at **48 kHz**, `ksmps=1`, with **32-bit float WAV** output and effect release tails. Keep those settings when you need the documented timing and controller accuracy. Floating-point output retains headroom; check levels before converting to an integer audio format.

Both modes include instrument instance settings and seed enabled manual MIDI controller values on their selected channels. Live keyboard gestures are not recordings and are not added to the exported arrangement.

## Controller accuracy

SCORE export preserves eligible original controller curves. Where a curve needs approximation, **Maximum deviation** accepts **1–10 CC units**, default **1**, on the 0–127 MIDI scale. A larger allowance can reduce data at the cost of accuracy. Changing the allowance may have no effect when original curves can be used directly. Step patterns and abrupt resets retain their events.

![CSD export accuracy dialog](../../screenshots/csd_export_accuracy.png)

Any actual curve approximation is described in the exported warnings. MIDI export retains the captured MIDI events.

## Which instruments are rendered

Native bundles retain the complete rack. Offline CSD exports select note instruments assigned to devices and continuous instruments used by routes, Master or inserts. Assigned devices count even when stopped or empty. Continuous generators with direct output are included; unused rack instances and their exclusive assets are omitted.

Bypassed inserts pass their inputs onward without processing. Their exclusive assets are omitted from the CSD package, while native bundles preserve them for later use. Direct output paths retain their documented Master bypass behavior.

## Assets and export limits

Upload or import samples, SoundFonts and analysis files through Orchestron. Raw backend filesystem paths cannot be used as substitutes for bundled assets.

Offline exports must be finite. The range and its absolute end are limited to 65,536 transport steps, with at most 16 notes on one step and an event budget of 200,000. If an export exceeds a limit, shorten or simplify the exported arrangement. Large bundles may also reach the server's configured size limit.

## Compatibility and recovery

Use a current Orchestron version to open performances using newer features. Older supported performances retain their music when imported; missing newer settings receive defaults. Review routing and the internal Master when opening older files. Incompatible arranger history may be discarded with a notice while the performance remains usable.

A raw sequencer snapshot is also accepted for legacy workflows, but it is not a self-contained instrument bundle. Prefer native exports for backups and transfer.

See [saving and workspace recovery](../configuration/persistence_and_defaults.md), [instrument import/export](../instrument_design/instrument_import_export.md), or the [optional authoring tools](../appendix/performance_creator_skill.md). Developers can consult the [export technical reference](../../specifications/manual-reference/performance_import_export.md).

**Navigation:** [Up](performance.md) | [Previous](live_status_and_safety_controls.md) | [Next](../supplied/supplied.md)
