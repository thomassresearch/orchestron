# Sample Player specification

Status: **planned, not implemented**. Date: 2026-11-15.

This specification defines the first Sample Player release. The [implementation plan](implementation-plan.md) orders the work; [acceptance scenarios](acceptance.md) define completion. Existing behavior outside these additions remains governed by [AGENTS.md](../../AGENTS.md) and [BACKEND.md](../../BACKEND.md).

## 1. User workflow

1. Add the built-in Sample Player to the rack. It is available with an empty library through the existing starter workflow.
2. Open **Samples** on that rack instance. Add a row, choose MIDI note 0–127, and upload a WAV or MP3 file.
3. Display the note number, note name using the existing octave convention, filename, duration, and mono/stereo status. MIDI number is authoritative.
4. Audition the selected assignment through that instance's normal routing. Unassigned notes are silent.
5. Repeat for other notes. Add a second instance of the same patch to create an independent map.
6. Save the performance. Export a native bundle for editing elsewhere or a CSD package for standalone rendering.

The sample editor is available only for instances whose patch declares Sample Player capability. An empty map is valid and compiles to silence, with an understandable empty-state message.

Assignment, replacement, removal, and bulk clearing require the instrument engine to be stopped. A stopped arranger with the engine still running does not unlock editing. Inspecting the map remains available during playback. Do not automatically stop the engine to apply an edit.

Changing a note to an occupied number is rejected without overwriting either row. Upload failure or cancellation preserves the previous assignment. A pending upload disables saving/exporting that unfinished mapping transaction and reports progress; it never serializes a half-created asset.

Collapse/expand preserves selection and view state, cancels gestures, and releases preview ownership. New/Load/Import resets temporary editor state using existing conventions. Preview state never enters saved configuration.

## 2. Instrument and instance ownership

### 2.1 Library definition

Introduce a dedicated graph node, provisionally `sample_player`, with stereo outputs. Supply a ready-to-use patch wired into the ordinary stereo routing system. Instance volume/pan and downstream inserts continue to use the mixer.

For version one, allow exactly one root-level Sample Player node per MIDI-triggered patch. Reject use in Continuous instruments, inside If/Switch cases, or alongside `midi_legato`. This avoids ambiguous whole-patch lifetimes in the first compiler integration. Additional ordinary audio processing may follow its output, subject to the bounded lifetime contract below.

The patch contains playback logic and capability metadata; it contains no performance-specific sample assignments. Standalone patch Save/Compile and instrument export work with an empty map. Standalone graph audition reports the empty map; authoring temporary maps inside Instrument Design is outside this version.

Keep Melody, Percussion, Bass, Effects / Noise, and Continuous as the existing musical classification system. The starter may use Percussion; sample capability derives from the graph, never from a patch name or category.

Use the opcode-support workflow when implementing the node, including compiler, catalog, validation, icons, localization, documentation, and resource semantics.

### 2.2 Rack instance

A rack assignment owns its entire map. Two assignments referencing the same patch ID never share editable map state implicitly. MIDI channels retain the current uniqueness and range rules.

Duplicating an instance creates a new assignment ID and a deep copy of its map, with references to the same immutable sample assets. Editing either map does not mutate the other. Patch cloning does not acquire a performance map.

A deliberate switch to a different patch clears that instance's map as part of the normal patch-change transaction and displays a notice. Editing or renaming the same library patch must not silently discard saved maps. If its Sample Player capability disappears, retain the authored map, mark the binding incompatible, and block playback/export for that binding until it is repaired or explicitly cleared. Historical performances remain intact.

Deleting an instance removes its references from the current performance. Actual audio deletion follows reachability across all saved performances, recovered app state, drafts, and active sessions.

## 3. Authored and runtime data

### 3.1 Proposed authored representation

Extend each instrument assignment with optional `sampleMap`. Store its referenced assets in a performance-level `sampleAssets` manifest. This separates editable note mappings from deduplicated file metadata.

Illustrative fragment, with unrelated fields omitted:

~~~json
{
  "version": 27,
  "instruments": [
    {
      "id": "kit-a",
      "patchId": "sample-player-patch",
      "midiChannel": 1,
      "sampleMap": {
        "version": 1,
        "entries": [
          { "note": 36, "assetId": "sample-kick-a" },
          { "note": 38, "assetId": "sample-snare" }
        ]
      }
    },
    {
      "id": "kit-b",
      "patchId": "sample-player-patch",
      "midiChannel": 2,
      "sampleMap": {
        "version": 1,
        "entries": [
          { "note": 36, "assetId": "sample-kick-b" }
        ]
      }
    }
  ],
  "sampleAssets": {
    "sample-kick-a": {
      "source": {
        "stored_name": "source-a.wav",
        "original_name": "acoustic-kick.wav",
        "sha256": "<source digest>"
      },
      "playback": {
        "stored_name": "playback-a.wav",
        "sha256": "<playback file digest>",
        "sampleRate": 48000,
        "channels": 1,
        "frameCount": 24000,
        "format": "wav-f32le"
      }
    }
  }
}
~~~

A complete valid document must define `sample-snare` and `sample-kick-b` too. The abbreviated manifest illustrates the asset shape; it is not an executable fixture.

The exact file-reference model should extend/reuse the existing managed audio reference where appropriate. Backend-created references include measured byte sizes and retain existing identifiers as needed. Store source format and decoder revision for provenance. Playback audio and verified metadata are authoritative; never re-decode an imported performance merely because the current decoder has changed.

The map is a bounded list of unique strict integer notes; serialize in ascending note order for deterministic output. Asset IDs are stable opaque identifiers, independent of filename, MIDI channel, patch ID, and note number. Original filenames are display metadata and may collide.

### 3.2 Validation

Validate all entries, including maps on unused rack instances. Reject duplicate notes, booleans/fractions/out-of-range notes, unresolved asset IDs, unknown map versions, unsupported formats/channels, invalid hashes/metadata, and references outside managed storage.

The backend validates file identity, format, actual frame count, channels, and size. It must not trust client-supplied duration or a filename extension. Validate new/imported media fully, then cache verification by immutable identity and decoder/schema revision rather than decoding on every autosave.

A complete saved performance references every source/playback file needed by its maps. Prune manifest entries unreachable from that performance's maps when producing the persisted snapshot; this does not delete globally shared files. Maps on unused rack instances are still reachable and remain included.

Do not store waveform arrays, encoded audio, local filesystem paths, table numbers, voice IDs, preview state, or runtime caches in configuration.

### 3.3 Runtime projection

Add snake_case wire equivalents to session creation and validation: assignment `sample_map` and a request-level `sample_assets` manifest. Match aliases deliberately across frontend, Python models, export models, and CLI.

Resolve each map to immutable verified sample metadata before compilation. Pass it through `SessionInstrumentResolver` and `PatchInstrumentTarget`; no compiler reads the current frontend store or mutable performance record.

Compilation/cache identities include the instance mapping and playback content identity, channel/frame metadata, and Sample Player compiler revision. Display-only filenames and map-editor selection do not invalidate audio preparation.

## 4. WAV and MP3 ingestion

Accept WAV and MP3 only in version one. Determine the actual format by decoding/probing. Reject empty, corrupt, truncated, unsupported, or multichannel inputs with a useful error before changing the map. Support mono and stereo; do not silently downmix surround audio.

Decode to a canonical 48 kHz, 32-bit float, little-endian WAV. Preserve channel order, source speed, pitch, and amplitude; do not normalize loudness or clip floating-point headroom. Reject nonfinite decoded samples. Duration follows decoded frame count, including valid encoder-delay/padding handling provided by the selected decoder.

Retain the exact original upload for native export. If source and canonical playback are the same immutable file, a single stored file may serve both references. Deduplicate repeated content where practical; content identity must not conflate files with different audio interpretation.

Use a bounded decoder worker/subprocess, outside the event loop, MIDI scheduling, PCM refill, and Csound render paths. FFmpeg is the proposed packaged decoder; qualify the exact build used by local and Docker installations. Use an argument array, local-file inputs, explicit audio stream selection, time/output limits, and cleanup on cancellation. No network fetching or arbitrary path resolution is part of sample import.

Commit source, canonical playback, and metadata as one managed asset operation. A failure removes only files created by that operation. Shared existing content is immutable and never overwritten. Existing bundle commit rollback guarantees extend to these assets.

## 5. One-shot playback and voice ownership

### 5.1 Note interpretation

A delivered note-on with velocity 1–127 selects that instance's exact mapped MIDI number. Start at frame zero at original speed, independent of MIDI pitch. Different note numbers select different assignments; there is no root-note tuning or implicit pitch zone.

Velocity scales amplitude using the application's existing MIDI amplitude convention, identically in live, MIDI-file, and SCORE paths. Velocity zero is a note-off, not a new voice. Sustain pedal does not extend or loop a one-shot.

Mono is duplicated to the stereo output; stereo channel order remains intact. Read all frames once and stop. Do not honor embedded sample-loop metadata.

The first version uses a fixed linear edge fade of up to 0.5 ms at the start and 2 ms at the end, each capped at half the sample duration. Apply it consistently to canonical playback in every renderer, without altering stored audio. There is no editable ADSR or per-note gain/pan/tuning in this version; the ordinary patch/mixer controls remain available.

### 5.2 Lifetime and repeated attacks

The audible lifetime is determined by decoded sample duration, not the source MIDI gate or score p3. A 20 ms sequencer note must play a two-second sample to completion. A long held key must not repeat the sample or keep a silent synthesis voice alive after it finishes.

Repeated attacks, including the same pitch, create independent overlapping voices. A predecessor's ordinary note-off must not stop its own tail or a newer attack. Choke groups and same-note replacement are deferred. Polyphony remains bounded as described in section 8.

Whole-patch compilation must preserve the processing path for the sample's full lifetime. A detached child voice that bypasses the original patch processing, mixer, or inserts is not acceptable. Node-local envelopes that cannot extend the enclosing MIDI instrument are insufficient.

### 5.3 Ordinary release versus forced cancellation

Keep sampler voice ownership after ordinary MIDI ownership has been released. Track runtime-only voice identity, originating source, instance, attack sequence, and natural end. A single (channel, note) boolean cannot describe overlapping one-shots.

| Event | Required sample behavior |
| --- | --- |
| Ordinary note-off, key release, zero-velocity note-on | Continue to natural end |
| New attack on the same note | Start another bounded voice; old tail continues |
| Normal pattern boundary, rest, or change of selected map row | Do not restart or cut an already delivered one-shot |
| Explicit device Stop, source removal/replacement, running seek, or ended audition | Cancel voices owned by the affected source |
| Lane Mute or Solo suppression | Cancel that lane's active tails and suppress future attacks; preserve other lanes |
| Arranger Stop | Apply existing ownership rules; preserve independently running Manual-pad sources |
| Natural finite arrangement end | Stop future arrangement attacks; allow already launched one-shots and effects to drain |
| Panic or engine teardown | Terminate all relevant voices and pending work; no later resurrection |

Forced cancellation uses a short ramp, at most 5 ms, while the renderer is alive. Engine teardown may terminate immediately. Mixer mute/solo remains independent and retains its existing strip behavior.

The current scheduler's `release_sources` emits MIDI note-offs and its lane gate tracks note ownership. Extend the typed lifecycle path so forced cancellation remains distinguishable even after ordinary note-off consumed that ownership. Do not infer cancellation from every note-off or send channel-wide kills that silence another source sharing the instance.

External MIDI input receives a stable input-source identity. Treat All Sound Off and Panic as forced cancellation. Ordinary All Notes Off is an input release; samples still follow the documented one-shot contract unless the application explicitly issues Panic.

### 5.4 Seeking and previews

Reuse current note-delivery and score-chasing decisions. When the existing scheduler emits a chased note-on, it starts the selected sample at frame zero; there is no phase-accurate reconstruction of a sample already underway. Make that limitation explicit in user help. A CSD export starting within such a note uses the same rule.

Existing preview/audition layers retain their timing and restoration behavior. Ending a preview cancels only its sample voices. It must not kill an arrangement/manual voice on the same instance and pitch.

### 5.5 Compiler and render integration

Preload verified sample tables once per immutable playback asset per Csound engine, before playback starts. The same file may be shared across maps; lookups and active voice records remain instance-specific. Never run GEN01 allocation or decoding per attack. Free resources on engine disposal.

GEN01 plus a standard sample reader such as `loscil3` is the initial implementation direction. Reuse the existing numeric `soundin.<filecode>` workaround where required; qualify packaged paths on supported Csound builds. Use original-rate playback with engine-rate conversion rather than assuming all live engines run at 48 kHz.

Use the existing browser clock, MIDI timestamp scheduler, routing, and mixer. Add no browser audio playback engine or competing scheduler. Explicitly register immutable resource ownership in compiler analysis. Until parallel ownership is proven, conservatively select the existing single-renderer fallback; never silently qualify unknown shared tables for partitioning.

## 6. Persistence and compatibility

Save Performance stores maps and the manifest in configuration; managed storage retains source/playback files. App-state recovery preserves the current unsaved maps and manifest independently of the last saved performance. Save operations verify managed references without embedding audio in JSON or performing full decoding.

Extend all explicit constructors/normalizers, including frontend snapshots, app-state hydration, instance duplication, session requests, Python assignment/export models, bundle import remapping, and standalone CLI read/write/runtime conversion. Unrelated controller values, routing, mixer state, clip versions, automation, and arranger history must survive unchanged.

Current baseline maxima are performance v26 and app-state v8. Provisionally allocate v27 and v9 when sample data is present, after checking they remain available. Determine the required version from all features; a clip-v4 branch must not downgrade a sample-bearing performance to v26. Feature-free documents retain existing writers. Unknown future/map versions fail explicitly.

Native envelope versioning is separate. A new optional payload field must not cause old import paths to silently drop required assets. Establish an explicit feature/version rejection path; bump the native envelope only if compatibility testing demonstrates that existing envelope validation cannot protect the payload. Do not claim compatibility with unmodified old readers.

Standalone instrument bundles contain the Sample Player patch/capability, with an empty performance map. Importing only instrument definitions from a performance must not import orphaned performance sample assets.

Garbage collection must traverse saved performances, persisted app-state recovery, and active upload/draft/session leases. The current patch-only reference collector is insufficient. Expire abandoned leases with existing quota/cleanup semantics; temporary sessions cannot pin storage forever. Deleting one performance must not remove samples referenced elsewhere.

## 7. Complete exports

### 7.1 Native performance bundle

A performance with mapped samples exports as ZIP. Include:

- Performance JSON with all rack-instance maps, including unused/stopped instances.
- All referenced instrument definitions using existing native behavior.
- Source uploads and canonical WAV files under managed `audio/` members.
- Complete verified manifest metadata sufficient to restore mappings without re-decoding.

Deduplicate repeated physical members. Resolve archive paths through managed names; never store backend absolute paths. Native import preview validates the complete dependency closure, hashes, media metadata, versions, quotas, and name conflicts before commit.

Import commits selected patch definitions, performance, assets, and remapped identifiers atomically. Preserve map ownership while patch IDs are remapped. A valid same-identity/same-content asset may be reused; a conflicting identity/content pair must fail or be consistently remapped, never overwritten. Cancellation and failure leave existing library/assets unchanged.

A new installation must be able to import and play using only the ZIP and the supported application runtime. Both source and canonical files are required by this first-version native contract; missing members are errors, not silent redownload or re-decode opportunities.

### 7.2 CSD MIDI and SCORE packages

Apply existing CSD instrument selection before resolving instance sample dependencies. Include the complete maps of selected instances and their canonical WAVs, deduplicated across those instances. Do not trim individual mapped notes merely because they were absent from the captured arrangement. Omit exclusive assets of omitted instances.

Both modes emit per-instance note lookup and one-shot lifetime behavior into the CSD. Include canonical audio under `assets/`, any numeric aliases required by the loader, and accurate render instructions. Original MP3/WAV uploads are unnecessary in a CSD render package unless they are also the canonical file.

MIDI mode retains its MIDI file. SCORE mode embeds note/control events. Both keep note-on identity and velocity aligned and must retain one-shot duration after the corresponding note-off/score gate.

Standard MIDI does not encode source ownership. Preserve semantic cancellation metadata during capture. Where required, MIDI export may emit auxiliary lifecycle score/control events in the CSD keyed to deterministic attack identities; SCORE export uses the same identities. Do not approximate source-specific cancellation with a channel-wide All Sound Off. No Orchestron server or external control client may be required to execute those helpers.

Rendering settings remain 48 kHz, ksmps=1, and 32-bit float WAV. Include the existing mixer, routes, instance controls, and continuous effect processing.

### 7.3 Render end and export budgets

The current fixed two-second export tail is insufficient for arbitrary one-shots. Determine the latest surviving sample-voice end from captured attacks, forced cancellations, and canonical durations, then preserve the existing effect-tail allowance after that end.

Conceptually:

~~~text
renderEnd = max(authoredRangeEnd, latestSurvivingSampleEnd) + existingEffectTail
~~~

Compute in integer sample frames at the export rate, with consistent rounding. Do not generate new musical attacks after the selected range end. Keep effects alive through the entire extended tail. Source-note p3 is not a substitute for sample duration.

Retain current authored-range and event limits. Count generated helper/cancellation events, memory, and extended render duration in bounded export work. Exceeding a configured limit produces a useful rejection; no silent truncation. A ten-second sample launched just before the end must either render fully with its effect tail or be rejected before packaging.

The deliverable is the existing self-contained ZIP format containing CSD and assets, plus MIDI where applicable. Embedding all binary audio inside a single CSD text file is outside this version.

## 8. Resource and failure policy

Reuse existing upload, storage, persisted-JSON, and bundle limits from [settings](../../backend/app/core/config.py) and [JSON limit definitions](../../backend/app/services/persisted_json_limits.py). Account for originals, decoded files, import temporaries, aliases, and retained references. Do not increase shared limits silently.

Proposed new defaults for qualification, not descriptions of existing settings:

| Budget | Proposed first-version value |
| --- | --- |
| Map entries | At most 128 per instance |
| Audio channels | 1 or 2 |
| Decoded duration | At most 120 seconds per sample |
| Decoded file size | Must also fit the existing per-asset byte limit |
| Loaded sample-table memory | 256 MiB per session, accounting for actual Csound sample width and renderer copies |
| Active sample voices | 64 per instance and 256 per session |
| Decoder task | 30-second wall-clock timeout, plus streamed output and memory bounds |

Measure these defaults in T1 and encode confirmed values in settings/validators and shared fixtures. Table memory is not compressed file size; double-sample Csound uses more memory than float WAV storage. Total session checks count deduplicated resources and any parallel-engine replicas.

At voice capacity, reject the newest sample attack deterministically, leave existing voices intact, and surface a bounded diagnostic counter. Offline rendering applies the same policy and emits a warning if the authored workload exceeds polyphony. Never evict arbitrary voices nondeterministically.

Missing files or invalid maps fail before engine start/export. Failed uploads preserve old assignments. Failed native import rolls back its new files and database work. Save/export never silently removes invalid mappings. Normal feature-free performance behavior remains unchanged.

## 9. User documentation and delivery

Provide integrated help explaining exact-note mapping, original-speed playback, ordinary note-off, overlap, source Stop/Panic, engine-stopped editing, supported formats, and portable exports. UI/help labels are consistent in EN/DE/FR/ES. End-user manual prose remains English-only.

Update README capabilities without changing its protected opening or Built With Codex section. Add a user-facing manual page in the appropriate existing hierarchy, register it once in manual.json, and update navigation. Capture the real Samples editor and relevant error/locked states in screenshots/. Rebuild and visually verify the manual PDF when the implementation changes user documentation.

Keep technical implementation details in this package or BACKEND.md. Detailed waveform editing, per-note sound design, and developer resource identities do not belong in the first-version user flow.

## 10. Technical basis

Current integration points include [assignment types](../../frontend/src/types/index.ts), [snapshot normalization](../../frontend/src/store/appStoreModel.ts), [session models](../../backend/app/models/session.py), [compiler targets](../../backend/app/services/compiler_common.py), [asset collection](../../backend/app/services/gen_asset_references.py), and [CSD export](../../backend/app/services/performance_export_service.py).

Csound documents table loading and mono/stereo sample playback in [GEN01](https://csound.com/docs/manual/GEN01.html) and [loscil3](https://csound.com/docs/manual/loscil3.html). [FFmpeg](https://ffmpeg.org/ffmpeg.html) supplies the proposed decode/conversion path. These capabilities establish a technical foundation; the application-specific voice and export contracts above still require the implementation gates.

