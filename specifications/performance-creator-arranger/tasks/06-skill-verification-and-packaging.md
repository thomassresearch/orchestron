# Task 06 — Skill workflow, end-to-end verification and plugin packaging

Status: implemented. Evidence: [implementation record](../implementation-record.md). Stage: all stages / final delivery. Depends on: Tasks [01](01-contracts-inspection-validation.md), [02](02-authoring-and-migration.md), [03](03-song-specifications-and-transposition.md), [04](04-instrument-automation.md) and [05](05-editing-history-and-audition.md) for completion. Exit gate: **G6**. Maintain documentation alongside each task; final release evidence belongs here.

## Result

The shipped Performance Creator teaches and executes the complete clip-based workflow from an extracted plugin. Its examples, schemas, output and package contents agree with the app, and the implementation record contains reproducible evidence for every required gate.

Primary sources: [skill](../../../integrations/skills/orchestron-performance-creator/SKILL.md), [references](../../../integrations/skills/orchestron-performance-creator/references), [integration guide](../../../integrations/README.md), [manifest](../../../integrations/plugin.json), [builder](../../../integrations/build_plugin.py), [package tests](../../../integrations/tests/test_plugin_package.py) and [project metadata](../../../integrations/skills/orchestron-performance-creator/pyproject.toml).

## Work — skill and user documentation

1. Rewrite the main workflow around capabilities, musical brief/device choice, instrument binding, a small named definition library, clip/section placement, scoped transposition, owned automation, inspection, validation, commit and audition. Make new-song clip mode explicit. Retain useful composition guidance, user instrument choices and exact Composition Creator handoffs.
2. Teach when to reuse, transpose or fork: loop references for repetition; placement plans for pitch-only changes; independent definitions for intentional musical variations. Remove eight-pad budgeting from the clip path while retaining labeled legacy reference material. Explain that groups are lane-local and song sections coordinate lanes.
3. Add focused references for the song schema, timing/units, object discovery, clip/section operations, edit scopes, repetition indexing, transposition, automation mappings/curves, transactions/history and response/error interpretation. Update existing score, composition workflow, rhythm/layering, performance-controller, timing, ratchet, strum and Score Sequencer references where their assumptions changed.
4. Supply executable minimal and complete examples plus a compact task-oriented command cookbook. Demonstrate a new song, a chorus transposition without pattern duplication, a local fill, one long automation sweep, collision recovery, a retry/no-op and a saved-song revision. Examples must use discovered IDs or reproducible synthetic fixtures, not personal patch UUIDs.
5. Preserve progressive disclosure: the main skill teaches the workflow and points to narrow references; detailed schemas and advanced editing stay in references. An agent must not need app source or raw persisted JSON to complete the supported workflow. Explicitly distinguish staged, saved and audible state.
6. Update the integration guide, relevant English performance/import-export/manual pages and README capability text once implementation exists. Preserve the README's protected opening and Built With Codex section. Use the documentation-PDF skill when manual sources/PDF change and visually verify affected pages. UI layout/interaction changes, if any, require current screenshots and consistent EN/DE/FR/ES labels/help; do not translate the English manual.

## Work — packaging and installed behavior

7. Bump the plugin manifest from baseline 0.1.4 to a new unused release version after checking current repository state. Version the Performance Creator Python project independently and refresh its committed lockfile when project metadata/dependencies require it. Record all resulting versions; do not equate them with musical format versions.
8. Verify the builder includes every new portable domain module, CLI entry point, schema and required reference/sample asset. Current runtime inclusion covers `src`, `scripts`, `references`, `assets` and agent metadata; tests/examples/caches are excluded. Put shipped examples/schemas in an included location or deliberately extend the builder and its tests. Never add a runtime dependency on excluded test fixtures, repository `examples/`, backend code or development files.
9. Extend package tests to assert required Performance Creator modules and schema/reference links, all four skills, plugin branding/licenses and exclusion of environments, caches, test data, local sessions and generated outputs. Retain symlink rejection, normalized timestamps/permissions, deterministic same-toolchain rebuilds and replacement of stale archive contents.
10. Build with `make -C integrations test` and `make -C integrations`. Record archive path, bytes, SHA-256, manifest/project versions and source revision. Rebuild the same sources/toolchain and compare hashes. Do not claim reproducibility across different zlib/toolchains without testing it.
11. Extract the ZIP into a fresh temporary location, change to a separate music working directory and clear repository-specific `PYTHONPATH`/environment assumptions. Run the console entry point and thin script wrapper through the extracted project's locked environment. The backend server, when needed, is separate and accessed only by HTTP; the client must not import it.
12. Exercise offline help/schema/capability/local inspection plus a complete create→apply-song→inspect→validate→commit→reload→edit→audition sequence against an isolated fixture backend. Supply the smoke-test fixture outside the archive. Cover basic clips, long automation, scoped transposition and v26 fixed references. Compare semantic results with the repository implementation.
13. Verify all sessions, specifications and generated media remain outside the installed plugin. A read-only extracted skill tree with dependencies/environment located externally must still work. Resolve references relative to the installed skill location, including sibling Composition Creator references; report optional separately installed dependencies clearly.
14. Document installation verification and stale-copy detection using capabilities/version output. Build outputs remain local artifacts; this task does not automatically patch plugin caches, remove standalone installations, upload, publish or install the plugin. If installation is separately performed, verify the active installed copy before claiming it is updated.

## Regression and integrated acceptance

- Run all Performance Creator tests and relevant Composition Creator handoff tests. Preserve legacy command results and v1/v2 inputs alongside new clip commands.
- Run backend service/API suites and lint; include `backend/tests/test_api.py` for changed validation, persistence or live mapping behavior. Run full frontend checks for serialization/import/history and shared-fixture parity.
- Use versioned synthetic fixtures for CLI→backend→GUI→save/load/autosave/native→CLI round trips. Check exact definitions, sharing, history/cursor, hidden content, rack types/names, routes/Master/mixer, instance values/mappings and song boundaries.
- Compare representative live captured events with both CSD modes and exercise actual browser-clock/Csound playback, scoped audition, failure recovery and pending application. If shared runtime code changes, rebuild and verify both Python and Cython execution paths using repository procedures.
- Execute the plan's 128-bar efficiency fixture and a larger compact-loop variant. Record definition/reference counts, no-op retries, response bounds, serialized sizes and authoring/projection timings. Do not add arbitrary test-time limit increases to pass dense fixtures.
- Run a skill-only agent acceptance script: from a musical brief and available patch discovery, create the fixture song, move a section, transpose a later occurrence, add one local fill, generate/edit automation, recover from an overlap error and save. Use supported CLI responses as the source for IDs and next steps. Record command count, unexpected manual repairs and any raw-config/source-reading workaround; such workarounds fail A24.
- Run extracted-package smoke tests for all other packaged skill entry points with their own dependencies, while keeping their behavior and asset requirements intact. A ZIP member listing alone is insufficient verification.
- Validate local Markdown targets/anchors, all packaged reference links, documented command examples and `git diff --check`.

## Acceptance criteria — G6

- Every row A01–A24 in the [acceptance matrix](../implementation-plan.md#5-cross-task-regression-and-acceptance-matrix) has recorded, current evidence, and G1–G5 are complete.
- The main skill and references describe actual implemented commands and current format support; no unsupported pad-only guidance remains in the new workflow.
- The extracted package completes the representative song and follow-up edits without repository imports, raw-config editing or duplicate musical definitions.
- Repository and packaged execution agree on authored results and runtime schedules; all four skills and required licenses/assets are present.
- Runtime, API, frontend, CLI, documentation and packaging checks pass or are explicitly recorded as outstanding. Required outstanding checks prevent claiming this gate complete.
- The implementation record identifies the tested archive and source, measured efficiency, known remaining broader arranger limitations and whether installation/publication was performed separately.

## Boundary

This delivery does not enable the app's broader arranger rollout or promise a lossless downgrade to older readers. Preserve recoverable originals and compatible readers. No example/instrument changes are expected; if that scope changes, apply the additional frontend/Docker build-input rules before completion.
