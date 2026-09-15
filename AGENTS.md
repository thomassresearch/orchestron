# Orchestron Coding Agent Guide

Orchestron uses a React/TypeScript/Tailwind/Rete.js frontend and a FastAPI/Python/Csound backend.
Legacy paths and environment variables retain the VisualCSound name. Keep this guide below
400 lines and around 1,500 words; link to detailed procedures and source definitions.

## Working rules

- Keep `frontend/src` and `backend/app` API contracts and behavior aligned.
- Use `visualcsound-opcode-support` whenever adding or updating opcodes. Use the patch and
  performance skills linked below for instrument/performance authoring.
- For backend behavior changes, add or update regression tests in `backend/tests/test_api.py`
  and the relevant service tests.
- Keep instrument/performance test data in versioned test fixtures, independent of developer
  `examples/`. Tests must not read examples directly or through production imports. Frontend
  tests resolve the drumkit import to the shared `backend/tests/fixtures/patches/` snapshot.
- Instrument/example work must be additive. Preserve existing examples and templates, especially
  `examples/instruments/template/analog_drumkit.patch.json`, imported by
  `frontend/src/lib/audioTemplates.ts` and copied by `Dockerfile`. Native
  `*.orch.instrument.json` exports cannot replace that raw patch build dependency.
- Before moving, renaming, converting, or removing examples, use `rg` to find frontend imports,
  Docker copies, tests, and documentation/skill links. Update affected references together,
  preserve required inputs in `.dockerignore`, and include them in the same version-controlled change.
- Before finishing instrument/example changes, verify shared build inputs exist; run
  `npm --prefix frontend run build` and `docker build --target frontend-build .`.
  Report Docker validation as unperformed if unavailable. Patch/audio validation does not
  substitute for either build.
- For user-visible workflow/UI changes, update README and relevant `documentation/` pages.
  Ask the user for new screenshots to save in `screenshots/` when layout or interaction changes.
  Keep labels and integrated help consistent across EN/DE/FR/ES.
- README is for user capabilities, screenshots, and getting started. Preserve its title/opening
  through the user-documentation link and the full **Built With Codex** section unless the user
  requests changes. Keep implementation decisions here or in linked technical references.
- Preserve useful decisions as concise current contracts. Before removing detail from this
  guide, verify that a linked reference or source definition covers it.

## Commands and verification

Run from the repository root; select checks appropriate to the change. Documentation-only
changes need Markdown/link validation and `git diff --check`.

| Task | Command |
| --- | --- |
| Run / debug backend | `make run` / `make run-debug` |
| Frontend lint, tests, build | `npm --prefix frontend run check` |
| Backend tests | `uv run --extra dev pytest backend/tests` |
| Backend lint / full checks | `make backend-check` / `make check` |
| Render and sequencer-boundary benchmarks | `make benchmark-runtime` |

For preparation timing, run `.venv/bin/python -m backend.tools.benchmark_sequencer_preparation`;
it measures cold, cached, and one-pad preparation using the versioned TB303 test fixture.

## Critical architecture and compatibility decisions

### Audio runtime and live edits

- All runtimes use `browser_clock`. A dedicated browser worker owns PCM WebSocket refills and
  SharedArrayBuffer writes; AudioContext/AudioWorklet own playback. Csound renders on demand
  with `performKsmps()`; React observes PCM-timed audible markers outside the refill path.
- Internal MIDI uses an engine-local timestamped scheduler through `internal:loopback`, even
  without OS MIDI devices. Session **MIDI Input** selects optional external MIDI from the Rust
  host helper, including host timestamps.
- Keep Csound performance logging disabled normally to avoid blocking rendering through stdout.
  Temporarily enable `VISUALCSOUND_CSOUND_PERFORMANCE_LOGGING=true` for diagnostics.
- Live edits prepare in a persistent compiler process and apply at an engine block boundary
  without resetting transport. Buffering and synthesis settings are independent of preparation.
  Notes/curves edit the displayed pad; rapid edits coalesce after 80 ms.
- Playback/status updates and automatic pad changes must not resubmit full configurations.
  Queued launches retain loop-boundary timing. Stop cancels pending application.
- Failed preparation retains the previous playing configuration and edited draft, reports the
  error, and waits for another edit or explicit restart to retry. Shortening a finite arrangement
  past the playhead stops playback without rewinding.
- App-state validation, database work, and response serialization run in a worker thread so
  autosave cannot block audio refills.

### Instruments and graph editing

- Normal Save compiles; templates may save incomplete graphs and stay excluded from Perform.
  Built-in starters work with an empty library. Continuous instruments need no MIDI notes or
  inlet unless receiving audio; other types use MIDI activation.
- Preserve instrument types through save, clone, restored tabs, and native bundle round trips.
  Legacy inference defaults to Melody; existing always-on patches become Continuous.
- Stereo blocks wrap ordinary `inleta`/`outleta`; `outs` is Direct Audio Output. Keep nodes,
  channel mappings, and renames synchronized. Grouping/conversion preserves wiring and formulas,
  removes dedicated naming `const_s` nodes, and retains shared constants for other consumers.
  Apply cleanup to existing valid groups; repair performance routes after port changes.
- If/Switch choose one synthesis case per note. Membership transfers require connected endpoints
  and formula bindings to move together or already belong to the destination. Preserve graph
  ownership, case sizes, and formulas through save/reload and export/import.
- Draft audition is temporary: prepare before explicitly stopping and auditioning. Closing
  restores original state/playhead with transport stopped. Isolated audition uses patch defaults;
  performance audition uses the selected instance's overrides.

### Performance and persistence

- Tempo is global; sequencers retain independent meter, grid, and rational beat ratios.
  Preserve polymeter/polyrhythm without floating-point clock drift. Note and controller pads
  switch at loop boundaries; arpeggiators run in the backend with unique input MIDI channels.
- Arranger Play starts Pad Looper-enabled sequencers and stops others. Arranger Stop preserves
  manually started non-pad-loop sequencers and the rack engine. Piano-roll Start is independent
  of arranger playback; retain the documented seek/reset behavior.
- Rack/topology changes lock while instruments run; mixer controls remain live. Direct output
  bypasses Master but retains strip controls. Legacy Level migrates to dB audio gain, not velocity.
- Mixer persistence arrived in performance config v11; current serializers/CLI write v14 and
  accept v1–14. App state remains v2. Distinguish these from the native bundle envelope version.
  Preserve types, device names, routing, mixer state, and instance overrides across round trips.
- Master is the fixed `$master` endpoint, with no library patch or rack slot. Preserve its
  strip/inserts and direct-output bypass; see routing docs for legacy migration and backups.
- `perf_controller` values are per-instance I-rate settings: new notes adopt changes; continuous
  instruments require restart. Save Performance, native bundles, and both CSD modes preserve them.
- Collapsed panels suspend visual work and meter subscriptions while playback continues.
  Preserve drafts, selections, clipboard, zoom, and scroll on expansion. Collapse closes menus,
  cancels drags, and releases held notes. Temporary editor state resets on New/Load/Import;
  collapse preferences survive view switches until reload and are not performance data.

### Exports and limits

- Native bundles preserve the whole rack. CSD exports select assigned note instruments and
  routed/Master/insert continuous instances, counting stopped/empty devices and implicit direct
  continuous generators. Omit unused instances, routes, and exclusive assets before compilation.
- Both CSD modes seed enabled manual MIDI controller values and instance settings, render at
  48 kHz with `ksmps=1` and 32-bit float WAV, and retain always-on effect release tails.
  MIDI mode packages a MIDI file; SCORE embeds events and rewrites supported MIDI opcodes.
- GEN01/`sfload` require uploaded/imported assets; reject raw backend paths before compile/start.
  Keep asset bundling and render instructions consistent with the export reference.
- Enforce bundle limits before parsing, persisted JSON limits before storage, and GEN limits
  before storage/emission. Preserve session/observer/MIDI quotas and bounded offline exports.
  Read current values from settings and validators below; avoid duplicating default tables here.

## References by task

Read the relevant reference before changing a subsystem; these contain detailed contracts,
UI interactions, validation ranges, and operational procedures.

| Task | Reference |
| --- | --- |
| Backend services and APIs | [Backend reference](BACKEND.md) |
| Test fixture isolation and drumkit snapshots | [Fixture rules](backend/tests/fixtures/README.md) |
| Audio settings, MIDI, and live editing | [Browser clock](documentation/configuration/browser_clock_latency.md), [engine settings](documentation/configuration/audio_engine_settings.md), [live edits](documentation/performance/live_status_and_safety_controls.md#editing-during-playback) |
| Library, types, opcode defaults, and plugins | [Patch toolbar](documentation/instrument_design/patch_toolbar_and_tabs.md), [opcode catalog](documentation/instrument_design/opcode_catalog_and_documentation.md) |
| Graph interfaces, branches, and audition | [Graph editor](documentation/instrument_design/graph_editor.md), [control flow](documentation/instrument_design/control_flow.md), [audition](documentation/instrument_design/runtime_panel_and_compilation.md#audition-a-draft) |
| Devices, timing, and editor state | [Performance](documentation/performance/performance.md), [arranger](documentation/performance/multitrack_arranger.md), [manual index](documentation/user_documentation.md) |
| Mixer, effects, and instance settings | [Routing](documentation/performance/audio_mixer_and_routing.md), [effect implementation](EFFECT_INSTRUMENTS.md), [performance controllers](documentation/performance/performance_controllers.md) |
| Import/export formats and selection rules | [Instruments](documentation/instrument_design/instrument_import_export.md), [performances](documentation/performance/performance_import_export.md) |
| Resource defaults and validation | [Settings](backend/app/core/config.py), [JSON limits](backend/app/services/persisted_json_limits.py), [GEN validation](backend/app/models/patch.py), [export limits](backend/app/models/export.py) |
| Author instruments, formulas, and audio validation | [Patch creator skill](integrations/skills/orchestron-patch-creator/SKILL.md) |
| Author performances, routes, and runtime updates | [Performance creator skill](integrations/skills/orchestron-performance-creator/SKILL.md) |
| External MIDI and native timing probes | [MIDI setup](documentation/configuration/midi_setup_and_inputs.md), [host helper](host-midi-helper/README.md), [diagnostic tools](tools/README.md) |
| Docker publishing, recovery, and retention | [Release procedures](documentation/docker_images.md) |
