# Setup and commands

Requires Python 3.11–3.13, `uv`, FluidSynth on PATH and a piano SoundFont.
Bank 0/program 0 is the default; use `--piano-program` and `--piano-bank` for
another piano preset. `uv.lock` fixes the Python environment: PyTorch, librosa,
NumPy, SciPy, mido and soundfile. The first `uv run --locked` installs it.
The RMVPE network is bundled with MIT attribution; its 181 MB checkpoint and
the user's SoundFont remain external assets. Nothing is uploaded.

From the skill directory:

```bash
uv run --locked sung-melody fetch-model /absolute/path/to/models/rmvpe.pt
uv run --locked sung-melody transcribe /absolute/path/to/voice.wav \
  --model /absolute/path/to/models/rmvpe.pt \
  --soundfont /absolute/path/to/piano.sf2 \
  --output /absolute/path/to/transcription-v1 \
  --tempo 100 --meter 4/4 --bars 4 --ending preserve
```

From elsewhere, use `uv run --locked --project /absolute/path/to/skill`.
`SUNG_MELODY_RMVPE_MODEL` and `SUNG_MELODY_SOUNDFONT` can supply the asset paths.
CPU is the portable default; `--device cuda:0` selects a compatible PyTorch GPU.
Use a close, clear monophonic recording; polyphonic singing is out of scope.
WAV/FLAC/OGG and other formats supported by the local librosa decoder are accepted.
Very short/silent/non-finite recordings and recordings over ten minutes fail.

| Option | Meaning |
| --- | --- |
| `--tempo` | Quarter-note BPM, 20–400; overrides inference. |
| `--meter` | Default 4/4. For 6/8, one bar is three quarter-note beats. |
| `--bars` | Exact positive bar count. Notes outside it are removed with logged edits; short recordings retain trailing silence. |
| `--beat-zero` | Recording time in seconds of the phrase's first beat; may be negative for a pickup. |
| `--ending preserve` | Retain the quantized note-off and trailing silence. |
| `--ending hold` | Extend the last note to the phrase boundary. |
| `--ending rest` | Leave at least one grid cell silent at phrase end. Fails if this would erase the last note. |
| `--grid` | 16 by default; 8 or 32 are available for explicit revisions. |
| `--claps auto` | Detect broadband transients for beat fitting and reject them as vocal attacks. |
| `--claps none` | Disable clap interpretation if detection is misleading. |
| `--voicing-threshold` | Default 0.03, in RMVPE sigmoid salience units. |
| `--fluidsynth` | Alternative FluidSynth executable path. |
| `--piano-program` / `--piano-bank` | Zero-based piano program (0–127) and bank (0–16383); both default to 0. These are written into MIDI. |

Claps are assumed to mark quarter-note pulses, allowing occasional missed claps.
They cannot establish meter or the musical downbeat. Automatic alignment chooses
a beat at or immediately before recording start, preserving leading silence.
Use `--beat-zero` to skip a count-in or locate the intended first bar.
Without a reliable pulse or supplied tempo, 120 BPM is explicitly marked as a
review default. Half/double-time interpretations remain possible.

Output directories must be new. Rendering failures leave the MIDI, JSON and edit
summary available for repair:

```bash
uv run --locked sung-melody render /absolute/path/to/transcription-v1 \
  --soundfont /absolute/path/to/piano.sf2
```

The renderer uses [FluidSynth's fast file renderer](https://www.fluidsynth.org/wiki/UserManual/),
44.1 kHz PCM WAV, the configured piano program, without chorus or reverb. Its acoustic release
tail can extend beyond the exact MIDI phrase length. It checks that audio exists
and is non-silent; this is not a substitute for listening.

For development, run `uv run --locked pytest` and `uv run --locked ruff check .`.
Network-free tests synthesize their own contours/transients; they do not depend
on Orchestron examples. The optional real-model smoke test requires the external
model and SoundFont:

```bash
SUNG_MELODY_TEST_MODEL=/absolute/path/to/rmvpe.pt \
SUNG_MELODY_TEST_SOUNDFONT=/absolute/path/to/piano.sf2 \
SUNG_MELODY_TEST_PROGRAM=0 uv run --locked pytest
```

It creates a synthetic harmonic melody, runs actual RMVPE and FluidSynth, and
checks notes, repetitions, phrase length and non-silent WAV. It does not establish
accuracy on a real singer. Model downloads verify SHA256 before use; model
loading uses PyTorch `weights_only=True`.
