# Implementation record

Status: **implemented**, 2026-11-05. Baseline: `110555f`; implementation is the current uncommitted workspace change. All six tasks and three stages are represented below. Installation, publication and the broader arranger rollout were not performed.

## Delivered contracts

- Portable song modules implement authoritative inspection, reusable authoring, migration, song reconciliation, transposition, owned automation, structure, sections, history, runtime control and exports. They import no backend code. Existing pad commands remain available for legacy drafts and cannot modify clip-owned shadow pads.
- Song schema: `orchestron-song` version 1, discoverable through `edit schema`. Integer times are ticks; exact strings use `t`, master-quarter `b`, lane-local `l`, or `bar` with explicit song meter. Unknown authoring fields fail. Create/update/explicitly scoped replace preserve stable identities and support no-op retries.
- JSON response schema 1 retains `ok`/`result`. Success uses stdout; failures use stderr, with code/path/retry details. Exit codes: 0 success, 1 domain/I/O/backend failure, 2 argument error. Read views page through authoritative objects; full payload is explicit.
- CLI process locking covers the complete edit command. Transactions validate copied state before atomic replacement; stale targets, failed operations and dry runs preserve staged bytes. Source topology changes reset clip history. GUI-compatible history v2 is stored in `sequencer.clipHistory`, with a 25-action cursor and redo branching.
- New songs explicitly select `edit begin --new --arranger clips`. Legacy migration requires a new recovery file; Manual sources, Live arpeggiators and multiple keyboards are rejected. `adapt-score` preserves the existing v1/v2 musical parser and adds a stable handoff identity; legacy `apply-score` retains append semantics.
- Shared patterns/groups remain definitions. Clip windows, repeats, rests and source offsets remain separate. Pitch-only edits create no musical definitions. Local musical edits split one pass and fork changed ancestors; structural grouping across repeats retains fixed indexes and placement paths.
- Automation follows rack/controller identities, merges equivalent ownership, requires a survivor for conflicting merges, and suspends unavailable mappings. Independent curve duration uses master ticks and up to ten points. Mapping changes use the existing coordinated controller PATCH with sequencer preparation.
- `GET /performances/capabilities` advertises validation, conditional persistence and runtime snapshot support. Bounded `POST /performances/validate` runs authored/routing checks in a worker thread, without persistence or audio preparation. Optional `expected_updated_at` uses one SQL conditional update and returns 409 for stale saves; old clients remain compatible.
- Runtime snapshots and optional `expected_generation` protect preview preparation against intervening sequencer/arpeggiator edits. Audition requires matching runtime music, has a separate monotonic command counter, and ends without replacing authored content. Transport uses the independent-device arranger protocol and tracks CLI engine ownership.
- Native/MIDI/SCORE exports invoke existing backend services. Requested native ZIP output wraps a JSON-only native response in the standard archive entry, so it imports under its actual filename. Existing files are preserved; export neither commits nor renders audio.

## Verification

| Check | Observed result |
| --- | --- |
| Full backend suite | 2,735 passed in 534.71 s; one existing Starlette/httpx deprecation warning |
| Final changed API and arpeggiator subset | 30 passed after runtime snapshot hardening; includes validation bounds, read-only behavior and conditional saves/preparation |
| New validation service and live/export fixture tests | 3 passed |
| Performance Creator suite | 370 passed in 9.06 s, including the final native-ZIP regression |
| Composition export/history handoff tests | 30 passed in the Composition Creator environment |
| Frontend check | Lint, 111 test files / 1,225 tests, TypeScript and production build passed |
| Python playback parity | 47 transposition/CLI fixture tests passed with `VISUALCSOUND_SEQUENCER_IMPLEMENTATION=python`; default Cython path also passed |
| Backend/new module lint | Ruff passed |
| Packaging | Six package tests passed, including actual extraction and offline song execution |
| Skill | `quick_validate.py` passed; packaged main/new reference links validated |
| Manual | Canonical PDF generator included 55 source pages; rendered PDF pages 32 and 96 inspected visually |
| Whitespace | `git diff --check` passed |

The full backend run preceded the last snapshot guard and native export wrapper; the affected API/arpeggiator subset and focused export tests were rerun afterwards. Shared playback kernels were not changed, so no Cython rebuild was needed.

### Acceptance traceability

| Criteria | Evidence |
| --- | --- |
| A01–A04 | Capability/JSON subprocess tests; atomic transaction, no-op/dry-run/stale/lock cases; unknown fields and unused payload rejection; conditional persistence API tests |
| A05 | Shared all-source fixture, nine Score definitions, hidden-data rejection and backend wire validation in `test_song_contracts.py` |
| A06–A08 | Explicit migration implementation, existing compatibility suite, exact timing checks, explicit score adapter and idempotent song tests |
| A09–A10 | Local note fork versus placement transposition tests; fixed-index grouping fixture and existing exhaustive pitch vectors |
| A11 | Existing note timing/strum/score/arpeggiator backend regressions; shared CLI live/export event capture |
| A12–A14 | Automation generation, retry, long duration, split/merge/conflicting survivor and suspension tests; existing coordinated mapping/preparation API coverage |
| A15–A17 | Section/copy/duplicate tests, shared container placement remapping, timed growth into rests, local-pass isolation and collision rollback |
| A18 | CLI history tests; frontend `performanceCreator.test.ts` imports CLI history and replays it through save and autosave; existing 25-action/history native tests |
| A19 | Packaged preview start/status/stop; monotonic command and ownership regressions; generation-checked runtime snapshot tests; existing preview restoration backend cases |
| A20 | Shared CLI→frontend fixture and exact native ZIP reimport comparison of arrangement/history; existing rack/routing/controller round trips |
| A21 | New live scheduler versus both export capture modes, packaged native/MIDI/SCORE archives, plus native Csound browser-clock PCM evidence below |
| A22–A23 | Locked extracted Performance Creator environment outside checkout; read-only source tree; all four entry points; composition handoff tests |
| A24 | Documented 42-command acceptance script, using returned IDs/selectors and operation documents; zero raw-config repairs |

These are targeted regression and integration checks, not a claim that every possible combination of structural edits was exhaustively tested.

### Extracted plugin and real runtime

`integrations/tests/performance_creator_acceptance.py` exercises patch discovery, a compact 128-bar song, retry/no-op, section overwrite, later placement transposition, one local variation, owned long automation, overlap rejection/recovery, undo/redo, validation, commit/reload, fixed-repeat grouping, runtime preparation, audition and all three exports. The final archive completed all 42 commands; maximum response size was 28,808 bytes (explicit schema/discovery included), with no raw configuration repair. Final music: 3 lanes, 5 musical patterns, 7 definitions and 11 clips, including the added variation and automation. A separate native ZIP import preserved exact arrangement and history.

The package was extracted into a fresh temporary directory and made read-only. Its locked environment, sessions, operation documents and media were outside the package. The client had no repository PYTHONPATH. Console and thin-wrapper entry points ran. Patch Creator, Composition Creator and Sung Melody Transcription also ran their packaged entry points using their own locked external environments. Two unchanged projects required downloading missing locked cache entries; they then passed.

An isolated localhost backend used temporary SQLite/assets and native Csound with mock mode disabled. The final transport implementation started the arranger and delivered 4,096 float PCM samples with peak 0.150000006 and two transport events through the browser-clock WebSocket, at 48 kHz / `ksmps=1`. This verifies native rendering and the browser-clock protocol; physical speaker listening and a manual GUI audition session were not performed. Existing real-engine backend tests also cover preparation failure retaining audible PCM and render-boundary application.

After verification, all five disposable runtime sessions were deleted and the isolated backend was stopped. Native Csound intercepted the initial interrupt; termination emitted its native signal-handler backtrace and exited with status 1. This cleanup outcome is separate from the successful playback and acceptance checks above; graceful host-process shutdown was not established by this run.

### Efficiency measurement

One local run, without a performance threshold assertion:

| Song | Musical patterns / total definitions / clips | Compact config / runtime bytes | Author + validate | Project | Summary bytes |
| --- | --- | --- | --- | --- | --- |
| 128 bars | 3 / 4 / 8 | 674,467 / 111,062 | 6.45 ms | 16.93 ms | 632 |
| 12,800 bars | 3 / 4 / 2 | 673,440 / 106,180 | 6.11 ms | 16.34 ms | 636 |

The larger fixture expands scalar repeats, retaining the same musical library. Legacy compatibility source pads account for much of stored size; no additional musical definitions are created for repeats. Retry reconciliation took about 5–6 ms. Measurements are from this machine and are not portable latency guarantees.

## Package identity

- Plugin: **0.1.5**. Performance Creator project: **0.3.0**. Response/song schema: **1**.
- Artifact: `integrations/plugin-dist/orchestron-0.1.5.zip`, **521,101 bytes**.
- SHA-256: `8e9e2472dc364995d2eccfae2ab446b3d2c3e57c2049802884e00a2b76ef171b`.
- Same-source/same-toolchain rebuild produced the identical hash. No cross-toolchain reproducibility claim.
- Includes all four skills, new portable modules, schemas, references, executable song assets, branding and licenses. Tests, caches, environments, sessions and generated media are excluded.
- No installed plugin cache was patched. The ZIP is a local delivery artifact, not an installed or published release.

## Explicit boundaries

The backend coordinates one owner mapping change per PATCH; multi-owner changes require separate staging/push or rebuilding an owned runtime. Audition requires matching prepared music, preventing an implicit draft replacement. External unsaved GUI drafts are invisible. Cross-lane copy is exposed at clip granularity, with source-type/drum-key/controller compatibility checks. Legacy cycles convert explicitly and can be undone. Live device settings changed through a separate arpeggiator request invalidate the combined runtime snapshot until a full configuration is supplied. The broader arranger preview gate remains unchanged.
