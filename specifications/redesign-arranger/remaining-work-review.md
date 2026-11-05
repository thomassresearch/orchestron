# Remaining work: implementation cross-check

Reviewed 2026-11-05 against `de76638`. This is the current prioritization of the
original six tasks, superseding their initial blanket acceptance backlog. It is a
source/test audit, not default-rollout approval. Production behavior and the rollout
flag were not changed.

## Recommended order

Priority reflects work order and release impact. P1 items should precede broad
qualification; P2 items close specific acceptance gaps; P3 is the final release
step. No P0 incident was identified by this audit.

| Order | Priority / tasks | Remaining work and completion criterion |
| --- | --- | --- |
| 1 | **P1 — audition timing/capacity** · 03 | Use exact clip-aware auditions for v1/v2 as well as v3/v4. Valid fractional rests and containers with more than 256 resolved leaves must audition without changing authored format/music. Cover all source types, restoration, cancellation and both old/new model versions. The exact schedule mechanism already exists; extend its coverage rather than introduce another protocol. |
| 2 | **P1 — audition headroom** · 02, 03 | Make temporary auditions work when an authored lane contains 512 definitions. Preserve authored limits and definitions; account for draft additions and backend pad limits. Verify pattern and container auditions at/near capacity, and actionable failures for genuinely over-budget drafts. |
| 3 | **P1 — migration/recovery acceptance** · 01, 02, 06 | Add a versioned legacy-category matrix and rehearse the actual GUI conversion/download/import recovery path. Include nested shared groups, unused/hidden payloads, colors, independent cycles, Manual pads, Live arps and multiple keyboards. Compare music, routing, mixer and controller state before migration and after recovery; verify unsupported categories stay in compatibility mode. Existing generic round trips do not close this conversion/recovery matrix. |
| 4 | **P2 — audio/input qualification** · 03, 05, 06 | Exercise clip-context preparation failure, rapid switch/cancel, reconnect, seek/loop/finite end, pre-existing engine ownership, held notes/sustain/removal and external MIDI during song plus editor playback. Reuse existing race tests and target missing combinations. Record a sustained real-browser PCM/underrun run. Extend live-versus-both-export comparison where absent, especially drummer/controller/arpeggiator interactions; the new CLI event-parity test explicitly isolates the melodic lane. |
| 5 | **P2 — remaining editor capability matrix** · 01, 05 | Map preserved controls to existing tests, then cover the holes through contextual editing and scoped save/reload. Focus on drummer hidden/inactive cells and ratchet ramps, arpeggiator presets/seeds/input/hold, score hidden notes/local undo across occurrence switches, and controller mode/reset/channel combinations. Existing production-editor unit tests and the six-case playback matrix are evidence to reuse, not work to repeat wholesale. |
| 6 | **P2 — dense GUI/audio measurement** · 01, 04, 06 | Measure compact/expanded/collapsed nested arrangements at low/high zoom with a comparable baseline: traversal, rendering, preparation and PCM continuity. Define supported limits and fix measured overruns. Transposition preparation/cache benchmarks and score-editor virtualization already exist; neither measures the whole nested arranger UI during audio. |
| 7 | **P2 — responsive/accessibility qualification** · 04, 06 | Review current create/copy/duplicate/resize/rest/group/automation/transposition dialogs at narrow widths, text zoom and classic scrollbars; verify keyboard-only operation, coarse pointers, screen-reader descriptions, focus return and non-color feedback in EN/DE/FR/ES. Existing dialog/keyboard tests and 520-pixel transposition checks narrow this work, but do not cover the complete current surface. |
| 8 | **P3 — release decision and cleanup** · 06 | Rerun the appropriate full checks after fixes, collect the above evidence, update documentation/screenshots only where behavior changes, and explicitly close G1–G6 before default activation. Cleanup of obsolete-only code is a separate change after consumer review; retain compatibility readers and recovery paths. |

Items 4–7 can be prepared independently after the confirmed audition defects are
addressed. Migration/recovery comes before expanding rollout because it concerns
existing user performances. A fresh full-suite run remains a normal release check,
not a separate saxophone implementation project.

## Confirmed implementation gaps

### Exact audition support is only partial

[clipAuditionState](../../frontend/src/lib/clipArranger/runtime.ts) selects the exact
schedule path only for model v3/v4 or a pending transposition edit. V1/v2 still
convert rests to whole local-beat tokens and emit one token per resolved leaf.
[SessionAuditionRequest](../../backend/app/models/session.py) permits at most 256
tokens. New performances in [useAppStore](../../frontend/src/store/useAppStore.ts)
and [legacy migration](../../frontend/src/lib/clipArranger/migration.ts) still create
model v1, so this is reachable current behavior, not merely an obsolete reader.

Temporary executable probes checked all four clip versions against valid authored
models:

| Probe | V1/V2 | V3/V4 |
| --- | --- | --- |
| Group with one pattern and a quarter-beat rest | Throws `This rest cannot yet be auditioned on the source grid.` | Compiles with exact schedule |
| Supergroup with two 256-pattern groups | Emits 512 tokens, exceeding the request schema | Emits one selection token plus a schedule |
| Pattern audition with 512 authored definitions | Temporary view reaches 513 definitions and validation fails | Same failure |

The backend schema independently accepted 1/256 tokens and rejected 512. The
12 frontend probes passed as assertions of these observed limits; they were
removed after the audit and are **not** permanent regressions or implemented fixes.

The headroom failure arises because `clipAuditionDefinitions` appends a temporary
definition and `clipRuntimeView` validates that view against the authored 512 limit.
Backend source pad lists also have a 512 limit. Fixing only token timing or raising
one frontend limit is insufficient.

### Migration has a conservative implementation, incomplete acceptance evidence

The converter preserves all pad payloads, reusable hierarchy, colors and independent
cycles; it explicitly rejects Manual sources, Live arps and multiple keyboards.
[model.test.ts](../../frontend/src/lib/clipArranger/model.test.ts) checks deterministic
payload/cycle retention and multiple-keyboard rejection. Many integration fixtures
also use the converter. That is useful coverage, but no complete GUI recovery matrix
was found.

[SequencerPage](../../frontend/src/components/SequencerPage.tsx) downloads the original
configuration before committing conversion. [App](../../frontend/src/App.tsx) retains
the raw configuration import path. Restoration is therefore implemented in pieces;
the outstanding task is a verified end-to-end recovery workflow, not building a
new downgrade mechanism. The backup is a configuration snapshot, not a bundled
copy of instrument assets; include the intended same-library recovery conditions
in that verification.

## Work that is done or superseded

| Original concern | Current evidence and disposition |
| --- | --- |
| All editor adapters/scoped saves need implementation | **Done.** [Store tests](../../frontend/src/store/clipActions.test.ts) and [playback matrix](../../frontend/src/components/clipArranger/ClipPlaybackHighlight.test.tsx) exercise real adapters, both save scopes and reload for melodic, drummer, score, controller step/curve and arp cases. Retain only the capability gaps in item 5. |
| Drummer row corruption; missing/misaligned playback highlights; reload audition startup; finite-end underruns | **Fixed with regressions.** Covered by the above suites, [runtime-controller tests](../../frontend/src/hooks/useSequencerRuntimeController.test.tsx) and [backend clip tests](../../backend/tests/test_clip_arrangement.py). Do not reopen these as unspecified implementation tasks. |
| Container inspector bypasses structural transactions; musical/structural conflicts unresolved | **Closed.** [ContainerStructure tests](../../frontend/src/components/clipArranger/ContainerStructure.test.tsx) and [draft-resolution tests](../../frontend/src/lib/clipArranger/structuralDraftResolution.test.ts) cover shared transactions, local/all scopes, Save/Discard/Cancel and rebase. |
| Compact history and persistence reliability | **Implemented and covered.** [History tests](../../frontend/src/lib/clipArranger/history.test.ts), API native/app-state tests and [CLI-history frontend parity](../../frontend/src/lib/clipArranger/performanceCreator.test.ts) cover the newer compact representation. Migration acceptance remains separate. |
| Transposition is a planned, unimplemented extension | **Obsolete.** [Transposition implementation record](../clip-transposition/implementation-record.md), v3/v4 projection, tests and direct UI controls are shipped in the preview. Exact auditions are partially delivered by this extension, as qualified above. |
| Direct content editing remains incomplete | **Core workflows implemented.** Timed moves/copies, duplication, resizing/trailing rests, grouping across repetitions and safe window rebasing have domain/component/API coverage. See [structure tests](../../frontend/src/lib/clipArranger/structure.test.ts), [duplicate tests](../../frontend/src/lib/clipArranger/structureDuplicate.test.ts) and [repetition tests](../../frontend/src/lib/clipArranger/structureRepetitions.test.ts). Global libraries and automatic ripple movement are not release backlog. Cross-track copying now exists; it must not be confused with unrestricted cross-track moving. |
| Score keyboard and score-end behavior | **Recent fixes included.** `f3ba043` adds manual-MIDI keyboard audition/append; `de76638` fixes grid-end behavior. [ScoreEditor tests](../../frontend/src/components/sequencer/ScoreEditor.test.tsx) and [keyboard hook tests](../../frontend/src/hooks/useScoreKeyboardPreview.test.tsx) include startup ownership, failure, held/retriggered notes, hidden material, undo/collapse and bounds. |
| CLI only reads clip data and rejects editing | **Superseded.** [Performance Creator delivery](../performance-creator-arranger/implementation-record.md) provides native clip authoring/history/audition/export commands. Legacy pad commands still reject clip-owned shadow data intentionally. |
| No runtime/export parity or matched preparation measurements | **Partially obsolete.** Clip/transposition/API suites cover crop/chase/release and MIDI/SCORE; [CLI parity](../../backend/tests/test_performance_creator_parity.py) compares melodic events. Transposition has paired identity and dense-cache measurements. Remaining all-source combinations and whole-arranger GUI costs are items 4 and 6. |
| Saxophone failures still block a green full suite | **Old blocker superseded by later evidence.** Transposition recorded 2,709 passing backend tests; Performance Creator later recorded 2,735 passing tests. Do not claim the historic intermittent thresholds were fixed, but remove “reproduce saxophone failures” as outstanding redesign work. Investigate only if current checks reproduce a failure. |
| README/manual/help/screenshots still need initial implementation | **Done for delivered features.** Subsequent feature commits updated them. Only changes caused by remaining fixes and the final review remain. |

## Audit verification and limits

Fresh checks at `de76638`:

- 316 frontend tests passed across the selected clip domain/components/store,
  runtime-controller and playback-policy suites.
- 50 score editor/keyboard tests passed, plus the 12 temporary audition probes.
- 92 backend clip/transposition/preparation tests passed.
- 20 selected API tests passed (`clip or transposed or grouped_repetition or
  instrument_automation`); 395 were deselected.
- Three performance validation/live-export parity tests passed.
- All 370 Performance Creator tests passed.

These are 366 permanent frontend, 115 backend and 370 CLI tests, plus the temporary
probes. The backend emitted the existing Starlette/httpx deprecation warning.
The full backend/frontend checks, production builds, fresh browser/audio sessions,
hardware MIDI, subjective listening, accessibility tools and new performance
measurements were not run in this audit. Historical passing runs above are labeled
as historical evidence, not fresh results. Documentation links and whitespace were
validated after updating the task statuses.
