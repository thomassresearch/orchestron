---
name: sung-melody-transcription
description: Transcribe a sung or hummed monophonic melody, optionally with rhythmic claps, into quantized MIDI, note JSON and a playable FluidSynth piano WAV. Use for audio-to-melody transcription and musical cleanup, with optional tempo, meter, bar count and ending preference; not speech-to-text, polyphonic transcription or Orchestron performance creation.
---

# Sung Melody Transcription

Use the skill-local `sung-melody` CLI. Resolve this directory from this `SKILL.md`;
it is packaged with the Orchestron plugin, while transcription and FluidSynth
previews run independently of Orchestron performances. Keep recordings and
outputs outside the skill.
Read [setup and commands](references/workflow.md) for dependencies, options and
recovery. Read [algorithm and output contract](references/algorithm.md) when
interpreting ambiguity, changing thresholds or making further musical edits.

## Transcribe and review

1. Use the supplied recording and any tempo, meter, phrase length or ending
   instructions. Default to 4/4, a sixteenth grid and the recorded ending. Resolve
   natural-language endings to `preserve`, `hold` (last note to phrase end), or
   `rest` (at least one final grid cell silent). Do not invent a cadence or change
   the final pitch. If a specific cadence is requested, make it a separate,
   explicitly logged musical edit after transcription.
2. Locate a verified RMVPE checkpoint and the user's piano SoundFont. The
   `fetch-model` command downloads the RVC checkpoint if needed. Use PyTorch
   RMVPE for F0; do not silently substitute pYIN, CREPE or a speech transcriber.
   Run `uv run --locked --project SKILL_DIRECTORY sung-melody transcribe ...`.
3. Inspect `notes.json`, `pitch.json` and `edits.txt`. Compare the melody's attacks,
   rests, contour and ending with the recording. Treat max RMVPE salience as
   voicing evidence, not a calibrated probability. Claps supply rhythm evidence,
   not automatic vocal attacks. Sparse melodies often fit many collections:
   report the tied fits, constant tuning offset and any differing note mappings;
   do not claim a unique key from a scale fit.
4. Keep stable brief gestures and genuine repeated attacks. The pipeline merges
   only plausible false splits and removes brief unstable edge scoops/dips.
   Prefer eighth-note simplicity only where timing is ambiguous. Requested bar
   counts define an exact phrase boundary; inspect every crop/clip and final rest.
   If the grid cannot preserve notes and rests, report the conflict and try a
   finer grid or ask about phrase length. Do not silently drop notes to fit.
5. Deliver playable `preview.wav`, `melody.mid`, `notes.json` and a brief edit
   summary. Link `pitch.json` for detailed inspection. Render the saved MIDI
   through FluidSynth with the configured piano SoundFont; a missing renderer or
   font is a recoverable dependency failure, never grounds to substitute a sine
   wave preview. Tell the user what was actually rendered and checked.
6. Present the result for user review; do not call it an accepted transcription.
   On feedback, create a new output directory and retain earlier versions. Every
   manual edit must append a `kind`, before/after values and reason to `edits` in
   `notes.json`, then regenerate MIDI/WAV and `edits.txt` from the revised notes.
   Preserve original pitch frames and detected notes. A change that cannot be
   inferred confidently should remain visible as an alternative for review.

Embed the WAV using its absolute filesystem path when the host supports playback.
Keep Orchestron instrument assignment, performance creation and import in a
separate, user-requested workflow. This skill produces ordinary MIDI/JSON/audio
and does not contact an Orchestron backend or author native bundles.
