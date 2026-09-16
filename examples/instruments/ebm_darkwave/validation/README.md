# Validation results

| Instrument | Default peak (dBFS) | Worst tested peak (dBFS) | Numerical checks | Spectral review |
| --- | ---: | ---: | --- | --- |
| EBM DW — Analog Brass | -21.9 | -9.2 | Pass | Inspected |
| EBM DW — Choir Drone | -10.5 | -2.7 | Pass | Inspected |
| EBM DW — Dark PWM Pad | -13.4 | -4.7 | Pass | Inspected |
| EBM DW — Dark Saw Lead | -20.6 | -9.9 | Pass | Inspected |
| EBM DW — EBM Analog Bass | -9.1 | -7.3 | Pass | Inspected |
| EBM DW — FM Bass | -9.4 | -9.0 | Pass | Inspected |
| EBM DW — Glass Bell | -11.8 | -4.6 | Pass | Inspected |
| EBM DW — Industrial Stab | -7.6 | -1.0 | Pass | Inspected |
| EBM DW — Noise Metal FX | -17.8 | -8.9 | Pass | Inspected |
| EBM DW — PWM Lead | -18.0 | -6.3 | Pass | Inspected |
| EBM DW — Resonant Pluck | -21.8 | -16.1 | Pass | Inspected |
| EBM DW — Sequencer Bass | -7.4 | -7.4 | Pass | Inspected |
| EBM DW — String Ensemble | -18.4 | -7.7 | Pass | Inspected |

Each instrument’s JSON report retains measured levels, controller overrides, source-graph hash, and local paths to its MIDI/WAV/CSD recordings and spectrograms.

Frontend production build: **passed**. Docker `frontend-build` target: **passed**. Shared analog-drumkit build input preserved.

Listening: **not performed by the agent**. The linked WAV auditions are available for listening and musical evaluation.

Library import and native round trips are recorded in `../library_manifest.json`. Existing-library preservation is recorded in `library_preservation.json`. No performance or current rack is modified.
