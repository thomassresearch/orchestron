# Interactive composition workflow

The following commands run from this skill's directory. Use an absolute session
path so the same session can be resumed from any working directory. From the
repository root, prefix the command with
`uv run --locked --project integrations/skills/orchestron-composition-creator`.

## Explore and listen

```bash
uv run --locked orchestron_compose init /tmp/my-sketch \
  --title "Quiet currents" --key D --mode dorian --tempo 108 --bars 2 \
  --meter 4/4 --grid straight --low 60 --high 81 --seed 42
uv run --locked orchestron_compose generate /tmp/my-sketch --count 3
uv run --locked orchestron_compose serve /tmp/my-sketch
```

`/tmp/my-sketch` is an example for a disposable trial. Choose durable storage for
real work. `init` refuses an existing session. Python 3.13 and `uv` are required;
the lockfile pins the environment. First use downloads dependencies. Afterwards
the composition and audition workflow can run offline.

The page supports EN/DE/FR/ES, a melodic contour preview, audio playback/looping,
melody-only or accompaniment playback, and MIDI downloads. Only one candidate
plays at a time. Keep/Favourite/Reject/Undecided, comments and melody locks are
saved together by **Save selection**. Changes remain visibly unsaved until then.
Use **Refresh ideas** after the agent generates another round. Older rounds remain
available. A stale browser cannot overwrite a newer review: refresh and reapply it.

The agent waits while the user listens. The user returns to chat with “continue”.
No background automation is created and no page action resumes the agent by itself.

## Select, lock and develop

Read the actual returned candidate IDs; the following ID is illustrative:

```bash
uv run --locked orchestron_compose status /tmp/my-sketch
uv run --locked orchestron_compose show /tmp/my-sketch r1-12345678
uv run --locked orchestron_compose review /tmp/my-sketch r1-12345678 \
  --decision favourite --feedback "Keep the opening; vary the ending" --lock 0:4
uv run --locked orchestron_compose generate /tmp/my-sketch \
  --from r1-12345678 --operation vary --count 3
```

`review` records a selection actually made by the user, and replaces the prior
feedback and lock list. Supply all ranges when updating, e.g. `--lock 0:4 --lock 6:8`.
Positions are rational quarter notes, not seconds or bar numbers. Locks use
`[start,end)`; a sustained note touching a range is retained whole. Locks transfer
to descendant candidates. A fully locked phrase may yield no distinct variants;
the CLI reports this instead of silently removing locks.

| Operation | Development |
| --- | --- |
| `vary` | Shortlist of sequence, answer, inversion and cyclic variants |
| `answer` | Scalar transposition with register constraints |
| `invert`, `retrograde` | Inverted or reversed pitch contour in the existing rhythm |
| `isorhythm` | Cyclic pitch material against the retained rhythm |
| `additive`, `subtractive`, `scan` | arvo pitch processes projected onto the existing rhythmic slots |
| `tintinnabuli` | Triadic companion pitches in the existing slots |
| `continue` | Original phrase followed by a developed phrase; original notes stay intact |

Built-in development deliberately preserves rhythmic slots, rests and harmony.
To change rhythm, combine with an accepted `--rhythm-from ID` of equal duration.
To apply nuanced feedback, read the candidate score, edit a new copy using the
score contract, then `import-score --from ACCEPTED_ID` it as a new pending
candidate. This verifies and inherits the parent's melody locks, including locked
silence. The CLI does not interpret feedback prose. `--fresh` explicitly
requests unrelated starters. Seeds reproduce music, while IDs identify immutable
candidate instances. Duplicate variants are omitted, so a round can be smaller
than the requested count.

```bash
uv run --locked orchestron_compose generate /tmp/my-sketch \
  --from ACCEPTED_PITCH_ID --rhythm-from ACCEPTED_RHYTHM_ID --operation answer
uv run --locked orchestron_compose import-score /tmp/my-sketch /path/to/revision.json --from ACCEPTED_ID
uv run --locked orchestron_compose undo /tmp/my-sketch
```

## Assemble and export

```bash
uv run --locked orchestron_compose export /tmp/my-sketch \
  --ids ACCEPTED_A ACCEPTED_A ACCEPTED_B ACCEPTED_A \
  --title "Quiet currents" --output /tmp/quiet-currents-export
```

All IDs must be Keep/Favourite. Order and repetitions are explicit. Phrase tempo,
meter, key and mode must match. Trailing silence is retained. Outputs include the
canonical score, importable score, MIDI, MusicXML, audio and renderer metadata.
Export refuses an existing destination and publishes files only after rendering
succeeds. Play the assembled audio before the handoff; timbre in Orchestron will
depend on the instruments the user chooses.

`render SESSION --id ID` repairs missing previews; omit `--id` to render all.
`--soundfont /path/to/file.sf2` on generation, rendering, export or serving opts
into FluidSynth, as does `ORCHESTRON_SOUNDFONT`. Use the same renderer for a comparison.
Stop `serve` with Ctrl-C after the audition. The server binds only to 127.0.0.1;
keep the exact printed host and port.
