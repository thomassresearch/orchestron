# Test fixtures

Instrument patches used by tests live in `patches/`. Load a fresh `PatchDocument`
with `backend.tests.csound_test_support.load_patch_fixture` so tests can modify
their own in-memory copy.

- `parametric_equalizer_original.patch.json` preserves the original three-band
  parallel-sum fault. `parametric_equalizer.patch.json` freezes its seven-band
  stereo cascade with linear dB controls and symmetric gain-compensated Q.
  Tests cover neutral unity, measured complex frequency response against an
  independent RBJ oracle, stereo isolation, extremes and persistence/exports.

- `tube_overdrive.patch.json` is an independent stereo insert snapshot for silence,
  asymmetry, drive/tone/output response, DC removal, headroom, stereo isolation,
  live/offline rendering and native import/export. Its audio harness accepts a
  patch document and never loads examples from tests.

- `stereo_delay.patch.json` freezes the continuous stereo delay with four performance
  controls. Sample-level tests cover dry preservation, echo timing/decay, stereo
  blending, overlapping input, fractional Beats, live/offline rendering and native
  persistence/export. The harness accepts a patch document, never an example import.

- `stereo_chorus.patch.json` preserves both controller IDs and the repaired variable
  LFO depth: twelve taps use base + Amount + LFO inside a 250 ms buffer. Tests cover
  silence, controller extremes, stereo dry gain and stable feedback at live/offline rates.

- `stereo_flanger.patch.json` freezes the six-control continuous stereo flanger.
  Tests measure signed feedback against an impulse oracle, audio-rate fractional
  delay sweeps, dry bypass, channel isolation, extremes and decay, plus native
  round trips, saved instance settings and both CSD export modes.

- `analog_drumkit.patch.json` is a fixed copy of the five-voice analog drumkit
  supplied when this fixture was added. Backend audio regressions and frontend
  template tests share this snapshot.
- `analog_drumkit_library_original.patch.json` preserves the later five-voice
  library instrument, including its four controllers and stereo output gain.
  `analog_drumkit_breakbeat.patch.json` freezes its 17-voice extension. Paired
  renders verify unchanged original sounds, GM assignments, velocity, tails,
  stereo output and all fifteen added performance controllers.
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
- `tenor_saxophone.patch.json` is the independent STK tenor snapshot for register
  tuning, velocity-controlled overblowing, legato fallback, controller extremes,
  stereo headroom, native bundles and live/MIDI/SCORE playback. Native audio tests
  require the Csound STK plugin and `RAWWAVE_PATH` pointing to its rawwave data.
  `tenor_saxophone_original.patch.json` preserves the pre-tuning sound. Paired
  normal-register renders measure harmonics 3–10 independently of gain and breath
  noise; the revised fixture also covers soft-register tuning and sustained low,
  middle and high notes. Tests never load the example builder or its baseline files.

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

`patches/steel_string_waveguide.patch.json` is the independent physical-guitar snapshot.
It covers local sample feedback, tuning, excitation, dispersion, decay, controllers,
polyphony, instance isolation, native rendering and CSD export without reading examples.

- `patches/stereo_widener.patch.json`, `patches/bit_crusher.patch.json`, and `patches/harmonizer.patch.json` are independent continuous-effect snapshots for DSP, persistence, controller, and export regression tests.

`sequencers/controller_steps.json` defines sparse controller steps, repeated values, explicit zero, reset initialization and selected MIDI channels for frontend/backend regression tests.

`patches/granular_capture.patch.json` and `sequencers/granular_capture_steps.json` independently cover MIDI-controlled capture, looping, granular DSP, step resets, native round trips and both CSD exports.
