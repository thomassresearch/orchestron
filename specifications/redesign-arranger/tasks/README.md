# Implementation tasks

[Specification index](../README.md) · [Implementation plan and gates](../implementation-plan.md)

The six tasks now have an integrated preview implementation. Their acceptance gates are not all closed; see the [implementation record](../implementation-record.md). Each has a bounded result and a review gate. Implement the chosen arranger interaction while retaining the actual musical editor and live-input interfaces.

| Order | Task | Dependency | Gate |
| --- | --- | --- | --- |
| 1 | [Baseline and compatibility contracts](01-baseline-and-contracts.md) | None | G1 |
| 2 | [Clip model and migration](02-clip-model-and-migration.md) | 1 | G2 |
| 3 | [Playback, audition and exports](03-playback-audition-and-exports.md) | 2 | G3 |
| 4 | [Arranger and previews](04-arranger-and-previews.md) | 2; 3 for audio integration | G4 |
| 5 | [Existing editors, save scopes and live inputs](05-editors-save-scope-and-live-inputs.md) | 3, 4 | G5 |
| 6 | [Verification and cutover](06-verification-and-cutover.md) | 1–5 | G6 |

Keep the new workflow gated until its data, runtime, export and editing contracts work together. A gate blocks default rollout; it does not prevent independent read-only UI work. Each task must update its status and record concrete validation evidence when actually implemented.
