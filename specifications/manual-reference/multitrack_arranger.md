# Multitrack Arranger — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

The [Performance Creator skill](../../integrations/skills/orchestron-performance-creator/SKILL.md)
can author the same clip model through `orchestron_cli`. Start with
`edit begin --new --arranger clips`, then apply a versioned song document with
`edit apply-song --file PATH`. Definitions are shared across clip repetitions;
pitch-only changes use transposition plans. Inspect returned occurrence targets
before scoped musical/structural edits, use dry runs and undo, validate online,
then commit. The CLI protects saved revisions and preserves unused definitions,
hidden notes and trailing silence. It does not see unsaved GUI editor drafts.
See the [command cookbook](../../integrations/skills/orchestron-performance-creator/references/song_workflow.md)
for automation, audition and exports.

Transposition performances require a version-25-capable reader (app-state version 7, clip model version 3). Native bundles, CLI runtime projection and MIDI/SCORE CSD exports preserve the saved settings. Unsaved transpose drafts and temporary audition state are not exported. Older identity-only clip performances retain their existing format until transposition is saved.
