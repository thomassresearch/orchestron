# Sample Player implementation plan

Status: **implemented in this workspace; see the [verification record](implementation-record.md)**. Date: 2026-11-15.

This plan covers the first version defined by the [specification](specification.md): application code, fixtures, authoring compatibility, documentation, and verification. Use the [acceptance matrix](acceptance.md) as the release checklist and the [implementation record](implementation-record.md) for results.

## 1. Delivery strategy

Resolve sample lifetime and source cancellation before committing to the compiler structure. Then establish immutable assets and strict schemas, propagate them through persistence, and integrate the editor and exports. Do not expose a working-looking uploader before its assets can survive Save/Load and both export paths.

| Task | Deliverable | Dependencies | Exit gate |
| --- | --- | --- | --- |
| T1 | Baseline, fixtures, compiler/lifecycle proof, versions, measured budgets | None | G1: the risky audio path is demonstrated |
| T2 | WAV/MP3 ingestion and managed immutable sample assets | T1 | G2: validated, bounded, atomic assets |
| T3 | Authored/wire schemas, persistence, migrations, reachability | T1; T2 for media validation | G3: lossless ownership and recovery |
| T4 | Sample Player node, runtime preparation, one-shot voices and cancellation | T1–T3 | G4: complete realtime behavior |
| T5 | Native and MIDI/SCORE CSD packages | T2–T4 | G5: portable round trips and render parity |
| T6 | Rack editor, starter, preview, and localized help | T3–T4; T5 before completion | G6: usable end-to-end workflow |
| T7 | CLI/skill compatibility and contract documentation | T3–T6 | G7: no consumer drops sample data |
| T8 | Full regression, performance evidence, screenshots, manual and release record | T1–T7 | G8: all required acceptance evidence |

Dependencies describe work order, not a requirement for parallel agents. Routine implementation choices can be made within these contracts. If a feasibility gate reveals a necessary behavioral change, revise the specification and affected acceptance cases explicitly.

## 2. T1 Baseline and audio proof

### Work

1. Re-read [AGENTS.md](../../AGENTS.md), [BACKEND.md](../../BACKEND.md), [fixture rules](../../backend/tests/fixtures/README.md), and relevant current transport/export contracts. Record current repository revision and pre-existing changes.
2. Create an implementation record in this folder when coding begins. Record actual format versions; reserve provisional performance v27/app-state v9 only if still free. Inventory every reader/writer and feature-dependent version branch.
3. Inventory assignment reconstruction in [appStoreModel.ts](../../frontend/src/store/appStoreModel.ts), [session resolver](../../backend/app/services/session_instrument_resolver.py), [export models](../../backend/app/models/export.py), bundle remapping, app-state recovery, and CLI serialization. Identify constructors that would discard new fields.
4. Freeze small original synthetic WAV/MP3 fixtures and expected metadata under a new versioned sample-player fixture directory. Include mono/stereo, 44.1/48 kHz sources, two different samples for the same note, a long tail, corrupt media, and overlapping sources. Do not read developer examples or depend on temporary feasibility-probe files.
5. Reproduce basic lookup/render/relocation parity in a versioned test. Exercise native GEN01 numeric aliases and archive-local paths on the supported Csound builds.
6. Prototype a 20 ms input note driving a multi-second sample through the complete patch and mixer. Demonstrate natural termination even if the input key remains held. Select and document the concrete compiler mechanism: a generated trigger/finite-voice wrapper is the leading candidate. Any alternative must satisfy the same tests.
7. Prove that ordinary note-off does not cut the sample, while later lane cancellation after that note-off still does. Use two sources sharing instance, channel, and pitch; cancel one and preserve the other. Inspect [MIDI scheduler](../../backend/app/engine/midi_scheduler.py), [lane gate](../../backend/app/engine/lane_output.py), [worker](../../backend/app/engine/csound_worker.py), and [arpeggiator router](../../backend/app/services/arpeggiator_runtime.py).
8. Trace every source-release caller and classify its reason. Distinguish normal note/pad completion from explicit Stop/seek/removal/preview teardown. Define typed attack and forced-cancel metadata, deterministic voice tokens, and cleanup ownership. Do not rely on a MIDI note-off bit pattern to encode the distinction.
9. Establish deterministic MIDI-export attack identities and any auxiliary score/control commands needed for source cancellation. Validate equal-time attack/cancel ordering before wider export work.
10. Measure decode time, table memory, voice count behavior, startup preparation, and render cost. Qualify or revise the proposed budgets in specification section 8. Include actual Csound sample width and renderer replication.

### G1 evidence

- A reproducible versioned audio test covering short-gate one-shots, full-path processing, overlap, selective cancellation after ordinary release, and natural cleanup.
- A written compiler/lifecycle decision and all affected runtime boundaries.
- A field-preservation/version inventory and resource-budget baseline.
- No assumption that the earlier standalone lookup probe already proves one-shot or application behavior.

If the chosen compiler path cannot meet G1, continue the bounded technical investigation before building the editor. G1 is an engineering prerequisite, not an additional user-approval flow.

## 3. T2 Managed sample ingestion

### Source seams

Extend [asset API](../../backend/app/api/assets.py), [asset models](../../backend/app/models/assets.py), [GenAssetService](../../backend/app/services/gen_asset_service.py), [settings](../../backend/app/core/config.py), and [Dockerfile](../../Dockerfile). Add focused sample metadata/decoder services rather than putting subprocess management in request handlers or the compiler.

### Work

1. Introduce a dedicated sample upload/inspection contract, provisionally POST /api/assets/samples, returning an immutable logical sample ID plus original/canonical references and verified metadata. Preserve the existing GEN/SoundFont/analysis upload behavior.
2. Stream uploads within current byte quotas. Decode WAV/MP3 in a bounded worker, validate mono/stereo and finite PCM, and produce canonical float WAV. Capture original/playback hashes, sizes, frame count, sample rate, channels, source format, and decoder revision.
3. Package and verify the chosen decoder in the actual runtime image. Distinguish unsupported media, malformed input, missing decoder, timeout, and quota errors.
4. Implement temporary files, atomic commit, immutable-content reuse, and rollback without deleting reused files. Include original plus canonical bytes in quota calculations.
5. Define managed preview/download access if needed by the editor. It must resolve verified asset IDs, not arbitrary paths. Reuse existing audio/session preview controls where practical.
6. Add verified-metadata caching and upload/draft lease ownership. Playback/export must detect missing or changed content without decoding the same file on every autosave.
7. Extend API regressions in backend/tests/test_api.py and service-level tests for success, malformed audio, rejected channels, cancellation, quota exhaustion, and transactional cleanup.

### G2 evidence

Every valid upload returns a complete usable asset; every failed upload preserves the old map and leaves no unowned final files. MP3 and WAV canonical output is accepted by Csound without an MP3 decoder at render time.

## 4. T3 Models, persistence and asset reachability

### Source seams

Update [frontend types](../../frontend/src/types/index.ts), [store model](../../frontend/src/store/appStoreModel.ts), [store entry point](../../frontend/src/store/useAppStore.ts), [performance models](../../backend/app/models/performance.py), [app-state models](../../backend/app/models/app_state.py), [session models](../../backend/app/models/session.py), [export models](../../backend/app/models/export.py), and [reference collector](../../backend/app/services/gen_asset_references.py).

### Work

1. Add shared golden examples for sampleMap v1 and sampleAssets, including duplicate notes, two instances sharing assets, unresolved IDs, unused instances, and an incompatible changed patch.
2. Implement strict validators and deterministic serialization in frontend/backend. Reject unsupported versions at boundaries; normalize an omitted legacy map to empty without rewriting unrelated state.
3. Carry the manifest and assignment maps through Save/Load, app-state autosave/hydration, snapshots, instance cloning/deletion, patch changes, session projection, and native payload construction.
4. Implement composite required-version selection. Sample data plus any clip/automation/transposition/fixed-reference feature must keep every feature's required version and contents.
5. Add reference verification to persistence and startup at the appropriate worker boundary. Cache expensive media validation. Preserve the previous saved document on error or stale revision.
6. Expand asset traversal to the new manifest/mappings in full native envelopes, raw configs, and app-state shapes. Reachability must include all mapped rack instances, persisted recovery state, and active leases/sessions.
7. Implement pruning of unreachable manifest entries within a performance without immediate shared-file deletion. GC after deleting one performance must retain files owned by another.
8. Preserve maps when the same patch loses capability; surface incompatibility without dropping authored data. Explicit patch replacement clears only that instance's map.

### G3 evidence

Cross-language fixture parity; complete Save/Load and recovery round trips; instance independence; compatible old data; rejection of unknown versions; and GC tests covering saved, recovered, active, abandoned, and multiply referenced assets.

## 5. T4 Compiler and runtime

### Source seams

Extend [compiler targets](../../backend/app/services/compiler_common.py), [compiler service](../../backend/app/services/compiler_service.py), [orchestra emission](../../backend/app/services/compiler_orchestra.py), [mixer compilation](../../backend/app/services/compiler_mixer.py), and [session resolver](../../backend/app/services/session_instrument_resolver.py). Implement focused sample compilation/runtime modules as needed.

Apply the installed visualcsound-opcode-support skill when adding the node. Follow the [repository patch-authoring skill](../../integrations/skills/orchestron-patch-creator/SKILL.md) for the starter and audio validation.

### Work

1. Add node metadata, ports, validation, icons/help, and capability discovery. Enforce the single root-level node/MIDI-only/no-legato restrictions.
2. Resolve verified per-instance maps before compile. Deduplicate and preload sample tables once per engine and generate bounded note lookups. Include mapping/content identities in compilation/preparation signatures.
3. Implement the G1-proven complete-patch one-shot lifetime, exact-note lookup, velocity scaling, mono/stereo handling, fixed edge fades, natural termination, and bounded overlapping attacks.
4. Extend semantic lifecycle delivery with source and voice identities. Keep sample ownership until natural completion/cancellation even when ordinary MIDI note ownership is gone.
5. Integrate explicit device Stop, lane suppression, seek, source removal, audition restoration, Panic, engine reset, and queue cancellation. Preserve independently running Manual pads and other same-pitch sources.
6. Apply cancellation at engine boundaries, with bounded ramps. Ensure canceled/superseded queued work cannot restart a voice. Define deterministic ordering at equal timestamps.
7. Reuse existing score chasing; a chased attack starts from frame zero. Match finite-end drain behavior and range-start capture in the export projection.
8. Register table and helper-instrument resources with render analysis. Initially use conservative single-renderer fallback unless full partition ownership/parity has been proven.
9. Add compiler, native audio, scheduler/ownership, session API, and lifecycle regressions. Verify operation without OS MIDI devices and at supported engine sample rates/block sizes.

### G4 evidence

All playback scenarios pass through actual Csound and the session runtime. No per-note decoding or table growth, no unbounded silent voices after held keys, no source leakage, no input-mode difference in the sampler behavior, and no changes to feature-free instruments.

## 6. T5 Native and offline exports

### Source seams

Extend [frontend bundle helpers](../../frontend/src/lib/bundleImportExport.ts), [bundle API](../../backend/app/api/bundles.py), [atomic import service](../../backend/app/services/bundle_import_service.py), [CSD selection](../../backend/app/services/performance_export_selection.py), and [CSD exporter](../../backend/app/services/performance_export_service.py).

### Work

1. Include maps/manifest in native payloads and source/canonical files in ZIP dependency collection. Preserve every rack instance and deduplicate members.
2. Extend import preview/commit validation, consistent ID remapping, selected-definition behavior, and whole-transaction rollback. Imports use bundled canonical WAVs without decoder-dependent regeneration.
3. Select CSD instances before asset collection, then collect complete maps for those instances. Preserve independent maps even when they share a patch definition.
4. Pass resolved instance maps into both compiler paths. Generate packaged relative paths/numeric aliases that work after extraction to another directory.
5. Retain semantic attack/cancel records during offline capture. Emit one-shot helpers and, if needed, deterministic lifecycle commands alongside the MIDI file. SCORE and MIDI paths must agree on attack identity, velocity, duration, and cancellation ordering.
6. Calculate export end from surviving sample voices plus existing effect tail. Keep effect instances alive and account for sample starts near range end, same-pitch overlaps, and forced cancellations.
7. Extend event/resource accounting to generated helpers and longer tails. Return explicit errors for limits; do not truncate audio or drop members.
8. Update render-package README/warnings. A user should need only the extracted package and a supported Csound installation.
9. Test relocation and a clean asset directory; validate source/canonical hashes, map ownership, generated code, timing, waveform output, and tails for both export modes.

### G5 evidence

Native import on a clean installation restores editable maps and original audio. Both CSD ZIPs render after relocation, without the application or its decoder. The long-tail and selective-cancellation regressions pass, and omitted instances contribute no exclusive files.

## 7. T6 Rack editor and built-in starter

### Source seams

Use the existing [adaptive rack](../../frontend/src/components/sequencer/AdaptiveInstrumentRack.tsx), [controller rack](../../frontend/src/components/sequencer/PerformanceControllerRack.tsx), store actions, and client. Add a focused Samples editor component instead of embedding media logic in the rack.

### Work

1. Create or reuse a normal Sample Player patch from **Add Sample Player** in Perform. Preserve the analog drumkit build input and other built-in templates.
2. Add note rows, upload/replace/remove, empty states, progress/errors, file metadata, and focused preview controls. Use numeric note entry plus existing note names.
3. Make each committed row transaction atomic. Reject note collisions, prevent stale uploads from landing in a switched/deleted instance, and keep unsaved form state out of authored snapshots.
4. Lock structural map edits while the instrument engine runs. A late engine-start race must also be rejected by the update action/backend contract, not only by a disabled button.
5. Preview through existing routed audition infrastructure. A preview started from a stopped engine may temporarily start its isolated session; cleanup and engine ownership follow the existing audition rules.
6. Preserve local UI state on collapse and view changes according to current contracts. Release preview voices on close, source switch, or cancel.
7. Supply keyboard access, accessible labels, responsive layout, and EN/DE/FR/ES copy. Help explains natural-speed mapping, one-shots, overlap, and stopped-engine editing.
8. Verify save/reload and every export directly from the resulting UI.

### G6 evidence

The workflow is usable with an empty library and with multiple instances of one patch. Replacement/cancellation/race cases preserve the correct assignment. Keyboard and narrow-layout checks pass; screenshots reflect the real implementation.

## 8. T7 CLI, skills and technical contracts

Update [Performance Creator CLI](../../integrations/skills/orchestron-performance-creator/src/orchestron/cli/orchestron_cli.py) and its tests so inspect, normalization, edits to unrelated fields, save, runtime projection, and export retain sample maps/assets and the required versions. The standalone CLI remains independent of backend imports.

Provide a bounded upload/assign/remove/inspect path through the existing command architecture if that is the supported first-version agent authoring interface. At minimum, unsupported mutations must fail explicitly instead of dropping or corrupting sample data. Specify the actual command schema in the implementation record rather than guessing command names here.

Update repository patch/performance skill instructions for sample ownership, supported formats, stopped-engine changes, fixture use, and portable exports. Keep repository documentation and packaged source copies aligned when packaging changes are part of implementation; changing an installed plugin or publishing a release is a separate action.

Update BACKEND.md with actual schema, endpoints, lifecycle semantics, resources, and version numbers. Keep this specification current as proposed internal field names settle.

### G7 evidence

Shared fixtures produce equivalent frontend and standalone CLI documents/runtime requests. Unrelated CLI edits preserve maps, originals, canonical audio references, and all existing performance features. Skill instructions describe the delivered interface.

## 9. T8 Verification and delivery record

Run targeted tests during each task, followed by the repository checks appropriate to the completed implementation:

~~~sh
npm --prefix frontend run check
uv run --extra dev pytest backend/tests
make backend-check
make benchmark-runtime
npm --prefix frontend run build
docker build --target frontend-build .
make docs-check
git diff --check
~~~

Run the standalone Performance Creator tests using its own project instructions. Qualify the decoder and Csound renders inside the actual runtime Docker image as well as the local environment. The frontend Docker target alone does not establish audio/decoder support. Report unavailable Docker checks as unperformed.

Add deterministic audio tests and sample fixtures to backend/tests, with API coverage in backend/tests/test_api.py. Fixture tests must not read examples directly or through production imports. Verify existing shared build inputs still exist.

Compare cold/cached preparation, sample-table memory, and steady render timing against T1 on the same fixtures. Include repeated engine starts and high retrigger counts to expose leaks. Existing unrelated note/controller live edits must not decode or reload unchanged samples.

Update README, relevant English documentation pages, manual.json/navigation, localized UI/help, and screenshots. Use the user-documentation PDF skill when rebuilding the manual and visually inspect the resulting PDF.

Create a final implementation record containing:

- Actual schema/API/format decisions and migration behavior.
- Verified acceptance IDs, commands, platforms, decoder/Csound versions, and fixture identities.
- Audio parity/tail/source-isolation results and performance/memory measurements.
- Resource defaults and deterministic overflow behavior.
- Screenshots, manual checks, frontend and Docker build results.
- Any unresolved limitations, explicitly distinguishing unperformed checks from passing checks.

The feature remains unavailable for general authoring until native and both CSD exports, asset recovery/GC, and one-shot cancellation meet their gates. A working oscillator prototype or an upload UI alone does not satisfy this plan.

