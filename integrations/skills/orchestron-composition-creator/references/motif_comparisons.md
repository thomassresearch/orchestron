# Preserve an opening, compare endings, then compare harmony

Use this workflow when a motif has an appealing opening but its ending or harmonic
setting is unresolved. The recipes are experiments for tonal/modal material;
their names describe intentions, not guaranteed emotional effects. Listen before
accepting a candidate. Existing `answer` remains scalar transposition.

## Start from a selected motif

Use an existing accepted candidate, or run the original two-bar study from this
skill's directory, with a durable absolute session directory outside the package:

```bash
uv run --locked python scripts/start_motif_study.py /absolute/path/to/my-study
uv run --locked orchestron_compose serve /absolute/path/to/my-study
```

From another directory, add `--project /absolute/path/to/this-skill` and use the
absolute script path. The script initializes A aeolian, 108 BPM, 4/4, MIDI range
60–81, imports `assets/motif-study/seed.json`, renders it, and stops. It never
accepts the seed or chooses a variant. Use the returned candidate ID.

The teaching motif, “Looking forward”, is original material distributed under
the repository's MIT license. Its delayed E entrance, repeated E, rise to A and
rests identify the opening. It is not a reconstruction of a published song or
the unspecified listening example in the source essay. The JSON asset is the
musical source; MIDI, MusicXML and WAV previews are generated in the session.

Establish the comparison in one sentence: “Keep the first bar recognizable;
find an ending that suggests release while retaining forward motion.” Ask what
the listener wants to hear again, what identifies the opening, and what feels
unfinished. Record the actual answer in the candidate feedback.

## Four endings, one protected opening

After the user selects the seed, save that selection in the page or through
`review`. CLI review replaces the lock list, so include every desired range:

```bash
uv run --locked orchestron_compose review /absolute/path/to/my-study SEED_ID \
  --decision keep --feedback "Keep the delayed entrance and repeated opening" --lock 0:4
uv run --locked orchestron_compose compare-endings /absolute/path/to/my-study \
  --from SEED_ID --start 4
```

Refresh the audition page. All four candidates are pending and belong to one
round. Their opening, accompaniment, tempo, length and preview sound are shared.
The command adds `[0,start)` to inherited melody locks on the children, without
changing the parent's review. Leading/internal rests and complete notes touching
the opening are preserved. A note crossing the boundary stays whole; generation
starts at its end and records both requested and effective boundaries.

The remaining tail is divided into four equal rational units:

| Candidate | Tail recipe | Listening question |
| --- | --- | --- |
| Settled ending | Third → second → tonic; sustain tonic for two units | Is the arrival convincing or too final? |
| Suspended ending | Same approach; repeat and sustain the second degree | Does the unresolved destination invite continuation? |
| Higher peak | Third → new higher peak → sustained tonic | Does the extra reach help, or strain the phrase? |
| Spacious ending | Third → tonic, then two units of silence | Does the gap strengthen the hook or interrupt momentum? |

The tonic nearest the opening's last note is used where the brief's range permits
the approach. The peak must exceed both the original melody's highest note and
the approach note. New notes use the opening's final velocity. These are deliberate
simple recipes, not chord-aware cadence classification or automated lyric setting.
They retain the existing harmony, so “settled” can still feel tense against it.

This increment requires a monophonic first part. Conflicting inherited tail locks,
insufficient register, an opening filling the phrase, or an unexportable rational
grid fail the complete round before saving candidates. No protected note is cut,
no lock is removed and no quantization is applied. Explain the conflict and choose
a suitable boundary/register with the user; do not silently relax constraints.

Compare melody alone and with harmony. Describe each difference briefly, then
wait for selection. Distinguish immediate appeal, recognizable identity and
emotional fit; a higher peak need not win. Record why the chosen ending works.

## Two harmonic settings, exactly the same melody

Only after the user accepts an ending:

```bash
uv run --locked orchestron_compose compare-harmony /absolute/path/to/my-study \
  --from ACCEPTED_ENDING_ID
```

The default `assets/motif-study/harmonies.json` compares a tonic triad plus tonic
bass against a mediant triad plus mediant bass. In the A-aeolian study these are
Am and C. The melody is identical in both, including timing, velocity and rests.
Global key/mode metadata stays unchanged; this is a change of accompaniment.

The command replaces only the `harmony` part. Use `--part ID` to name a different
accompaniment part; if absent, it adds that part on a free non-percussion channel.
All other parts remain unchanged. Shared-channel harmony parts and the first
(melody) part cannot be replaced. The selected part's channel and program remain
stable. The original candidate remains available in its earlier round.

To customize the pair, copy the settings asset into the session and use
`--settings /absolute/path/to/harmonies.json`. Its version-1 schema is
`orchestron.harmony-comparison`: exactly two `settings`, each with a `label`, two
to six unique `degrees` from 1–7, and `bass_degree` from 1–7. Shared `octave` (1–6,
default 3) places the tonic; `velocity` (1–127, default 54) applies to both settings.
Each chord is held for the complete phrase, with its bass one octave below the
specified degree. These are static diatonic settings; use authored scores for
changing chords, chromatic harmony or detailed voice leading. Long held chords
must still fit the exact export pad limits.

Listen in mix mode; solo previews should sound identical. Keep renderer, level
and listening conditions consistent. Fixed renderer gain does not guarantee equal
perceived loudness. The neutral fallback does not simulate a final Orchestron patch.
Ask what the harmony changes about the same notes before proposing an emotion.
Do not treat every sustained extension or non-triad tone as a mistake.

## Preserve decisions and export

The existing comments, reviews and creation history record the decision and its
inputs. Each new command stores actual before/after parts, resolved recipe or
harmonic pitches, inherited locks and the accepted parent's review. Comparison
rounds are atomic and undoable. Rendering happens after saving; repair a failed
preview with `render`, without generating the comparison again.

After the user selects a setting, export only the accepted candidate(s) in the
intended order, following [workflow](workflow.md#assemble-and-export). Alternatives
are not sequential song sections. Export and reimport retain the recorded chain.
The agent never accepts candidates on the listener's behalf.
