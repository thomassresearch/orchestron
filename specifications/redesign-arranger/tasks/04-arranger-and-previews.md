# Task 04 — Arranger surface and type-specific previews

Status: Arranger surface and previews implemented; dense, responsive and accessibility release review remains open. Depends on: [Task 02](02-clip-model-and-migration.md); [Task 03](03-playback-audition-and-exports.md) before real playback integration. Gate: G4. Next: [Task 05](05-editors-save-scope-and-live-inputs.md).

Evidence and remaining work: [implementation record](../implementation-record.md).

## Result

The full arranger uses the chosen mockup layout: compact unselected lanes, expanded nested boxes, independent clip windows and honest type-specific previews. Build it with the existing application style and components.

Read [UI design](../ui-design.md) and [mockup qualifications](../reference/README.md). Primary seams: `MultitrackArranger.tsx`, `SequencerPage.tsx`, `arrangementRange.ts`, `PerformanceEditorState.tsx`, existing timing/pitch/curve helpers and the Task 02 resolver.

## Work

1. Compose the performance shell around the arranger while retaining rack, mixer, performance actions and global controls. Reserve the contextual editor and full-width playground positions; do not introduce replacement musical editors in this task.
2. Implement compact lanes around 48 px and selected-lane expansion. Render clip boundaries separately from content, nested pattern/group/supergroup boxes, rests, crop indicators and automatic repeat passes. Use persistent occurrence selection and breadcrumbs.
3. Connect draw/add, move/trim, offset, Once/Loop and Fit to pure transactions. Label clip and content lengths in explicit timing domains. Keep collision feedback, gaps, explicit time editing, range tools, loop selection, seek and mute/solo available.
4. Add default Note maps for melodic/score, velocity-gradient drum dots with supported ratchets/timing, parameter-only arpeggiator summaries, controller curves and step bars. Distinguish zero CC from no message. Do not import the older arp contour visualization.
5. Reuse typed resolution/sampling helpers and provide stable pitch/velocity scales, selective annotations and accessible descriptions. Repeated content indicators must not be confused with velocity. Only selected curve occurrences expose an editing affordance; Task 05 connects the shared draft.
6. Preserve collapse/selection/scroll/zoom state, end pointer gestures safely and suspend hidden preview work. Use visible-range rendering/caching where needed; rendering cost must not scale with every expanded repeat in a long song.
7. Provide keyboard alternatives, usable pointer targets, focused-dialog return and narrow-screen horizontal timeline scrolling. Ensure current labels/help are not contradicted by new preview terminology.

## Validation

Add component/domain integration tests for fixed clip boundaries on shared length changes, compact/expanded selection, nested/repeated occurrence targeting, cropping and range edits. Verify visual content against fixture data, particularly chord pitches, rests/holds, drum velocity ramps, sparse scores and controller zero values.

Capture browser screenshots of all source types at desktop and narrow widths, including nested supergroups, cropped/looped clips and keyboard focus. Confirm arpeggiator timeline previews contain parameters only. Use read-only fixtures until the runtime gate passes; do not call a simulated animation an audio validation.

Measure collapsed/visible preview work on the representative large arrangement; confirm playback status updates do not rebuild musical configurations.

## Acceptance

- Only the selected lane expands by default; nested containment and occurrence selection are clear.
- Clip/content timing remains separate in both display and edit actions.
- Every source type has the chosen compact preview with truthful semantics.
- Existing essential arranger operations remain accessible.
- The actual musical editors have not been replaced, forked or simplified.

## Stop and rollback boundary

Keep the surface behind its gate until geometry and selection are reliable. If preview resolution is expensive, reduce detail/render only visible material; do not trade away exact timing or audio continuity. Retain the old view for incompatible legacy data.
