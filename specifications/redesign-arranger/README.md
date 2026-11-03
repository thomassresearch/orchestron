# Performance view and multitrack arranger redesign

Status: integrated development preview, 2026-11-03. Implementation is based on repository revision `d82c682`; default cutover remains gated. See the [implementation record](implementation-record.md) for delivered behavior, verification and remaining acceptance work.

The multitrack arranger becomes the main place to compose a performance. Clips define when a source plays; reusable patterns, groups and supergroups define what it plays. Selecting a clip opens the existing sequencer or arpeggiator editor in that timeline context. A fixed piano keyboard and the existing manual MIDI controllers remain below the arranger.

**This changes the arranging and editing workflow, not the musical editors.** Reuse the current melodic, score, drummer, controller and arpeggiator interfaces and functionality. Remove their separate pattern workspace and obsolete Arrangement/Manual pads source selector from the new workflow; adapt selection, draft saving and audition around the existing controls. Retain the real keyboard and manual controller interfaces, including Start/Stop and buffer-policy integration.

## Reading order

| Document | Purpose |
| --- | --- |
| [Intent and scope](intent-and-scope.md) | User intent, chosen decisions, exclusions and representative workflows |
| [UI design](ui-design.md) | Layout, compact previews, nested editing, save dialog and preservation requirements |
| [Data and playback contracts](data-and-playback-contracts.md) | Clip timing, references, drafts, transport, migration and export behavior |
| [Implementation plan](implementation-plan.md) | Existing code seams, sequencing, risk controls and acceptance matrix |
| [Implementation record](implementation-record.md) | Implemented contracts, verification evidence and remaining release gates |
| [Task index](tasks/README.md) | Six independently reviewable implementation tasks and their gates |
| [Mockup reference](reference/README.md) | Durable copies of the chosen interactive mockup, provenance and limitations |

Open the [standalone mockup](reference/orchestron-preview.html) locally to inspect the chosen visual design. Its sandbox and CSP are preserved. It is a reference artifact, not app implementation, and has not been published.

## Authority and interpretation

1. The latest user requirements govern: keep the production editors and input devices, use Note map previews, show nested content on expansion, keep arpeggiator previews parameter-only, and allow direct curve-point editing.
2. These Markdown specifications capture that intent and qualify simplified mockup behavior.
3. The mockup establishes the layout and interaction concept; its toy musical editors, sample data, limits, transport simulation and buffer badge are not production contracts.
4. Existing source and documented musical behavior remain authoritative wherever this redesign does not explicitly change them. Older version numbers in manuals must not override current serializers and validators.

Decisions marked **chosen** express the requested design. Decisions marked **proposed contract** are concrete engineering defaults supplied by this plan; Task 1 must record their review before dependent implementation. This distinction prevents a prototype shortcut or an unresolved transport edge case from silently becoming a product requirement.

## Delivery sequence

| Task | Result | Depends on |
| --- | --- | --- |
| [01 — Baseline and compatibility contracts](tasks/01-baseline-and-contracts.md) | Characterized behavior, fixtures, editor seams and rollout gate | — |
| [02 — Clip model and migration](tasks/02-clip-model-and-migration.md) | Exact timing, reusable definitions, atomic edits and lossless persistence | 01 |
| [03 — Playback, audition and exports](tasks/03-playback-audition-and-exports.md) | Clip-aware scheduling with real engine and export parity | 02 |
| [04 — Arranger and previews](tasks/04-arranger-and-previews.md) | Compact timeline, expanded hierarchy and type-specific previews | 02; 03 before audio-enabled integration |
| [05 — Existing editors and live inputs](tasks/05-editors-save-scope-and-live-inputs.md) | Production editors in context, transactional saves, curve editing and playground | 03, 04 |
| [06 — Verification and cutover](tasks/06-verification-and-cutover.md) | Compatibility sign-off, accessible/localized UI, documentation and controlled release | 01–05 |

All new behavior stays behind a development/rollout gate until the corresponding checks pass. A UI rollback is not a downgrade of the saved data format. Preserve recoverable originals before migration and never open a new-format performance for writing through an incompatible old path.

The original mockup remains a reference artifact. The integrated implementation now changes frontend, backend and format readers/writers; no user performance data is automatically migrated.
