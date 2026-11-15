# Sample Player test audio

All files were generated from DC-offset sine waves by [generate.py](generate.py);
they contain no recorded audio. The second stereo channel uses a distinct frequency
to detect downmixing and swaps. Edges intentionally need a fade.

| File | Source | Expected canonical output |
| --- | --- | --- |
| `mono.wav` | 44.1 kHz PCM16 mono | 24,000 frames, mono |
| `stereo.wav` | 48 kHz PCM16 stereo | 12,000 frames, stereo |
| `stereo.mp3` | Stereo WAV encoded with FFmpeg 8.1.1/libmp3lame at 96 kbps | 12,000 frames, stereo |
| `long.wav` | 12 kHz PCM16 mono | 480,000 frames, mono |
| `tiny.wav` | 48 kHz PCM16 mono | 3 frames, mono |
| `surround.wav`, `corrupt.wav` | Three channels / incomplete RIFF | Rejected |

`stereo-from-mp3.f32.wav` freezes the canonical reference for the MP3 fixture.
The test compares converted PCM with a small amplitude tolerance across decoder versions;
archive renders use exact canonical bytes and must match sample for sample.

To regenerate the originals, run `python backend/tests/fixtures/sample_player/generate.py`
with the listed FFmpeg release. The [shared performance fixture](performance.json) records the
SHA-256 digests for the original mono/MP3 files and their prepared WAVs. When deliberately
refreshing it, use the upload service on those originals, update both matching asset IDs across
the maps and manifest, and replace the frozen MP3-derived WAV with the returned canonical file.
