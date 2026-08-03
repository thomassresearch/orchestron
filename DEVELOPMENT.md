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

## Refactoring rules

- Preserve REST, WebSocket, persisted-state, and export contracts unless a
  dedicated behavior-change task explicitly updates them.
- Keep structural moves separate from algorithm changes.
- Add characterization tests before splitting a high-connectivity module.
- Do not combine mass formatting or dependency upgrades with a refactor.
- Keep user-visible labels synchronized across English, German, French, and
  Spanish.
