# Audio Mixer And Routing — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

## Control API

Session creation and validation accept `audio_graph` and `mixer`. `GET /api/sessions/{id}/mixer` returns desired values and revision; `PUT` accepts batched partial scalar updates and an optional expected revision. Stale revisions return 409. The active browser-clock controller can send the equivalent `mixer_update` message and receive `mixer_ack`/`mixer_error` replies. Updates are queued and applied at render-block boundaries. Meter frames carry engine sample timestamps and are delivered at most 15 times per second.

Feedback failures return HTTP 422 with the existing `detail.diagnostics` string list plus `detail.audioDiagnostics`. Each structured feedback diagnostic contains `code: "feedback"`, all cyclic `routeIds` and `instanceIds`, and an ordered `routingPath`. Each path step contains `kind`, its grouped `routeIds`, and `source`/`target` endpoints with `id`, `name`, `midiChannel` (0 for continuous), `stage`, `ports`, and optional `insertOwnerId`. Stereo routes with the same endpoints, stages and kind are grouped. General validation errors keep the existing response format. Legacy routes receive generated diagnostic IDs; explicit mixer routes retain their authored IDs.

`POST /api/sessions/preview` accepts a session plus inline draft patch definitions. It creates a transient runtime without saving drafts into the patch library. Normal stop/delete session operations clean it up.

## Persistence and compatibility

Current performance saves use configuration version 20 and read versions 1–20. Optional per-strip `bypass` defaults to false for older saves. They retain the internal Master introduced in version 14, with stable instance IDs, explicit routes, mixer strips, sends and insert ownership. App state version 3 reads versions 1–3 and saves this same model. Save/Load, Clone and native JSON/ZIP bundles preserve the current settings. Mixer automation recording is not included.

Versions 1–10 convert old Level values using `20 * log10(level / 10)`, including continuous effects. Missing Level means 0 dB. Legacy inlet selection is resolved once and saved explicitly. Level no longer scales MIDI velocity; velocity-sensitive patches can therefore change timbre after migration. Authored note velocities remain unchanged.

Both performance CSD modes initialize the same routing, gain, balance, mute, solo and send settings without a browser. Offline rendering retains 48 kHz, `ksmps=1`, float WAV output and release tails. Live/offline settings match; different engine rates need not produce identical waveforms. A routed continuous source can render a finite range with no MIDI notes. Standalone instrument exports contain patch design and interface metadata, without Perform mixer settings.

## Upgrading existing Masters

On backend startup, the SQLite library is migrated before it is served. The migration creates a sibling `.before-internal-master-<timestamp>.bak` database backup before changing data. Repeated starts make no further changes after migration.

Known neutral Master graphs are replaced by the internal output while preserving each performance's routes, gain, balance, mute and inserts. Customized Masters retain their processing as ordinary rack instruments feeding the internal Master. Unreferenced neutral Master copies are removed from the library only after references in saved performances and app state have been migrated. Modified patches, edited drafts and patches still used elsewhere are retained.

A genuinely missing legacy patch stays visible for repair. While stopped, **Replace missing Master with internal output** transfers compatible stereo connections and saved Master controls; save the performance afterward. Unknown port mappings must first be repaired in the routing matrix.

To preview the migration manually with the backend stopped, run `uv run python -m backend.tools.migrate_internal_master --database backend/data/visualcsound.db`. Add `--apply` to create a backup and apply it. Use the actual database path for Docker or custom installations. To roll back, stop the backend and restore the backup together with the previous application version.
