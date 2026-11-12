# Instrument Import Export — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

## Advanced Format Notes (for power users)

- Type metadata is exported as `instrumentType`; imports also accept `instrument_type`. Supported values are `percussion`, `melody`, `bass`, `effects_noise`, and `continuous`. An explicit type determines activation even if an older `alwaysOn` / `always_on` flag conflicts. Existing graph schema and bundle version numbers are unchanged.
- Instrument ZIP exports contain exactly one root JSON file plus optional `audio/...` entries
- Missing referenced audio assets in a ZIP import cause import failure (prevents broken GEN01 references)
- Default import limits are 256 MiB compressed request body, 8 MiB root JSON, 512 ZIP entries, and 256 MiB total uncompressed ZIP content
- Deployments can tune these with `VISUALCSOUND_BUNDLE_IMPORT_MAX_BYTES`, `VISUALCSOUND_BUNDLE_IMPORT_JSON_MAX_BYTES`, `VISUALCSOUND_BUNDLE_IMPORT_ZIP_MAX_MEMBERS`, and `VISUALCSOUND_BUNDLE_IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES`
- Individual imported audio/SoundFont/analysis assets are still limited by `VISUALCSOUND_GEN_AUDIO_ASSET_MAX_BYTES`
