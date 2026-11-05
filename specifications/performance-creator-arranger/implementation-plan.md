# Implementation plan

Status: implemented, 2026-11-05. This document retains the original requirements; see the [implementation record](implementation-record.md) for delivered contracts, verification and explicit boundaries, and the [task index](README.md) for dependencies.

## 1. Verified baseline and gaps

The previous analysis inspected both repository sources and the installed plugin. These observations must become regression cases before implementation; they are not new features delivered by this plan.

| Area | Baseline | Required outcome |
| --- | --- | --- |
| Distribution | Installed Orchestron 0.1.4 lacks the repository's clip projection modules and accepts performance versions only through 22 | A new, identifiable package includes the actual implementation and passes extracted-package checks |
| Creation | `edit begin --new` creates v22 without `clipArrangement` | Explicit clip-mode creation and conservative legacy conversion |
| Reading/playback | Repository reads v1–26 and projects clip models v1–4, automation and transposition | Retain this support and inspect authoritative definitions |
| Mutation | Legacy track/pad edits reject clip performances with `clip_editor_required` | Definition/occurrence commands mutate the authoritative arrangement; retain the legacy guard |
| Score application | v1/v2 specifications append tracks; applying twice duplicates tracks | Separate versioned song-authoring format with stable IDs and explicit update semantics |
| Input validation | An unknown top-level `arrangement` field is silently ignored by the current score importer | Strict validation in the new format and explicit compatibility behavior for old score documents |
| Arrangement validation | CLI validation checks instruments/routes; overlapping clips passed an isolated mocked-route probe while the backend authored validator rejected them | Full authored validation before reporting a song as valid |
| Responses | Success envelope and some structured errors exist; parser failures emit ordinary usage text | Predictable JSON for success and failure, bounded inspection, impact and actionable corrections |
| Skill | Guidance centers on eight pads and pad-loop hierarchies | A reusable-definition/song workflow, documented scopes and automation ownership |

At analysis time, the five existing CLI clip tests passed. They cover projection/round trips and the legacy mutation guard, not new authoring or packaged functionality. Record fresh evidence during implementation.

## 2. Architecture and source boundaries

Keep the console entry point and thin script wrapper. Move new domain behavior into focused modules under the Performance Creator's `src/orchestron/` package; avoid adding the entire feature set to its approximately 6,000-line command module. Both batch and incremental commands call the same operations.

| Responsibility | Existing source seams |
| --- | --- |
| CLI dispatch, sessions, rack, routes, score import | [CLI implementation](../../integrations/skills/orchestron-performance-creator/src/orchestron/cli/orchestron_cli.py), [wrapper](../../integrations/skills/orchestron-performance-creator/scripts/orchestron_cli.py) |
| Standalone runtime projection | [clip projection](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_arrangement.py), [transposition validation](../../integrations/skills/orchestron-performance-creator/src/orchestron/clip_transposition.py) |
| Authored musical model and editing semantics | [model](../../frontend/src/lib/clipArranger/model.ts), [operations](../../frontend/src/lib/clipArranger/operations.ts), [structure](../../frontend/src/lib/clipArranger/structure.ts), [timed structure](../../frontend/src/lib/clipArranger/timedStructure.ts), [migration](../../frontend/src/lib/clipArranger/migration.ts) |
| Repetition and scoped pitch | [transposition edits](../../frontend/src/lib/clipArranger/transposeEdits.ts), [transposition algebra](../../frontend/src/lib/clipArranger/transposition.ts), [repetition regressions](../../frontend/src/lib/clipArranger/structureRepetitions.test.ts) |
| Automation and live mapping | [automation domain](../../frontend/src/lib/clipArranger/automation.ts), [automation actions](../../frontend/src/store/automationActions.ts), [backend automation](../../backend/app/services/instrument_automation.py) |
| Persistence validation/API | [authored validator](../../backend/app/models/clip_validation.py), [performance models](../../backend/app/models/performance.py), [performance API](../../backend/app/api/performances.py), [session API](../../backend/app/api/sessions.py) |
| History and audition | [history](../../frontend/src/lib/clipArranger/history.ts), [structure audition](../../frontend/src/lib/clipArranger/structureAudition.ts), [runtime adapter](../../frontend/src/lib/clipArranger/runtime.ts) |
| Packaging | [builder](../../integrations/build_plugin.py), [manifest](../../integrations/plugin.json), [package tests](../../integrations/tests/test_plugin_package.py) |

The installed CLI must run without importing `backend`, frontend code, repository fixtures or the repository virtual environment. Implement local authoring/preflight as portable Python, with cross-language golden fixtures to prevent semantic drift. Keep actual persistence, rack resolution and runtime preparation authoritative on the backend. Reuse existing musical parsers and runtime serializers.

Provide a side-effect-free backend validation operation for a complete proposed performance, using the same authored validators as save/import. Proposed route: `POST /performances/validate`; Task 01 finalizes its request and response, registers any static route before conflicting dynamic routes, and applies existing request limits. It must not create a performance, compile/start a live session or edit a library. Separate structural/routing validation from an explicitly requested preparation check, whose cost and result must be visible. If an equivalent endpoint exists by implementation time, reuse it and update the plan. Never use a temporary save/delete as validation.

## 3. Proposed public authoring contracts

Finalize spellings and schemas in Task 01; subsequent tasks implement these capabilities through one operation layer.

| Command family | Required capabilities |
| --- | --- |
| `capabilities`, `edit status`, `edit inspect` | Client/backend format support, staged/saved/runtime state, song/lane/definition/occurrence inspection |
| `edit begin`, `edit migrate` | Explicit `--arranger clips`, legacy compatibility, migration preview/report/recoverable original |
| `edit lanes`, `edit patterns`, `edit groups` | Named IDs, lane settings, all five musical payload types, linked adoption and explicit variation |
| `edit clips`, `edit song` | Place/move/trim/offset/Once/Loop/fit/remove, explicit song end and song-loop settings |
| `edit transpose` | Shared/parent/placement plans, default/repetition operations and effective contributions |
| `edit automation`, controller mappings | Discover/map/generate/edit/reconcile/suspend and independent long curves |
| `edit apply-song` | Strict declarative specification, dry run, create/update/explicit replacement, retry protection |
| `edit sections`, structure, undo/redo | Range copy/paste, insert/close time, grouping/moves/resizing, local/shared scope, compatible history |
| `edit audition`, runtime control | Selected-context audition, stop/restore, song transport and meaningful pending/applied status |

Keep old score v1/v2 and legacy commands usable with their documented semantics. Do not silently reinterpret an old composition score as a new song specification or migrate an existing performance because an unrelated rack/mixer command was used. Start with explicit clip opt-in; the skill selects it for new clip-based songs. Legacy writing must continue to reject authoritative clip content.

### Identity, reuse and time

- Author-facing aliases are stable, unambiguous and resolved to canonical IDs. Names are labels, not identity. Return IDs and reusable occurrence selectors from discovery; selectors carry or are checked against a revision/fingerprint.
- Definitions and transposition profiles are lane-local. Groups contain patterns/rests; supergroups contain supported lower-level content. Cross-track section helpers compile to lane operations, not a new persistent global container type.
- Linked placement reuses definitions. A musical variation copies only necessary content/ancestor paths. Equal payloads with deliberately distinct identities must not be merged automatically. Offer reuse suggestions; any deduplication must preserve intent and hidden data.
- A repeat count is convenience syntax for the existing clip window and Loop mode. Store compact references, not copied note payloads or one child per generated pass. Materialize repetitions only for operations whose existing semantics require it, with capacity preflight.
- Preserve `repeatIndexBase`, fixed reference `repeatIndex`, full placement paths and each ancestor's index ownership. Explicit zero and inherited transposition are different operations.
- Canonical time is integer ticks at 20,160 per quarter note. Accept exact master-beat/fraction inputs; specify bar origin and song meter explicitly. Lane-local duration resolves through its meter and rational beat ratio. Reject unrepresentable times instead of rounding silently.
- Clip windows, content duration and song end are independent. Expose trimming, content resizing, fitting and closing time separately. Same-lane collisions fail atomically; later independent clips are never shifted implicitly.

### Transactions and retries

Stage changes in memory, validate the whole candidate, then atomically replace the edit-session file. A failure or dry run leaves config, history, identity mappings and revision unchanged. Successful no-ops neither create definitions nor add history entries. Add protection against two writers to the same session file and stale occurrence selectors.

Use stable document/object IDs for declarative reconciliation. `create` fails on collisions; `update` preserves unrelated objects; `replace` states its exact managed scope and previews removals. Never infer whole-performance deletion from an omitted lane. Duplicate labels cannot choose a target arbitrarily. A retry of the same successful operation/document must report no change. Detect stale input before overwrite; if server persistence lacks conditional writes, document the remaining race and add an appropriate precondition before claiming full stale-write protection.

Each mutation response distinguishes local staging, backend persistence and runtime application. Commit does not imply playback update. A runtime request being accepted does not imply it is already audible. Route/rack changes retain existing rebuild rules; mapping/automation changes use the coordinated backend transaction.

## 4. Response and discovery contract

Version the response contract independently. Keep the existing success envelope usable, with additive metadata where possible. New song commands must support JSON on every success/error path, including malformed arguments, schema errors, local I/O, unsupported capabilities and backend rejection. Preserve documented exit codes and stdout/stderr behavior; Task 01 fixes the channel rule and tests it in subprocesses. Progress/debug output must not corrupt machine output.

A mutation result contains operation, concise musical summary, relevant IDs/selectors, before/after revision, created/reused/forked/removed/unchanged counts, changed windows, affected linked uses, validation stages, warnings and staged/saved/runtime status. Include the next useful inspection/repair action when needed, with actual usable selectors. Detailed before/after payloads are opt-in.

Illustrative result, with field names to freeze in Task 01:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "operation": "clips.place",
  "summary": "Placed bass-main for 16 repetitions; reused its definition.",
  "state": {"stage": "staged", "revision": 12, "runtimeApplied": false},
  "result": {
    "laneId": "bass", "clipId": "verse-bass", "definitionId": "bass-main",
    "mode": "loop", "startMasterBeats": 0, "lengthMasterBeats": 128,
    "repetitions": 16
  },
  "changes": {"definitionsCreated": 0, "definitionsReused": 1, "clipsCreated": 1},
  "warnings": []
}
```

Inspection must read `clipArrangement` rather than shadow pads and cover all five lane types, bound automation, unused definitions and retained hidden content. Provide summary/tree/usage/effective-pitch views and bounded time-window expansion. Summarize large loops arithmetically; paginate lists and state truncation/continuation explicitly. Show natural musical units together with exact ticks when precision matters.

Errors include a stable code, field/object/occurrence location, understandable cause, concrete correction, conflict/limit details and `stateChanged`. Unexpected failures must not print a success envelope; debug mode may add details without weakening the ordinary structured result. Validation reports `passed`, `failed` or `not_run` for authored data, routing and preparation separately.

## 5. Cross-task regression and acceptance matrix

Use versioned synthetic fixtures, following the [fixture rules](../../backend/tests/fixtures/README.md). Proposed new fixture names below are future work, not files claimed to exist. Shared authored/schedule/event expectations should live under `backend/tests/fixtures/`; standalone input/response tests may live under the skill's `tests/fixtures/`. Package smoke harnesses supply external fixtures explicitly, because tests are excluded from the ZIP.

| ID | Scenario and required evidence | Owner |
| --- | --- | --- |
| A01 | Detect CLI/backend/package versions and unsupported formats; no invented capability when a server cannot report it | 01, 06 |
| A02 | Overlapping clips, missing references, invalid unused definitions and illegal timing fail authored validation before save | 01 |
| A03 | CLI parse/domain/backend errors are structured; read/mutation output stays bounded and identifies actual objects | 01, all |
| A04 | Rejected/dry-run/stale/concurrent operations leave staged bytes and revisions unchanged; no-op is explicit | 01–05 |
| A05 | All five source kinds retain their musical controls, hidden content and lane settings; more than eight definitions survive | 02 |
| A06 | Supported legacy migration preserves event order/time, routes, mixer, metadata and unused material; unsupported Manual/Live/multiple-keyboard cases retain recoverable originals | 02 |
| A07 | Partial first/last loops, fractional exact rests, rational lane timing and explicit trailing silence resolve identically to the frontend | 02, 03 |
| A08 | Reapplying one song document creates no duplicate lanes/patterns/clips and does not increment revisions; unknown fields fail with paths | 03 |
| A09 | Two uses share a motif; a pitch-only placement edit creates zero musical definitions; an intentional note variation isolates only its target | 03, 05 |
| A10 | Shared/parent/placement additions, per-repeat replacement, explicit zero/inherit, cropped bases and fixed indices retain exact sounding pitches | 03, 05 |
| A11 | Deterministic arpeggiator input, melodic chords/strums and sparse-score overlaps retain pitch/timing/velocity/release semantics | 03, 05 |
| A12 | Automation generation deduplicates CC ownership, preserves same-window music, rejects collisions and supports long independent ten-point curves | 04 |
| A13 | CC/channel retarget, split, identical/different merge, Off/missing owner and source deletion preserve owned music or report suspended status | 04 |
| A14 | Live mapping plus sequencers applies atomically; stale/failed preparation retains prior playback and staged correction material | 04, 05 |
| A15 | Move/trim/resize/remove/group/ungroup/duplicate/section operations preserve source coordinates, links and collision rules | 05 |
| A16 | Cross-repeat grouping/duplication retains fixed indices and hidden cropped content; compact loops materialize only when required | 05 |
| A17 | Local musical edits split/fork minimally; all-linked growth names every affected window and fails without partial application | 05 |
| A18 | Compact 25-action history/cursor survives CLI↔GUI/save/load/native round trips; topology and external-conflict reset rules are explicit | 05 |
| A19 | Full-definition and selected-context audition preserve transforms/rests; stop restores current song state without stealing another client's runtime | 05 |
| A20 | CLI↔GUI↔API/native round trips retain format features, IDs, sharing, history, rack/routing/mixer and controller mappings | 06 |
| A21 | Live schedule, captured MIDI and both CSD modes agree on representative attacks/releases, velocities, CCs and crop chasing | 05, 06 |
| A22 | Extracted ZIP executes outside the checkout with no repository imports, all runtime assets, locked dependencies and writable external session paths | 06 |
| A23 | Existing legacy CLI, Composition Creator v2 handoffs and other packaged skills retain their entry points and behavior | 03, 06 |
| A24 | Skill-only creation and follow-up edits can use returned IDs/diagnostics without editing raw config or inspecting app source | 06 |

### Measurable efficiency fixture

Create a 128-bar 4/4 song with four fixed 32-bar sections, one two-bar bass motif, one two-bar drum groove, one two-bar drum fill and one bound long automation curve. A shared eight-bar drum group contains three groove references and one fill reference; each 32-bar section repeats that group four times. Each bass section repeats its motif sixteen times. The song ends at 512 master beats, and the automation curve spans that complete duration. Bass transposition differs by section through placement plans. Track counts follow musical roles, never pad-slot capacity.

Assert exactly three note/drum pattern definitions before adding automation, one curve definition and one shared drum-group definition. Repeated placements must not increase those musical-definition counts. A pitch-only edit creates zero patterns; changing notes in one selected bass occurrence creates one bass variation plus only required structural ancestors/windows. Applying the same spec twice is a no-op. In a separate single-clip variant with no neighboring collisions, extending its loop window and song end by 100 times changes scalar extent fields rather than generating 100 times more definitions, children or output records.

Task 03 completes the note/drum/transposition portion; Task 04 adds the automation assertions. Task 06 runs the entire fixture, including local editing and packaged execution. This sequencing keeps G3 independent of unfinished automation work.

Record input bytes, authored bytes excluding optional history, definition/reference counts, number of CLI calls and bounded response sizes for batch versus incremental construction. Normal mutation summaries must not contain complete note arrays; target at most 16 KiB for this fixture, with explicit paging for larger impact reports. Record cold/warm authoring and projection timings against the baseline; compact-loop work must not scale with virtual pass count. Backend resource limits remain unchanged.

## 6. Verification and delivery

Run focused tests as each task lands, then integrated suites at G6. New tests must exercise observable contracts and actual commands, including subprocess failures, rather than merely duplicating helpers. Backend behavior changes require API regression coverage in `backend/tests/test_api.py` and relevant service tests.

| Check | Command/procedure |
| --- | --- |
| Performance CLI | `PYTHONPATH=integrations/skills/orchestron-performance-creator/src uv run --extra dev pytest integrations/skills/orchestron-performance-creator/tests` |
| Composition handoff | Run the existing Composition Creator test suite with its own `src` on `PYTHONPATH`; retain v1/v2 interpretation |
| Backend | `uv run --extra dev pytest backend/tests` and `make backend-check` |
| Frontend semantic/UI compatibility | `npm --prefix frontend run check`; targeted clip/store/import tests during development |
| Packaging | `make -C integrations test` and `make -C integrations`; extracted-ZIP tests against an isolated fixture backend |
| Runtime | Versioned fixtures, actual browser-clock/Csound session, captured MIDI/CC and both CSD exports; Python/Cython parity if shared runtime paths change |
| Documentation | Markdown paths/anchors, executable command examples, `git diff --check`; use documentation-PDF skill and visual QA when manual sources change |

Do not run live checks against user performances. Preserve examples and build dependencies. If implementation changes UI layout/interaction, capture screenshots and update EN/DE/FR/ES help; keep the manual English-only. If examples/build inputs become part of the change, apply the additional frontend and Docker build requirements in AGENTS.md and report unavailable Docker checks as unperformed.

G6 requires recorded outcomes for A01–A24 and all six task gates, not just passing unit tests or an archive listing. Preserve unknown/unavailable checks as outstanding. Build and verify a versioned local ZIP, with hashes and the source revision in the implementation record. Installation or publication is a separate action; never patch an installed cache as the source of truth.
