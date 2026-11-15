# Sample Player implementation record

Implementation baseline: `1154dd0`, clean workspace. Local Csound 6.18
(double samples), FFmpeg 8.1.1. The Docker arm64 runtime was built and tested
with Csound 6.18 (double samples), FFmpeg/FFprobe 5.1.9 (Debian 12).
Performance v27 and recovery state v9 were the next unused
versions. Version 1 maps are independent of the native ZIP envelope version.

The playback design schedules the complete patch as a finite score voice.
Live delivery uses the existing timestamped MIDI scheduler; ordinary release
does not control score voice lifetime. Offline MIDI and SCORE packages use the
same captured sampler attacks in the score, with ordinary MIDI notes retained
in the MIDI file for interoperability. Source cancellation is independent of
MIDI note ownership.

## Shipped interfaces

- `POST /api/assets/samples` takes a bounded WAV/MP3/M4A (AAC/ALAC) body and returns
  `{asset_id, asset}`. Original and playback filenames are content addressed.
  Asset IDs hash the pair of file digests; playback tables are deduplicated by
  playback digest and format metadata. FFmpeg creates a 48 kHz, little-endian
  float WAV, with no gain normalization. Imports verify the included canonical
  WAV rather than decoding the original again. The decoder revision is
  `ffmpeg-f32-v1`. Reuse the existing asset quotas and grace period for drafts.
- Authored maps use `sampleMap: {version: 1, entries: [{note, assetId}]}`.
  `sampleAssets` is the reachable manifest, including maps on unused instances.
  Session requests project these as `sample_map` and `sample_assets`.
  Underlying format versions for clips and native bundle envelopes are
  unchanged. The highest authored/recovery version takes precedence when
  sampler and clip features coexist.
- `POST /api/sessions/{id}/instruments/{binding}/sample-preview` takes
  `{action, gesture, note}` and uses a preview owner separate from sequenced
  events. The stopped rack creates a private preview session with the same
  routing. Configuration is immutable in a running session; changed maps take
  effect in the next session.
- The standalone Performance Creator CLI provides `edit samples list`,
  `assign`, `remove`, and `clear`, addressed by `--binding`.
  `assign` takes `--note` (0–127), `--file`, and explicit `--replace` for an
  occupied note. Mutations operate on staged configuration and refuse a
  running attached session. Save and rebuild the runtime to apply them.

## Playback and resource choices

Live Csound receives host score events against the normal patch instrument
number. Its MIDI channel does not spawn native Csound MIDI voices. A sample
voice retains its own source (including temporary layer and arpeggiator
feeder), slot, start, release deadline and natural end, even after the MIDI
note-off. Forced release ramps the full patch output for at most 5 ms from
the delivery boundary. A cancellation discards already queued attacks for
the same owner at or after its timestamp; a newly queued attack ordered
after the cancellation can play. Rescheduled live events still follow the
engine's ksmps timing.

GEN01 tables are preloaded via managed numerical aliases, with no load or
decode on attacks. Cap tables at 256 MiB (double width plus guard allowance),
voices at 64 per instance and 256 per engine, and decoded audio at 120 seconds
per file and the existing per-file byte limit. Up to two decoding workers
run concurrently with a shared 30-second deadline for the probe and decode.
Unaccepted attacks increment a bounded engine counter; offline exports
also list them in `WARNINGS.txt`. The sample resource forces single rendering.

Both CSD packages load canonical WAVs via relative `assets/soundin.*` names.
Captured sampler attacks and cuts project to the same finite score events
in both packages. MIDI mode also retains sampler notes in the MIDI file for
exchange; editing only that file does not change the captured sampler score.
Renders add the existing effect tail after the latest surviving voice or
the authored range, whichever ends later.

## Measured evidence

The [fixture notes](../../backend/tests/fixtures/sample_player/README.md) record
generation, expected frame counts and the shared digests. The ten-second WAV
and the stereo MP3 use 4,032,048 bytes in the table budget. Representative
measurements on the same arm64 host and fixtures:

| Operation | macOS host | Linux runtime image |
| --- | ---: | ---: |
| Decode both originals | 175 ms | 176 ms |
| Verify both manifests cold / cached | 2.21 / 0.26 ms | 1.46 / 0.09 ms |
| Start the live mixer, over three starts | 55–71 ms | 8–20 ms |
| Render 8,192 live frames at 48 kHz, ksmps=32 | 5.2 ms | 5.9 ms |

These are smoke measurements, not realtime deadline guarantees. The live
regression follows a 20 ms note-off with the ten-second sample still sounding,
then cancels one source while keeping an overlapping same-pitch voice.
Its PCM matches an isolated reference after the fade, including downstream
patch gain and Master routing. Native tests exercise 44.1/48 kHz, ksmps=1/32,
tiny edge fades, and 3,000 retriggers across three engine starts.
Standalone MIDI/SCORE renders from relocated packages were sample-identical
on each tested build, including a long tail with sourced WAV and MP3 audio.

## Verification and remaining qualification

- Backend: 3,514 passed with `uv run --extra dev --with pytest-xdist pytest
  -n 6 backend/tests -q`. This rerun supersedes an intermediate full run with
  five failures. The affected sampler, API, arpeggiator, lane and MIDI suites
  were rechecked after subsequent refinements. `make backend-check` and
  `make benchmark-runtime` passed.
- Frontend: lint, 1,458 tests and `npm --prefix frontend run build` passed.
  Standalone Performance Creator: 375 tests passed, including shared v27
  fixtures with the v4 clip model. The preserved analog drumkit input was
  present; `docker build --target frontend-build .` and the full runtime
  image build passed. Audio was qualified inside the running image as above.
- Browser: empty library, WAV/MP3 assignments, collision, running-engine
  lock, temporary preview, duplicated binding with an independent map,
  Save/recovery, keyboard opening at 390 px, labels and sample metadata in
  EN/DE/FR/ES, and all three downloads. The browser native ZIP contained two
  maps with two and one rows; source and playback member hashes matched.
  Both browser CSD ZIPs contained the same canonical files; API renders
  separately verified nonempty PCM, selective forced cancellation and tails.
  Chrome observed preview cleanup on collapse, view switch, New, Load
  and successful native ZIP Import.
- Docs: README, English manual, four-language rack/node help, three
  screenshots, manual manifest, rebuilt PDF and `make docs-check`.
  The Sample Player chapter and contents were visually checked in the
  PDF. The independent audit verified 206 pages, 62 contents entries
  and 664 internal links.
- Key acceptance coverage: M01–M06/M09; A01–A06/A08–A12; C01–C06/C08–C09;
  P01–P07/P13/P15–P17/P19; E01–E13/E16/E18; U01–U10.
  Existing endpoint and transport regressions also ran with the full suite.
- Physical external MIDI hardware (P20) was unavailable for a hands-on
  sampler run. Timestamped internal and external-source delivery use the
  same scheduler, and the backend suite includes the host bridge tests.
  The other individual matrix cases are not all isolated as dedicated
  end-to-end sampler scenarios; this record does not claim exhaustive
  release qualification.
