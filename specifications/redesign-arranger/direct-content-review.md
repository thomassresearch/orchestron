# Direct-content review — 2026-11-04

Reviewed the shipped implementation against the agreed direct-manipulation plan. This review adds removal and repairs the transaction, pointer and preview issues below. The overall plan is **not yet fully closed**: two workflow integration gaps remain.

## Removal and corrected defects

- **Remove selected**, its context-menu equivalent, and Delete/Backspace remove selected sibling occurrences at clip, group and supergroup levels. Musical definitions remain reusable. Empty containers are pruned; an empty clip leaves its timeline space. Local removal of an entire generated loop pass preserves the preceding/following passes rather than deleting the complete original clip.
- Moving content between two occurrences of the same definition now assigns a distinct destination occurrence ID when necessary. Subsequent selection/removal can address each sibling separately.
- All-linked saving rejects incompatible empty/nonempty edits to one definition, while propagating deletion through other unchanged uses. Identical structural edits to separate uses no longer conflict merely because their newly inserted occurrence IDs differ. Changed shared ancestors receive revision updates.
- Local preview geometry and commit share the same fractional-pass calculations. Once clips with existing trailing space no longer preview unnecessary extension. Save impact lists include content-only changes and newly created split windows, not just resized existing clips.
- Pointer release resolves its actual destination instead of using possibly stale React state. Invalid cross-container drops are not highlighted as valid. Edge scrolling continues while the pointer stays at the edge. Pointer capture transfers to the stable viewport once the drag threshold is crossed; model-derived insertion targets remain available when preview boxes are virtualized out. Destination breadcrumbs show container names and valid boundaries have an insertion line. Cancellation clears drag state; lost capture after a completed drop does not consume a later selection. Repeated Shift+Arrow advances keyboard focus. Structural undo/removal clears stale selections and returns focus to an existing ancestor container.
- Each save dialog defaults to local scope; an unavailable all-linked choice cannot be committed using a previously selected scope.

## Verification against the requested risks

| Area | Evidence |
| --- | --- |
| Cross-group moves | Component pointer tests start from a reloaded performance, move between shared groups, save with each scope, reload again, and verify the other occurrence. Real-browser pointer tests repeat both scopes through the actual API. Component coverage scrolls the source out of the rendered preview and completes the move through the stable viewport and model-based target resolver. The production browser also holds the pointer at the edge of a 40-pattern clip until the source unmounts, completes the move, saves/reloads and reopens the moved pattern on double-click. |
| Automatic growth | Model tests cover Once trailing space, full/partial Loop spans, source offsets, local pass splits, all-linked growth, Song end, and collision rejection. A real-browser insertion expands the edited local pass from 12 to 16 beats while retaining its 12-beat following pass and the other 24-beat clip. All-linked saving expands both 24-beat clips to 32 beats and Song end to 80, preserving their starts. |
| Removal | Model/component coverage checks clip/group/supergroup removal, both scopes, empty containers, unchanged linked uses, preservation of definitions, local middle-pass deletion, reload and undo. Browser Delete removes the last pattern from a shared group, removes its empty occurrences, and preserves the reusable definition through API save/reload. |
| Scope persistence | The real-browser matrix runs move, growth and removal × local/all, with API save/load both before and after each edit. Local saves preserve the linked clip; all-linked saves update both. |
| Audio separation | Existing Play edit/highlighting tests run in the full frontend suite. Structural component tests retain authored-state identity before Save. No audio-runtime/backend contract changed. This review does not claim new long-duration audio or hardware-MIDI stress testing. |

All 1,055 frontend tests in 98 files, ESLint, TypeScript and the production build pass with the clip preview enabled. The English PDF was rebuilt from 54 documents (199 pages); the updated removal text and screenshot pages were visually checked.

The browser work uses an isolated database populated from repository fixtures. No running Docker performance data was changed.

## Remaining plan gaps

1. **Legacy container-editor bypass.** Double-clicking a group/supergroup can still open the old `ContentEditor` through `ClipPerformance`. Its child-assembly controls update a single `DefinitionDraft`, rather than the structural transaction service. The new timeline controls and root inspector use the new service, but equivalent edits through the older container editor do not receive the same automatic-growth/combined-impact flow. Unify this path without removing container audition or changing the musical editors.
2. **Musical-draft conflict UX.** Structural edits/saves correctly block conflicting musical drafts and retain them, but use an error message requiring the user to resolve the musical editor separately. The plan's combined Save/Discard/Cancel transition flow is implemented for structural drafts, not for these musical-draft conflicts. Add a scoped resolver that preserves unrelated drafts and resumes the pending structural action after resolution.

Cross-track/cross-clip dragging, global libraries and automatic ripple movement remain intentionally outside the agreed scope; they are not missing implementation items.
