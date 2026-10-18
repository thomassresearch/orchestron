# Sung Melody Transcription Skill

This plugin skill transcribes a sung or hummed monophonic melody into MIDI,
note JSON and a playable piano WAV. Rhythmic claps can establish pulse timing;
they are treated separately from vocal attacks. You can supply tempo, meter,
bar count and an ending preference. The default meter is 4/4 with a sixteenth-note
grid, and the recorded ending is preserved.

The skill searches all major and natural-minor pitch collections while fitting
one tuning offset within ±50 cents. It reports tied collections, including
relative major/minor, rather than claiming a unique key. Conservative cleanup
merges false splits and removes brief unstable onset scoops and release dips;
the original pitch track and every editorial change remain available for review.

## Run and review

Ask a coding agent to read the
[skill source](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/sung-melody-transcription/SKILL.md).
For example:

> Transcribe this sung melody as four bars in 4/4. Use the claps for tempo and
> leave a short rest at the end. Return a piano preview, MIDI, notes and an edit
> summary so I can check the repeated notes and phrasing.

The skill requires Python 3.11–3.13, `uv`, the RVC RMVPE checkpoint, FluidSynth
and a piano SoundFont. The checkpoint downloader verifies its hash. The
[setup and command reference](https://github.com/thomassresearch/orchestron/blob/main/integrations/skills/sung-melody-transcription/references/workflow.md)
explains asset configuration and optional inputs. Python dependencies are locked
within the skill; transcription runs locally.

Review `preview.wav` against the recording, particularly repeated attacks,
short gestures, rests and the ending. `melody.mid` and `notes.json` contain the
quantized result; `pitch.json` retains continuous pitch and voicing evidence;
`edits.txt` summarizes the changes. Detailed before/after edits are in `notes.json`.
Requested bar counts define the exact MIDI phrase length, including silence.
Clipped or excluded notes are reported. FluidSynth's acoustic release tail may
continue after the final MIDI note-off.

Claps do not identify a musical downbeat, meter or count-in by themselves. Supply
beat zero when the phrase begins after a count-in. Without supplied tempo or a
reliable clap pulse, 120 BPM is explicitly marked as a review default. Dense or
ambiguous material may need a finer grid or manual review. The output is a draft
transcription, not an automatic confirmation of the intended melody.

## Plugin packaging and independent previews

The source lives under `integrations/skills/sung-melody-transcription/` and is
included in the Orchestron plugin ZIP. Install the plugin or ask the agent to
read the skill directly. Transcription and FluidSynth piano previews need no
Orchestron backend and do not create instruments, performances or native bundles.
Any later Orchestron import or instrument assignment is a separate workflow
after reviewing the transcription.
