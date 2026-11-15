# Sample Player first version

Status: **planned, not implemented**. Date: 2026-11-15.

Add a reusable Sample Player instrument to Orchestron. Every rack instance owns a MIDI note-to-sample map, accepts WAV and MP3 uploads, and plays samples as one-shots. Saved performances and native bundles preserve the maps and audio. Both CSD export modes include everything needed to render the selected instruments outside Orchestron.

## Reading order

| Document | Purpose |
| --- | --- |
| [Feature specification](specification.md) | User workflow, ownership, data contracts, audio behavior, persistence, compatibility, and export rules |
| [Implementation plan](implementation-plan.md) | Ordered work packages, source seams, dependencies, technical proof gates, and verification commands |
| [Acceptance scenarios](acceptance.md) | Concrete fixtures and required model, playback, persistence, UI, and export results |

## Required scope

- Independent maps for multiple instances of the same library instrument.
- One uploaded WAV or MP3 sample per assigned MIDI note, from 0 through 127.
- Mono and stereo playback at the sample's original pitch and speed.
- One-shot playback that survives ordinary note-off, with explicit forced-stop ownership.
- Save/Load, app-state recovery, instance duplication, and compatible CLI serialization.
- Complete native performance ZIP import/export, including original and canonical playback audio.
- Complete CSD MIDI and CSD SCORE render packages, including per-instance mappings and portable audio.
- A usable rack editor, integrated help in EN/DE/FR/ES, English user documentation, screenshots, and regression tests.

## First-version decisions

Use a normal MIDI-triggered patch containing one dedicated Sample Player node and provide a built-in starter. Keep existing musical instrument categories. Store maps on rack assignments and a deduplicated audio manifest in performance configuration. Decode uploads before playback into 48 kHz float WAV, retaining original uploads. Map editing requires the instrument engine to be stopped.

Ordinary note-off ends the input gesture, while the sample voice continues to its natural end. Repeated attacks may overlap. Source cancellation, lane suppression, explicit transport Stop, and Panic remain effective through a separate voice-lifetime contract.

Velocity layers, round robin, key ranges, pitch shifting, looping, gated playback, slicing, trimming, streaming long recordings, recording new samples, shared-map presets, and seamless map replacement during playback are outside this version.

The behavior above is the target contract. Proposed field names, new modules, numerical resource budgets, and next format numbers must be checked against current source during implementation. Refinements must update this package and its acceptance cases together.

## Feasibility and delivery boundaries

A preliminary local Csound 6.18 probe demonstrated independent same-note mappings, mono playback, MP3-derived stereo playback, silent unmapped notes, identical MIDI/SCORE PCM, and identical rendering after moving a ZIP package. It needed the existing numeric GEN01 filename-alias technique. That probe did not implement Orchestron integration, short-note one-shot lifetimes, source cancellation, or persistence; these remain required gates in this plan. Temporary probe files are not release evidence or test fixtures.

This package records the implementation plan only. It does not change application behavior, examples, user performances, deployed services, or installed plugins. Implementation is complete only when all required acceptance scenarios pass and the implementation record documents actual results.

## Governing references

- [Repository instructions](../../AGENTS.md), [backend reference](../../BACKEND.md), and [fixture rules](../../backend/tests/fixtures/README.md).
- [Performance controls](../../documentation/performance/performance_controllers.md) and [performance import/export](../../documentation/performance/performance_import_export.md).
- [Arranger and transport behavior](../../documentation/performance/multitrack_arranger.md) and [live status](../../documentation/performance/live_status_and_safety_controls.md).
- [Current clip contracts](../redesign-arranger/implementation-record.md) and [parallel-rendering contracts](../parallel-csound-rendering/contracts.md).

