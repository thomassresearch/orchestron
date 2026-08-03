# Development checks

Run the complete local quality gate with:

```bash
make check
```

The gate runs the backend Ruff correctness checks and tests, followed by the
frontend ESLint checks, Vitest suite, TypeScript compilation, and production
Vite build. The individual targets are:

```bash
make backend-check
make backend-test
make frontend-check
make frontend-test
make frontend-build
```

Runtime performance baselines can be refreshed with:

```bash
make benchmark-runtime
```

## Refactoring baseline

Baseline recorded on 2026-08-03 before the architecture refactor:

- Backend tests: 259 passing.
- Frontend tests: 5 passing in one test file.
- Browser-clock median render/audio ratios for 16, 64, and 128 tracks:
  `0.002`, `0.005`, and `0.010`.
- Simultaneous pad-boundary medians for 16, 64, and 128 tracks:
  `0.066 ms`, `0.240 ms`, and `0.485 ms`.
- Highest observed 128-track boundary sample: `0.590 ms`.

Performance benchmarks are initially diagnostic rather than hard CI gates.
Machine-to-machine variance should be measured before selecting thresholds.

After the first refactoring tranche on the same machine:

- Backend tests: 265 passing.
- Frontend tests: 14 passing across three test files.
- Browser-clock median render/audio ratios for 16, 64, and 128 tracks:
  `0.002`, `0.006`, and `0.010` (effectively unchanged).
- Simultaneous pad-boundary medians for 16, 64, and 128 tracks:
  `0.058 ms`, `0.219 ms`, and `0.451 ms`.
- Highest observed 128-track boundary sample: `0.482 ms`.

The boundary improvement comes from compiling the set of sync-master track IDs
once when the sequencer configuration is built. The live boundary loop no
longer rescans every track for synchronization when no sync relationships are
configured. Treat the measured 7–12% median improvement as indicative until it
has been repeated across machines.

After the second refactoring tranche on the same machine:

- Backend tests: 269 passing.
- Frontend tests: 17 passing across four test files.
- `App.tsx` decreased from 3,128 to 2,728 lines after its localized copy catalog
  was extracted.
- `SequencerPage.tsx` decreased from 6,970 to 4,738 lines after localized copy,
  controller controls, curve editing, piano-roll rendering, and related pure
  helpers were extracted.
- `SessionService` decreased from 2,036 to 1,949 lines after browser-clock lease
  state and validation policies were extracted.
- Browser-clock median render/audio ratios for 16, 64, and 128 tracks:
  `0.002`, `0.005`, and `0.009`.
- Simultaneous pad-boundary medians for 16, 64, and 128 tracks:
  `0.057 ms`, `0.215 ms`, and `0.435 ms`.
- Highest observed 128-track boundary sample: `0.450 ms`.

This tranche is primarily structural. The benchmark results remain within the
expected run-to-run range while the production frontend bundle remains
effectively unchanged.

After the third refactoring tranche on the same machine:

- Backend tests: 284 passing.
- Frontend tests: 22 passing across six test files.
- `useAppStore.ts` decreased from 7,439 to 1,067 lines. Persisted-state/model
  helpers and the sequencer, performance-control, and transport action groups
  now live in focused store modules behind the unchanged Zustand hook.
- `App.tsx` decreased from 2,728 to 2,442 lines after pure application
  orchestration helpers were extracted.
- `SequencerPage.tsx` decreased from 4,738 to 3,457 lines after the pad-loop
  editor and page contracts were extracted.
- `SessionService` decreased from 1,949 to 1,603 lines. Admission control,
  connection ownership, Host MIDI bridge state/decoding, browser-clock
  calculations, and performance runtime construction now live behind focused
  coordinators while `SessionService` remains the locking and side-effect
  facade.
- `backend/tests/test_api.py` decreased from 9,333 to 6,202 lines after session
  lifecycle and sequencer API coverage moved to dedicated test modules with
  shared API test support.
- Browser-clock median render/audio ratios for 16, 64, and 128 tracks:
  `0.002`, `0.005`, and `0.009`.
- Simultaneous pad-boundary medians for 16, 64, and 128 tracks:
  `0.062 ms`, `0.220 ms`, and `0.441 ms`.
- Highest observed 128-track boundary sample: `0.574 ms`.

This tranche changes module ownership without changing REST, WebSocket,
persisted-state, or UI contracts. Runtime measurements and production bundle
sizes remain in the range recorded before the structural split.

## Refactoring rules

- Preserve REST, WebSocket, persisted-state, and export contracts unless a
  dedicated behavior-change task explicitly updates them.
- Keep structural moves separate from algorithm changes.
- Add characterization tests before splitting a high-connectivity module.
- Do not combine mass formatting or dependency upgrades with a refactor.
- Keep user-visible labels synchronized across English, German, French, and
  Spanish.
