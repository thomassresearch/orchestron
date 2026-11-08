# Test fixtures

`parallel_render/grain_of_salt.json` freezes the live rack, routing, mixer and per-instance
controller overrides captured read-only on 2026-11-08. `grain_render_support.py` adds a
deterministic overlapping-note/CC sequence for native resource-ownership parity tests;
it does not claim to reproduce the saved musical arrangement. No test reads the live app
or developer examples. Capability-v3 planner snapshots change only input/plan digests.

`parallel_render/evening_at_the_lake_master_insert.json` overlays the original Lake snapshot
with the user's revised Master-compressor insert routing, captured read-only on 2026-11-08.
Library synthesis graphs are unchanged. The matching compressed configuration preserves the
saved arrangement for browser comparisons. Both variants remain versioned; tests load them
through `lake_render_support.py`, never from the live library or developer examples.

`patches/enough.patch.json` and `patches/logan.patch.json` are independent snapshots
of the editable altamax ports. `csound/altamax.orc` preserves the original dry
synthesis for native comparisons, with bus writes replaced by stereo output.
DSP tests cover register, velocity, release, polyphony, block sizes, controls,
Logan waveform equivalence and Enough's accepted FM approximation. API tests cover
native round trips, saved overrides and MIDI/SCORE exports; none load examples.

`csound/render_loop.csd` is the deterministic native K=1 render benchmark orchestra;
`csound/midi_sample_probe.csd` exposes note and controller delivery as exact sample
levels. Both exercise host MIDI without an OS MIDI device or audio output device.

`parallel_render/workloads.json` fixes the T01 native single-renderer baseline:
tiny, two/four/eight independent sources, shared delay and a serial-heavy source,
at K=1/32. The bounded builder in `backend/tools/_parallel_render_workload.py`
compiles synthetic LIVE mixer graphs with private delays, Master and direct paths.
It never reads examples. This fixture defines diagnostic workloads, not library
instruments; it does not activate a parallel renderer. See the
[baseline contracts](../../../specifications/parallel-csound-rendering/contracts.md).

`parallel_render/qualification_workloads.json` adds T07 diagnostic timing workloads:
two sources plus heavier four/eight-source variants with sixteen voices and 32 filters
per source. `backend.tools.benchmark_partition_render` compares native session rendering
with identical sequencing and verifies exact PCM, meters, markers, status and canonical
CSD separately from timing. These fixtures and synthetic planner costs do not qualify
automatic selection; browser/final-image evidence is a separate gate.

T07's IPC continuation adds `realtime_2/4/8`: sixteen total voices distributed over
two/four/eight independent sources, with six zero-resonance filters per voice. These
probe useful work near the measured deadline and branch-count scaling; the original
small and oversized workloads are retained. Names describe diagnostic intent, not a
promise of realtime qualification. Thresholds, K=32 and 512-frame requests stay fixed.

`parallel_render/planner_cases.json` defines T03 graph/resource variants and explicitly
synthetic cost inputs; `planner_snapshots.json` freezes 34 plans at K=1/32. The snapshots
include ordered owners/buses and hashes of all immutable metadata. The builder in
`backend/tests/render_plan_support.py` reuses the baseline inputs without native execution.
It covers private/shared/sidechain processing, bypass and Master inserts, custom ports,
disconnected work, legato/allocation helpers, MIDI initialization, unknown opcodes,
tables, assets and legacy fallback. These costs are not measured performance evidence.

`patches/trance_gate_original.patch.json` freezes the original CC24 stereo gate;
`patches/trance_gate.patch.json` adds the CC29 swept triangle LFO. Paired renders
verify sample-identical direct gating, analytic sweep timing, early returns,
retriggers, command latching, stereo/instance isolation and MIDI/SCORE exports.
Tests never load the authoring builder or developer examples.

`patches/ambient_rounded_sub.patch.json` and `patches/ambient_wavetable_cloud.patch.json`
are independent Ambient Techno snapshots. Native DSP tests cover CC scaling and
smoothing, explicit-channel isolation, note/release behavior, polyphony, tuning,
stereo output, timbre changes and parameter extremes. API tests cover library and
performance persistence, native bundles and both CSD export modes. They never
import the authoring examples.

Instrument patches used by tests live in `patches/`. Load a fresh `PatchDocument`
with `backend.tests.csound_test_support.load_patch_fixture` so tests can modify
their own in-memory copy.

- `branch_controller.patch.json` isolates a mapped setting in a note-selected
  Switch case. Export regressions cover unrelated notes, Default cases,
  sample-boundary writes, held voices and lossless reuse of numeric score fields.

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

- `autopanner.patch.json` freezes the continuous stereo Autopanner. Tests compare
  audio-rate gains to an independent sine oracle, including fractional beats,
  live/offline block sizes, exact depth-zero bypass, phase restart, stereo
  isolation, silence and bounds. API tests cover native round trips, instance
  settings and both CSD exports.

- `analog_drumkit.patch.json` is a fixed copy of the five-voice analog drumkit
  supplied when this fixture was added. Backend audio regressions and frontend
  template tests share this snapshot.
- `analog_drumkit_library_original.patch.json` preserves the later five-voice
  library instrument, including its four controllers and stereo output gain.
  `analog_drumkit_breakbeat.patch.json` freezes its 17-voice extension. Paired
  renders verify unchanged original sounds, GM assignments, velocity, tails,
  stereo output and all fifteen added performance controllers.
  `analog_drumkit_cymbals.patch.json` freezes the approved crash/ride revision;
  the earlier 17-voice fixture remains the reference for sample-identical renders
  of the other fifteen voices. Cymbal regressions cover spectral wash, short
  gates, controller extremes, overlapping tails and native/API persistence.
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
  The fixture also covers soft-register tuning and sustained low, middle and high
  notes. Tests never load the example builder or its baseline files.

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

The `curved` and `duplicate` cases now explicitly store their historical effective
end values, keeping their original closed-curve event sequences as compatibility
checks. Independent endpoints, missing-end defaults and adjoining open pads are
covered by `test_controller_curve.py` and the MIDI/SCORE API export tests.

`performances/rack_ordering.json` is a synthetic UI/persistence fixture with interleaved note-triggered and continuous instances, duplicate patches, controller overrides, sends, and an insert. It exercises rack/mixer ordering without compiling audio or reading developer examples.

`patches/steel_string_waveguide.patch.json` is the independent physical-guitar snapshot.
It covers local sample feedback, tuning, excitation, dispersion, decay, controllers,
polyphony, instance isolation, native rendering and CSD export without reading examples.

- `patches/stereo_widener.patch.json`, `patches/bit_crusher.patch.json`, and `patches/harmonizer.patch.json` are independent continuous-effect snapshots for DSP, persistence, controller, and export regression tests.

`sequencers/controller_steps.json` defines sparse controller steps, repeated values, explicit zero, reset initialization and selected MIDI channels for frontend/backend regression tests.

`sequencers/trance_gate_steps.json` freezes the CH16/CC24 double-speed pattern from
Trance Gate Demo - Psy Trance. SCORE regressions check every received step and
the stop reset at several host control-block sizes, independently of examples.

`patches/granular_capture.patch.json` and `sequencers/granular_capture_steps.json` independently cover MIDI-controlled capture, looping, granular DSP, step resets, native round trips and both CSD exports.

`patches/stereo_moog_filter.patch.json` is the independent continuous stereo filter
snapshot. It covers CC20/21 scaling, startup initialization, channel selection,
stereo separation, cutoff recovery, controller endpoints, native round trips and
MIDI/SCORE exports. Tests never import its example builder.

`patches/hsb_mono.patch.json` independently covers the HSB Mono instrument's
patch-local 20 ms pitch memory, monophonic fallback, instance isolation,
performance/CC controls, velocity, stereo output and release tails. Tests use
the existing compiler unchanged and never load its developer example.

`patches/goa_trance_fm_lead.patch.json` freezes the saved Goa lead that exposed
the `limit` input-rate mismatch. It covers init-rate MIDI pitch/controller formulas,
mixer compilation and native browser-clock audio without reading a live library.

`patches/goa_trance_fm_lead_crossfm_original.patch.json` preserves the later
cross-FM lead and its A♯5 filter instability. The paired
`patches/goa_trance_fm_lead_guarded.patch.json` adds per-channel Q guards.
Tests verify exact pole bounds, unchanged stable notes, controller corners,
native MIDI/SCORE audio, release, and native bundle/controller round trips.

`trance_gate_lfo_original.patch.json` freezes the swept-LFO graph before Stereo
was added. `trance_gate.patch.json` includes Stereo; tests verify exact previous
output at Stereo 0 without reading example files or importing its builder.

`sequencers/score.json` (fixture schema v1) provides matching authored and runtime Score Sequencer forms, independent sustains, a retrigger and hidden material in a ten-minute pad. Frontend, API, CLI and export regressions share this versioned fixture.

- `performance_controller_midi.patch.json` is a small DC-output probe with float, integer, bool and logarithmic controllers for per-instance CC mapping and native CSD export tests.


`clip_transposition/repetition_grouping.json` pairs a four-pass compact loop with
its v26 grouped Once representation and matching schedule-v2 projections. Frontend,
backend and standalone CLI regressions share its per-occurrence pitch expectations.


`parallel_render/partition_parity.json` freezes T04 MIDI, mixer/send/bypass changes and
render duration for sequential native partition comparisons. The instruments and routing
reuse versioned planner fixtures; tests never read examples. `t04_canonical_csd_hashes.json`
contains 90 CSD SHA-256 hashes produced once from the recorded pre-T04 compiler commit
(LIVE/MIDI and OFFLINE/MIDI/SCORE, 15 graph cases at K=1/32). Tests compare current output
against those hashes without reading Git or updating expected results. Wrapper platform options
are pinned to the recorded fixture platform, independently of the test host.

The parallel-render fixtures include `evening_at_the_lake.json` (the 2026-11-08 live
instrument/routing snapshot) and `evening_at_the_lake_config.json.gz` (the saved arrangement,
without undo history). Gzip has a fixed zero timestamp. These are independent of the live
library and developer examples; tests and isolated browser probes must use these snapshots.
