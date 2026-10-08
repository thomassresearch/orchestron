# Test fixtures

Instrument patches used by tests live in `patches/`. Load a fresh `PatchDocument`
with `backend.tests.csound_test_support.load_patch_fixture` so tests can modify
their own in-memory copy.

- `analog_drumkit.patch.json` is a fixed copy of the five-voice analog drumkit
  supplied when this fixture was added. Backend audio regressions and frontend
  template tests share this snapshot.
- `drumset.patch.json` is the original three-voice Switch patch used for note-off
  tails, polyphony, MIDI/score equivalence and bundle regressions.
- `velocity_if.patch.json` is the original velocity-switched sine/saw patch used
  for If-branch spectrum and decay regressions.
- `midi_legato.patch.json` is a small deterministic oscillator/envelope probe for
  MIDI and score phrase boundaries, priority, velocity smoothing and phase.
- `lake_bamboo_flute_legato.patch.json` is a fixed 59-node flute snapshot for
  phrase-controller, pressure-contour and stereo routing regressions. Tests never
  load its authoring script or the current library/export files in `examples/`.
- `steel_string_guitar_legato.patch.json` and `steel_string_guitar_polyphonic.patch.json`
  are fixed acoustic-guitar snapshots for fret-step continuity, pluck velocity,
  controller response, independent chord voices and native audio/export tests.
  Their audio harness accepts patch documents and never reads developer examples.

The two flute/legato fixtures were recovered from Git revision `cd21a23^`, preserving
the inputs for the existing audio assertions. Tests load the committed copies;
they do not read Git history at runtime.

The repository's `examples/` directory contains developer-provided instruments
and performances that can change independently. Do not load test data from it,
compare fixtures against its current contents, or regenerate fixtures from it
as part of a test run. Update fixtures deliberately alongside their tests.

Frontend tests use `frontend/vitest.config.ts` to resolve the production
drumkit-template import to this fixture. Its load guard rejects other module
dependencies on the developer examples. Production Vite builds use
`examples/instruments/template/analog_drumkit.patch.json`; tests do not need
that file or the `examples/` directory to exist.

`instrument_types.json` defines shared legacy-classification cases for the Python backend and TypeScript frontend. Keep both inference helpers aligned with these cases; no developer examples are read by the tests.

`legacy_master.patch.json` and `performances/legacy_master.json` are fixed neutral-Master migration inputs. They exercise v14 migration and audio equivalence without depending on developer examples.

`sequencers/timing_migration.json` is the shared frontend/backend/standalone-CLI legacy-to-meter timing contract, covering /8 tracks, nested rests, controller keypoints, workspace drafts and history. Existing `controller_curves.json` event offsets retain their historical 3,360-unit clock; current runtime tests multiply those expected offsets by six when checking the 20,160-unit clock.

`performances/rack_ordering.json` is a synthetic UI/persistence fixture with interleaved note-triggered and continuous instances, duplicate patches, controller overrides, sends, and an insert. It exercises rack/mixer ordering without compiling audio or reading developer examples.
