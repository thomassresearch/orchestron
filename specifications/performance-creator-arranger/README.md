# Performance Creator: clip-arranger authoring

Status: **implemented; verification recorded**. Date: 2026-11-05. Analysis baseline: repository `110555f`, plugin manifest `0.1.4`, Performance Creator Python project `0.2.0`.

Update the Orchestron Performance Creator skill and standalone CLI to compose and edit songs using the current clip arranger: reusable definitions, fixed clip windows, repetitions, scoped transposition and instrument-bound automation. Every command must give an agent enough information to understand its result and choose the next action. Repeated material should remain shared unless a musical variation requires independent content.

This package contains six implementation tasks across all three stages identified in the gap analysis. The six tasks are implemented in the repository. Read [the implementation record](implementation-record.md) for actual contracts, test coverage, measured efficiency, runtime evidence and the locally built package. No installed plugin or user performance was changed.

## Reading order

1. [Implementation plan](implementation-plan.md): baseline, architecture, command and response contracts, cross-task acceptance matrix and verification strategy.
2. Tasks below: bounded deliverables, regression tests, exit criteria and dependencies.
3. [Implementation record](implementation-record.md): delivered contracts, actual checks, measurements, package identity and boundaries.

| Stage | Task | Dependency | Gate |
| --- | --- | --- | --- |
| 1 — Foundation | [01 — Contracts, inspection and validation](tasks/01-contracts-inspection-validation.md) | None | G1: authoritative, understandable diagnostics |
| 1 — Foundation | [02 — Reusable authoring and migration](tasks/02-authoring-and-migration.md) | 01 | G2: atomic, lossless clip construction |
| 2 — Song authoring | [03 — Song specifications, reuse and transposition](tasks/03-song-specifications-and-transposition.md) | 02 | G3: compact, retry-safe song creation |
| 2 — Song authoring | [04 — Instrument automation](tasks/04-instrument-automation.md) | 02; 03 for complete song-spec integration | G4: owned automation and coordinated live updates |
| 3 — Editing completeness | [05 — Structural editing, history and audition](tasks/05-editing-history-and-audition.md) | 03, 04 | G5: precise revisions with playback parity |
| All stages — Delivery | [06 — Skill workflow, verification and packaging](tasks/06-skill-verification-and-packaging.md) | 01–05 for completion; documentation accompanies each task | G6: usable, tested standalone plugin |

Dependencies describe implementation order, not a requirement to delegate work to multiple agents. Stage 3 is required for completion; it is not an optional future extension.

## Scope and authority

Use the existing arranger's musical and persistence contracts. Keep the current five source types and their editors, timing, routing, mixer, native bundles and export behavior. Prefer the lowest compatible current performance format; no new musical format is assumed necessary. A CLI response/schema version is independent of the performance, clip, runtime-schedule, app-state and native-envelope versions.

The current app remains the semantic authority for editing operations. Source and current implementation records take precedence over older preview prose. In particular, shared transposition and instrument automation are already implemented in the app; this project exposes them to the agent workflow.

- [Repository working rules](../../AGENTS.md) and [backend contracts](../../BACKEND.md).
- [Clip arranger implementation record](../redesign-arranger/implementation-record.md) and [user workflow](../../documentation/performance/clip_arranger_preview.md).
- [Transposition implementation record](../clip-transposition/implementation-record.md) and [acceptance scenarios](../clip-transposition/acceptance.md).
- [Instrument automation](../../documentation/performance/instrument_automation.md).
- [Performance Creator skill](../../integrations/skills/orchestron-performance-creator/SKILL.md) and [plugin packaging procedure](../../integrations/README.md).

The broader arranger default-rollout gate is separate. Implementing or packaging this CLI update must not enable that gate, alter synthesis algorithms, add opcodes, modify developer examples, or automatically migrate a saved performance. Building a local plugin ZIP does not install or publish it.
