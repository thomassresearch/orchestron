# Sample Player acceptance scenarios

Status: **planned, not executed**. Date: 2026-11-15.

These scenarios verify the [specification](specification.md) through the [implementation tasks](implementation-plan.md). Record results in the implementation record when coding begins. Each case must test the real behavior at the appropriate layer; generated-code string assertions alone do not establish audio correctness.

## 1. Versioned fixtures

Create small synthetic, redistributable fixtures under backend/tests/fixtures/sample_player/ and a standalone Sample Player patch snapshot under backend/tests/fixtures/patches/. Supply generation/provenance instructions and expected hashes/metadata.

| Fixture | Purpose |
| --- | --- |
| A mono WAV at 44.1 kHz, approximately 0.5 s | Resampling, mono-to-stereo output, exact note mapping |
| B stereo WAV at 48 kHz with distinct channels | Channel preservation and per-instance independence |
| C original MP3 and its checked canonical WAV | Decode behavior and export without decoder dependencies |
| D ten-second identifiable sample | Very short MIDI gate, long tail, natural cleanup |
| E nonzero-edge and extremely short WAVs | Fixed edge fades, valid tiny playback, forced-stop ramp |
| F corrupt/truncated/unsupported/multichannel files | Validation and atomic failure |
| Two rack instances of the same patch | Same note mapped to different samples; shared-asset deduplication |
| Two sources sharing instance, channel, and note | Overlap, cancellation after note-off, lane ownership |
| Mixed performance | Sample player plus existing melody, drums, effects, automation, and current clip features |
| Old-format performance and app-state snapshots | Backward compatibility and version selection |

MP3 decoder outputs may vary across qualified decoder builds. Freeze the canonical file in fixtures; compare conversion against documented duration/channel/amplitude tolerances rather than requiring unrelated encoders to produce identical MP3 bytes. Once canonical files are fixed, CSD packages must use those exact files.

## 2. Model and ownership

| ID | Scenario | Required result |
| --- | --- | --- |
| M01 | Two instances of one patch map note 36 differently | Editing A never changes B or the library patch |
| M02 | Assign 0 and 127; submit -1, 128, fraction, boolean, duplicate note | Valid endpoints accepted; malformed input rejected atomically |
| M03 | Duplicate an instance and edit the copy | New assignment identity, independent map, shared immutable files |
| M04 | Omitted/empty map and unmapped note | Valid silence; no unexpected fallback sample |
| M05 | Several notes/instances reference one asset | Deterministic map order; one logical audio identity; bounded metadata |
| M06 | Missing asset, invalid hash/metadata, raw path, unknown map version | Useful error; no partial save, start, or export |
| M07 | Rename/edit same patch; remove its sample capability | Map retained; incompatible binding diagnosed, never silently discarded |
| M08 | Deliberately select a different patch | Only that instance's map clears through the documented transaction |
| M09 | Continuous, legato, branched, or multiple Sample Player nodes | Unsupported first-version graph shapes rejected clearly |
| M10 | Export/import the standalone instrument | Patch/capability preserved; performance maps never become library defaults |

## 3. Ingestion, storage and recovery

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Upload mono/stereo WAV and MP3 | Original retained; verified canonical 48 kHz float WAV and metadata returned |
| A02 | Different source rate, MP3 padding, float WAV headroom | Correct duration/pitch/channels; no loudness normalization or clipping |
| A03 | Empty, corrupt, truncated, unsupported, surround, or nonfinite audio | Rejected before assignment changes; useful reason |
| A04 | Byte, duration, storage, decoder-time, or decoded-output limit | Bounded failure, no lingering worker, no orphaned committed files |
| A05 | Cancel upload; switch/delete instance while upload runs | No late assignment to the wrong instance; cleanup/lease expiry works |
| A06 | Upload same content or same filename with different content | Safe reuse for matching identity; distinct content remains distinct |
| A07 | Decoder missing/fails locally or in runtime image | Clear actionable error; old mapping and existing assets untouched |
| A08 | Save/load and app-state recovery before Save Performance | Both authored map versions recover independently and completely |
| A09 | GC with saved performance, persisted recovery, active draft/session | All reachable originals/canonical files retained |
| A10 | Delete one of two referencing performances; abandon an upload | Shared files survive; abandoned unreferenced files become collectible |
| A11 | Failed native import midway through file/database commit | Entire new batch rolls back; pre-existing content remains unchanged |
| A12 | Repeated autosave and unrelated edits | No repeated decoding, binary-in-JSON growth, or audio refill blockage |

## 4. Realtime one-shot behavior

Use native Csound PCM plus runtime event/lifecycle observations. Run core cases at ksmps=1 and representative live block sizes, with supported engine rates and no OS MIDI device.

| ID | Scenario | Required result |
| --- | --- | --- |
| P01 | Same note in two instances, different files | Correct sample for each instance with isolated routing |
| P02 | 20 ms note plays ten-second D | Entire sample plays once after ordinary note-off, then voice/resources end |
| P03 | Hold input key longer than sample duration | No loop, restart, or retained silent synthesis voice |
| P04 | Velocity zero, multiple nonzero velocities | No attack at zero; agreed velocity scaling matches both export modes |
| P05 | Mono/stereo and 44.1/48 kHz engines | Correct channel order, original pitch/speed, expected edge fades |
| P06 | Repeated same-pitch attacks and chords | Independent bounded overlapping voices; old note-offs do not cut tails |
| P07 | Cancel source A after its ordinary note-off; B shares pitch/instance | A fades out; B continues unchanged |
| P08 | Lane mute/solo, drummer row IDs containing colons, arp dependencies | Correct source tails canceled; no cross-lane/channel kill |
| P09 | Explicit Stop/seek/removal versus ordinary rest/pad boundary | Only forced lifecycle events cancel tails |
| P10 | Arranger Stop with independently running Manual pads | Arrangement voices canceled; independent Manual voices/phase retained |
| P11 | Natural finite arrangement end | No new attacks; existing sample/effect tails drain |
| P12 | End preview/audition while song/manual voice shares note | Only preview voices cancel; prior playback restores correctly |
| P13 | Panic, engine teardown, queued attack, subsequent restart | No stuck/resurrected voices or retained stale map/table identities |
| P14 | Seek/range start causes existing score chase | Sample restarts at frame zero consistently; no claimed phase reconstruction |
| P15 | Near/over polyphony cap, equal-time attacks/cancels | Deterministic newest-attack rejection and bounded diagnostics |
| P16 | Fixed fades and forced cancellation on tiny/nonzero-edge samples | No invalid envelope duration; measured ramps follow contract |
| P17 | Downstream patch processing, Master/inserts, direct routing | Entire sample follows normal processing and mixer behavior |
| P18 | Parallel requested with unqualified sample resources | Explicit conservative single-renderer fallback; correct PCM |
| P19 | Thousands of retriggers and repeated session starts/stops | Stable table/voice memory; no per-note load/allocation leak |
| P20 | External input and internal sequencers | Same lookup/lifetime semantics; stable source ownership and timestamping |

P02, P07, P12, and P17 are prerequisites for accepting the compiler architecture. They are not deferred polish.

## 5. Persistence and compatibility

| ID | Scenario | Required result |
| --- | --- | --- |
| C01 | Save/Load, autosave recovery, duplicate, native round trip | Maps, manifest, original bytes, canonical bytes, and instance ownership preserved |
| C02 | Load existing supported performance/app-state versions | Empty sample state; existing behavior and fields unchanged |
| C03 | Sample data combined with latest clip/automation/transposition formats | Required versions selected without downgrading either feature |
| C04 | Unknown future version or missing required asset schema | Explicit rejection; no silent lossy normalization |
| C05 | CLI inspect, unrelated edit, save and runtime conversion | Sample maps/assets preserved and wire requests equivalent to frontend |
| C06 | Patch IDs remapped on import; performance renamed/overwritten | Samples remain assigned to intended rack instances |
| C07 | Stale save revision or invalid map | Previous stored performance remains unchanged |
| C08 | Serialization review | No runtime voice/table IDs, preview state, binary blobs, or backend paths |
| C09 | Unused/stopped rack instance has a map | Native persistence/export keeps the full map and assets |
| C10 | Same patch loses capability and is later repaired | Authored map remains available and usable after repair |

## 6. Native and CSD export completion

| ID | Scenario | Required result |
| --- | --- | --- |
| E01 | Native ZIP imported into an empty supported installation | Complete editable performance; all samples play without source-machine access |
| E02 | Original MP3 plus canonical WAV; repeated references | Exact bytes preserved; duplicate archive members avoided |
| E03 | Native bundle lacks source or playback member | Preview/commit fails before persistent mutation |
| E04 | Import instrument definitions only | No orphaned performance sample assets imported |
| E05 | Conflicting stored identity/content; selected import cancellation | Consistent rejection/remap and complete rollback |
| E06 | CSD selection omits an unused instance sharing a patch with a selected one | Correct selected map retained; omitted exclusive audio absent |
| E07 | Selected map contains notes unused in captured arrangement | Its complete map/audio remains available in the CSD package |
| E08 | CSD MIDI with short input gate | Note-off does not truncate sample; lookup and velocity correct |
| E09 | CSD SCORE with short p3 | Same one-shot result and controller initialization as MIDI mode |
| E10 | Move extracted packages; original asset directory inaccessible | Both modes render using only bundled files and supported Csound |
| E11 | MP3 source on destination with no FFmpeg/MP3 decoding dependency | Both CSD modes render from canonical WAV |
| E12 | Long sample starts just before range end | Full sample plus existing effect tail; no two-second truncation |
| E13 | Forced cancellation of one overlapping source | Both modes agree with live ownership; no channel-wide approximation |
| E14 | Finite range starts inside an existing score note | Same chased attack policy as live playback |
| E15 | Generated helper events, long tails, assets exceed configured limits | Useful bounded rejection/warning according to contract; no silent omission |
| E16 | Empty valid map on an assigned instrument | Exported silence is valid; no missing-file error or phantom sample |
| E17 | Mixer/route/instance controls and continuous effects | Preserved across native and both CSD paths |
| E18 | Exported source inspection | No backend absolute paths; sample mapping and lifecycle logic fully in package |

Compare MIDI and SCORE sampler PCM using the same canonical files, deterministic fixture, Csound build, and offline settings. Require sample-identical output where event boundaries are identical; document and bound any unavoidable existing timing quantization instead of hiding differences behind a broad audio tolerance. Separate this from general live/offline profile differences in unrelated mixer/control processing.

Validate file hashes, onset/end frames, channel identity, velocity ratios, and source isolation in addition to listening. The expected export end includes the latest surviving sample plus effect tail.

## 7. UI and documentation

| ID | Scenario | Required result |
| --- | --- | --- |
| U01 | Empty library and new performance | Starter available; empty map explained; no manual graph assembly required |
| U02 | Add/replace/remove notes, collision, failed upload | Atomic changes, useful feedback, old valid assignment retained on failure |
| U03 | Engine running with arranger stopped | Map edits locked; inspection available |
| U04 | Engine starts during a pending edit/upload | Stale transaction cannot mutate the running configuration |
| U05 | Keyboard operation and narrow rack layout | All actions reachable and labeled; no hidden required controls |
| U06 | Collapse/view switch/New/Load/Import during preview | Documented state retention/reset and correct preview voice cleanup |
| U07 | Two instances with same displayed patch name | Samples panel clearly identifies the edited instance |
| U08 | English, German, French and Spanish | Consistent UI/help; numeric MIDI note convention unambiguous |
| U09 | Save and all three export actions from UI | Real resulting files pass C01 and E01/E08/E09 |
| U10 | README/manual/screenshots/PDF | Delivered behavior documented; manual English-only and manifest/navigation valid |

## 8. Release evidence

All required cases above must pass or have an explicit unresolved status that prevents claiming completion. Record actual local and runtime-image Csound/decoder versions, fixture provenance, measured limits, startup/render/memory baselines, and regression commands.

Run the implementation plan's frontend/backend/CLI checks and instrument build gates, including npm frontend build and docker frontend-build. Qualify actual runtime-image audio separately. If Docker is unavailable, mark those checks unperformed.

Review the final native archive and both CSD archives as standalone artifacts. Confirm that source ownership, finite export tails, and garbage collection remain correct after ordinary note-off; those interactions are the principal first-version integration risks.

