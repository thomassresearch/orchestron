# Algorithm and output contract

## Pitch and attacks

`vendor/rmvpe.py` contains the architecture and mel frontend from
[RVC revision 81eed5e8f68b6bed1789f682fe78cdd324495afc](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/81eed5e8f68b6bed1789f682fe78cdd324495afc/infer/rmvpe.py),
under its bundled `LICENSE-RVC.txt`. The unused application wrapper, CUDA graph
import and unused imports were removed. Network layers and mel calculations
retain checkpoint compatibility. The local wrapper loads float32 PyTorch weights,
uses a 16 kHz mono waveform, 1024-sample window and 160-sample hop, and pads mel
frames to a multiple of 32. Twenty-second chunks have one second of context on
each internal side, discarded on assembly. Long-context/chunk-boundary differences
are possible; inspect transitions near seams when an attack looks uncertain.

The [RVC checkpoint](https://huggingface.co/lj1995/VoiceConversionWebUI/blob/main/rmvpe.pt)
has SHA256 `6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193`.
Nine-bin local weighted cents decoding follows RVC. Retained confidence is the
maximum of the 360 sigmoid salience bins, including unvoiced frames. F0 below the
voicing threshold remains in `pitch.json` for inspection but is excluded from notes.

librosa HPSS, spectral flatness and high-frequency broadband flux identify clap
candidates. Harmonic energy trough/recovery supplies repeated vocal attack
evidence, with a clap exclusion window. Continuous pitches use within-voiced-run
median smoothing, sustained changes and robust note medians. The heuristics are
conservative, not a learned source separator: a clap exactly coinciding with a
soft vocal reattack may hide it; fricatives can resemble claps. Review these cases.

Same-pitch splits across at most 65 ms merge only without tonal attack evidence.
Longer gaps remain rests. Brief unstable phrase-edge pitch excursions can be
absorbed; stable short notes and internal gestures remain. Merged notes' pitches
are recomputed from original voiced frames. Every such operation is logged.

## Scale and tuning

Search 12 major and 12 natural-minor collections. For note medians `p_i` in MIDI
semitones, minimize `sum((p_i - m_i - delta)^2)` with each `m_i` in the collection
and `delta` in `[-0.5, 0.5]`. Notes have equal weight. Assignment midpoint breakpoints
partition the bounded tuning interval into quadratic pieces; each piece has an
analytic clipped-mean optimum. This jointly optimizes tuning and scale rather
than rounding pitches before estimating tuning or relying on one local minimum.

All globally tied candidates within `1e-6` squared cents are returned, including
relative major/minor and sparse-material ties. Separate equally optimal offsets
for one collection are retained. Preview selection is deterministic: error,
absolute tuning offset, tonic, then mode. If tied fits disagree on MIDI notes,
`ambiguous_pitch_mapping` flags it. This tie break is a rendering choice, not a
key claim. Positive tuning means the recording is sharp relative to its assigned
concert pitches. MIDI removes that tuning offset and snaps to the selected fit.
Raw medians and alternative fits remain available; chromatic melodies may fit
poorly and must not be described as confidently diatonic.

## Timing

Clap timing uses robust pulse regression with skipped-beat candidates and a
missing-beat cost. User tempo wins. Alignment comes from circular clap phase or
explicit beat zero. A downbeat/count-in cannot be inferred from claps alone.

A dynamic program jointly selects all start/end grid pairs, minimizing squared
boundary and duration error with a small eighth-boundary prior. It enforces
positive duration, note ordering, non-overlap and at least one cell for every
surviving inter-note rest. Leading/trailing rests of at least half a cell also
retain a cell (except a requested held ending). Candidate boundaries are within roughly two cells of
observed timing; infeasible density fails explicitly. No note is dropped to make
quantization succeed. Phrase-boundary cropping is separate and logged. Supplying
bars fixes exact duration; otherwise the phrase ends at the next full bar.

## Files

- `preview.wav`: FluidSynth-rendered piano preview of `melody.mid`.
- `melody.mid`: type 0, 960 ticks per quarter note; tempo/meter/program metadata;
  note-off before same-tick note-on; final end-of-track retains trailing rests.
- `notes.json`: schema version 1. `detected_notes` and `refined_notes` use seconds
  in the recording and fractional MIDI `pitch`. Final `notes` use quarter-note
  `start_beat`/`end_beat`, integer `midi_pitch`, velocity and stable IDs. Also contains
  input hash, model hash, detector settings, rhythm evidence, all scale fits,
  selected preview fit, requested phrase/ending, warnings and preview status.
- `pitch.json`: full continuous F0, voicing confidence and tonal attack times at
  a 10 ms frame hop. Frame zero corresponds to recording time zero.
- `edits.txt`: brief counts, tied fits, tuning and rhythm caveats for user review.

`notes.json.edits` is the complete ordered editorial ledger. Entries contain
`kind`, `before`, `after` and `reason`. Detection/refinement changes use Note
records in seconds. Scale changes retain fractional and snapped pitches. Rhythm
entries use explicit `start_beat`/`end_beat`; phrase crop/clip entries identify
their quarter-note units in the reason. A removed note has an empty `after` list.
Manual corrections must append equivalent records and regenerate all derived
outputs, retaining the original frame track and detection evidence.
