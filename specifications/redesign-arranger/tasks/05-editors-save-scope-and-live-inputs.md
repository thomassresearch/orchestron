# Task 05 — Existing editors, save scopes and live inputs

Status (updated 2026-11-05): Contextual hidden-data/metadata and both-scope tests close the identified automated preservation gaps, reusing the production control/highlight/undo suites. Browser audition/reconnect and arp-input export checks pass. External MIDI hardware testing is deferred by user decision and does not block release. See the [acceptance follow-up](../acceptance-follow-up.md). Depends on: [Task 03](03-playback-audition-and-exports.md), [Task 04](04-arranger-and-previews.md). Gate: G5. Next: [Task 06](06-verification-and-cutover.md).

Implementation follow-up: [new regression/browser evidence and remaining gates](../acceptance-follow-up.md).

Evidence and remaining work: [implementation record](../implementation-record.md).

## Result

Users edit the real sequencers/arpeggiator directly from clip context, audition drafts, save at the correct reuse scope and use the current keyboard/manual controllers below the arranger. This is integration of existing musical UIs, not their redesign.

Read the [preservation checklist and interaction design](../ui-design.md) and [draft/transport contracts](../data-and-playback-contracts.md). Primary seams: existing bodies in `SequencerPage`, `ScoreSequencers`/`ScoreEditor`, `ArpeggiatorEditor`, controller editors, `PerformanceEditorState`, `PerformanceAudition`, keyboard and manual controller wrappers.

## Work

1. Host each current editor against a typed selected-definition draft and current lane settings. Retain all current controls, gestures, validation, presets, hidden data and local undo. Replace only the surrounding pad-workspace/source workflow with breadcrumb, compatible pattern picker, draft status, Play edit/Stop edit and Save.
2. Provide contextual group/supergroup child editing inside the selected clip. Reuse valid grouping/copy helpers without retaining a separate loose workspace. Keep library adoption and unused definitions accessible; remove fixed eight-pad navigation as the storage constraint.
3. Connect the save-scope dialog to Task 02 transactions at all three levels. Show target name/path, linked and nested-use impact, local variation naming, duration consequences and repeat-split preview. Default to local scope; cancel retains the draft. Handle stale revisions and invalid content without changing authored state.
4. Share one controller-curve draft between expanded clip and full editor. Reuse real interpolation/keypoints and current click/drag/double-click, endpoint snapping/Shift behavior. Add accessible inline position/value editing, map through cropped/repeated occurrences, and treat each gesture as one edit rather than one shared commit per pointer event.
5. Integrate Play edit with actual runtime commands and queued/applied/error status. Selecting another item must not silently switch the active audition. Preserve drafts across collapse/view switches and resolve them explicitly before performance replacement/save/export as specified.
6. Move the current fixed keyboard and configurable manual-controller rows below the arranger/editor, full width per device. Retain real channel/OMNI/CC, velocity/scale/autochord, knob/numeric, Start/Stop/Add/Remove behavior and limits. Apply the agreed compatibility treatment for extra legacy keyboards.
7. Remove the obsolete Arrangement/Manual pads selector from the new workflow, while preserving arpeggiator Arranger/Live clock settings and other legitimate playback/launch controls. Do not remove compatibility data or old readers prematurely.

## Validation

Run the Task 01 capability checklist through actual editors, not screenshots alone. Test melodic chord/hold/strum/timing, drummer inactive/hidden cells and ratchet ramps, score note IDs/hidden notes/undo, both controller datasets/reset/channels and arpeggiator input/hold/presets/seeds.

Test local/global/cancel at pattern, group and supergroup level, duplicate children, repeated passes, nested sharing, revision conflicts and save while auditioning. Check authored save/autosave/export never leaks unresolved drafts.

Exercise inline curve editing at crop/loop boundaries and at CC 0/127, independent endpoints and snapping, with pointer and keyboard. Exercise human inputs during song and editor playback, rapid Start/Stop, held notes/sustain, input removal, inactivity and explicit Live/Listening modes. Verify no stuck notes, premature engine stop or forced buffer reset.

## Acceptance

- The musical editors look and behave like the current production versions, with only contextual workflow changes.
- Every requested save scope and direct-curve interaction is usable and atomic.
- One fixed keyboard and current manual-controller rows sit below the arranger, full width.
- Current human-input routing, Start/Stop and buffer-policy behavior are retained.
- No new standalone live sequencer workspace or duplicate source-selection workflow is introduced.

## Stop and rollback boundary

Do not remove the old workspace surface until its required grouping, reuse, audition and draft behaviors are present in context. Preserve drafts on integration failures. Keep the new view gated if any existing musical capability is missing; a simpler mockup control is not an acceptable substitute.
