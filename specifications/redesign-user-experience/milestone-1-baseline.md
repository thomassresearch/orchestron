# Milestone 1 · Current Perform workspace

**Recorded 18 November 2026 at `fd7cdc0ff2e82f55b9f4158351ef4d7b2d87acb3`.** A musician can reproduce a scoped clip edit, a quantized legacy pad launch and an independent direct-output mix with the two performances below. At a 1440 × 900 viewport the arranger starts 1,835 CSS pixels down the clip page and 4,192 pixels down the legacy page. The clip snapshot forces melodic devices to Arrangement. Clip Stop can also show the wrong final position with the engine already running.

| Baseline artifact | Use |
| --- | --- |
| [Performance fixtures](baseline/performance-fixtures.zip) | Two importable songs captured before the edit and one empty config captured from **New**. |
| [Command and state-owner map](baseline/command-map.md) | Find a current control family, its handler or state owner, and its intended destination in Arrange, Live, Mix or the shared shell. |
| [Workflow results](baseline/workflow-results.json) | Inspect document geometry, per-fixture playback profiles, definition references, persistence comparisons, meter readings, timed transport observations, PCM hashes and test counts. |
| [Browser profiles](baseline/browser-profiles.json) | Compare future runs of the existing legacy collapse, clip layout and clip audio harnesses with the raw samples from this revision. |

## Replay the two performances

Use an isolated library with the clip arranger enabled. The current application saves its session while open. The [browser profiling instructions](../../frontend/tests/performance/README.md#clip-arranger-acceptance) show how to start the backend with a disposable database and assets directory, then point Vite at it. Open the Vite server's root page for the full application. The URLs under `/tests/performance/` run the separate profiling harnesses.

1. Unzip the fixture archive. Open **Perform → Instrument Rack → Import**, choose `legacy.orch.json`, and import the performance and its instrument definitions. Then import `clip.orch.json`, keeping the performance selected and unchecking the instrument definitions to reuse the same two patches. Both files were imported in this order into a fresh library. Each resolved both rack bindings. Use **Load Performance** to switch between them.
2. Both songs have a routed tenor voice on channel 1, a direct-output voice on channel 2, two melodic devices and a piano keyboard. The same authored pad material and 120 BPM clock make the formats comparable. **Routed phrase** goes through Master. **Manual lead** names the second device in both files. Its actual playback source differs by format. The clip song has two four-beat placements per lane, **Verse** and **Chorus**, initially referencing one pattern per lane. The legacy song uses two pad-1 placements. [Source performance](../../backend/tests/fixtures/performances/collapsed_gui.json) · [Routed patch](../../backend/tests/fixtures/patches/tenor_saxophone.patch.json) · [Direct patch](../../backend/tests/fixtures/patches/velocity_if.patch.json)
3. For the empty case, click **New**. The observed result was zero clip lanes, zero rack bindings, one keyboard and no open clip editor. The archive's `empty-config.json` is a config snapshot for comparison. Use **New** to recreate it.

### Musical and persistence checks

| Workflow | Current controls and observed result |
| --- | --- |
| Edit only the chorus | Load **UX Baseline Clip**. Double-click **Chorus** on **Routed phrase**, choose **Change scope** if shown, then **Create variation here**. Toggle the first step's **HOLD** and click **Save variation here**. Chorus acquired a new pattern definition, Verse retained its original reference and the entire original definition compared equal. The editor closed. |
| Launch a pad independently | Load **UX Baseline Legacy**. Click **Start Instruments**, then the device **Start** on **Manual lead**. Click **#2** while the device runs. The editing target changed to pad 2, the runtime reported pad 2 queued, and the active pad became 2 at the switch. The device launch worked without pressing arranger Play. |
| Trace direct sound through the mixer | With Manual lead still running, start **Routed phrase** and open **Mixer**. Both Master and Audio Output showed signal. Click **Mute** on Master. Its stereo peak fell to zero while Audio Output still measured 0.05175 on both channels. Mute **UX Baseline Direct** and final output fell to zero on both channels. The engine stayed running for the sequence. Peaks are snapshots of moving signals. [Deterministic mixer test](../../backend/tests/test_mixer_audio.py) |
| Save, replace and reload | On each song, change its description, click **Save Performance**, click **New**, then reload from **Load Performance**. The complete authored config compared equal before and after replacement, including the saved local variation for the clip case. Config versions were 23 for clip and 22 for legacy. |
| Native export and import | Click **Export** on each saved song. The import expansion endpoint returned the exported config unchanged. Reading and serializing it with the frontend's config reader reproduced the saved authoring snapshot. The separate fresh-library Import-dialog check above exercised patch creation and name-based reuse with the pre-edit fixtures. |
| MIDI and SCORE CSD | Export both modes from each saved song. Unpack each ZIP into its own directory and run `csound <exported-name>.csd` there. All four rendered 288,000 frames of finite stereo, 48 kHz, 32-bit float PCM. The MIDI-mode packages contained the accompanying MIDI file. Within each song the two modes produced byte-identical PCM payloads. Clip peak was 0.09303 after the local edit, legacy peak was 0.07142. |

### Compatibility and transport findings

**A clip song could not retain the requested mixed-source setup.** The starting config set the second melodic device to Manual pads. With a clip arrangement present, the frontend's snapshot builder writes `padLoopEnabled: true` for melodic, drummer, controller and arpeggiator devices. Both melodic devices loaded back as Arrangement in the clip song. The legacy song retained its Manual device. Clicking **Convert to clip arranger** there reported `Compatibility view: manual-source:manual` and left the authored snapshot unchanged. The current clip page also places device editing inside the occurrence editor. Milestone 2 should test an explicit Live edit target on the same device as an open clip draft. Supporting a *persisted* Manual device alongside clips requires resolving this snapshot behavior as well. [Config writer](../../frontend/src/store/appStoreModel.ts) · [Page composition](../../frontend/src/components/SequencerPage.tsx) · [Migration eligibility](../../frontend/src/lib/clipArranger/migration.ts)

**Clip Stop can finish with Pause highlighted.** Load the clip fixture with no loop selection, start the instrument engine separately, press arranger **Play**, **Pause**, wait three seconds, **Play** again, then **Stop** mid-song. Play advanced with nonzero output. Pause settled at a fixed position and the independently started engine stayed running. In two timed replays Stop initially reset the cursor to zero, then the position advanced again before settling away from zero. In the run with visible control readings, Position showed **0** at 100 ms and **4.88** at both two and three seconds, with **Pause** highlighted and Audio Output silent. An earlier fast sequence also timed out waiting to observe an inactive arranger at zero. Check the final displayed position, pressed button and engine state after queued audio drains when moving these controls. The measured delay is specific to this setup. [Transport controls](../../frontend/src/components/clipArranger/ClipTransport.tsx) · [App transport wiring](../../frontend/src/App.tsx) · [Timed samples](baseline/workflow-results.json)

## Browser measurements

The paired measurements used the complete React application, English labels, expanded Perform sections and the editor closed. Heights and vertical offsets below are CSS pixels measured from the document origin. The separately imported copies were used for the offset and playback checks.

| Paired fixture measurement | Clip | Legacy |
| --- | ---: | ---: |
| Document height at 1440 × 900 | 2,844 (3.16 screens) | 4,606 (5.12 screens) |
| Document height at 390 × 844 | 4,292 (5.09 screens) | 7,374 (8.74 screens) |
| Horizontal document overflow at either size | 0 | 0 |
| Save Performance / arranger heading / Piano Rolls heading at desktop | 336 / 1,835 / 2,257 | 336 / 4,192 / 3,677 |
| Main-thread task time during 1.5 s of arranger playback at desktop | 330 ms | 787 ms |
| DOM elements at both ends of that playback sample | 1,184 | 3,417 |

For the paired playback sample, start the engine separately, click arranger Play and begin sampling after the first positive arranger position. Each song advanced from 2,520 to 63,000 transport subunits over the sample. To repeat the measurements, read the root element’s `scrollHeight` and `scrollWidth`, use `getBoundingClientRect().top + scrollY` for each heading or button, and take the difference between two Chromium `Performance.getMetrics` task-duration readings. After the redesign, also check whether the transport, selected occurrence and its editor are visible together at these window sizes.

The existing instrumented harnesses exercise larger workloads separately. Measurements came from headless Chromium 139.0.7258.5 on macOS 15.8.3 arm64, Node 23.10.0, Python 3.13.2 and native Csound 6.18 with browser-clock audio. Timings are single local development-build samples. For comparisons, keep the fixture, disclosure state, viewport, instrumentation and sample duration together. [Harness setup and commands](../../frontend/tests/performance/README.md)

| Existing harness | Conditions | Observed result |
| --- | --- | --- |
| [Legacy collapse](../../frontend/tests/performance/measure-collapse.js) | 46 devices, 1440 × 900. Three seconds warm-up, then 15 seconds each expanded and collapsed. | Initial page 30,374 px tall. Collapsing reduced DOM elements from 21,635 to 125, React commits from 513 to 240, React render time from 12,474 to 273 ms and main-thread time from 14.999 to 0.721 s. Collapsed panel bodies and meters recorded zero render calls. Playback continued with zero additional underruns in both samples. |
| [Clip layout](../../frontend/tests/performance/measure-clip-arranger.js) | 16 → 16,000 beats, first lane compact and expanded. Widths 1440, 520 and 390 at normal and doubled text size. | Compact DOM 488 → 622 elements, expanded 514 → 807. No horizontal document overflow in the six size/text combinations. The text-size check leaves browser zoom coverage for the release milestone. |
| [Clip audio](../../frontend/tests/performance/measure-clip-audio.js) | Three 30-second samples, compact, dense expanded and dense collapsed. Edit, audition, seek and reconnect sequence. | Zero additional underruns in each sample, finite browser PCM with observed peak 0.07466, and live status after recovery. Main-thread task time was 2.657, 3.950 and 3.484 seconds respectively. |

## Compatibility regressions and rerun

The paired songs isolate the three musician workflows. Additional versioned fixtures exercise cases that would otherwise change the pair's routing or song structure.

| Case | Evidence exercised |
| --- | --- |
| Multiple instances of one patch, insert/return and direct signal | The rack fixture binds the lead twice and the effect three times, including an insert owned by the first lead. Rack-order and mixer tests cover binding identity, ordering, insert paths, return solo and Master bypass. [Rack fixture](../../backend/tests/fixtures/performances/rack_ordering.json) · [Rack tests](../../frontend/src/components/InstrumentRackOrdering.test.tsx) · [Mixer audio tests](../../backend/tests/test_mixer_audio.py) |
| Different sample maps on two bindings of the same patch | The two-kit fixture, Sample Player editor, native commit and relocated CSD tests exercise instance-specific maps, note selection, stereo sample identity and asset packaging. [Two-kit fixture](../../backend/tests/fixtures/sample_player/performance.json) · [Rack editor tests](../../frontend/src/components/sequencer/SamplePlayerRack.test.tsx) · [Native sample tests](../../backend/tests/test_sample_player.py) |
| Other sequencer families and independent clocks | The all-sources fixture, clip runtime tests and backend source-transport tests cover the other source types, arrangement/manual independence and timing. [All-sources fixture](../../backend/tests/fixtures/performance_creator/all_sources.json) · [Source transport tests](../../backend/tests/test_sequencer_source_transport.py) |

**169 frontend tests in 15 files and 134 distinct backend cases passed.** Four native parallel-renderer parameter cases initially selected the single renderer under sandbox limits. All four passed on a native rerun with parallel rendering available. The counts cover the selected suites. Browser PCM, meter observations and offline renders establish digital output. Physical speakers, external MIDI hardware and subjective listening were outside this run.

Run these selections from the repository root. The frontend file list and per-file counts are in the [workflow results](baseline/workflow-results.json).

```sh
npm --prefix frontend test -- --maxWorkers=2 SequencerPageManualPads EditingScope \
  ClipPerformance.test ClipPlaybackHighlight performanceWorkspaceGeneration internalMaster \
  SamplePlayerRack.test PianoRollKeyboard.test ClipContentActions.test InstrumentRackOrdering \
  InstrumentAutomation.test appStoreMixer.test CollapsedPerformance.test \
  useSequencerRuntimeController.test performanceCreator.test

.venv/bin/python -m pytest -q backend/tests/test_mixer_audio.py backend/tests/test_mixer_api.py \
  backend/tests/test_api.py -k 'direct or sample_map_persistence_native or sample_map_offline or performance_device_names_survive or clip_performance_round_trip or clip_exports_crop_score or clip_native_bundle or clip_transposition_persistence or compact_clip_history or performance_exports_preserve_strum or mixer'

.venv/bin/python -m pytest -q backend/tests/test_sequencer_source_transport.py \
  backend/tests/test_api.py::test_sample_csd_modes_render_identically_after_relocation \
  backend/tests/test_sample_player.py::test_instance_map_stereo_identity_and_unmapped_notes
```
