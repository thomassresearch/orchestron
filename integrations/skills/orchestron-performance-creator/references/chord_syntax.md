# Melodic Chord Syntax

Orchestron melodic sequencer steps persist GUI-compatible root note plus chord labels.

Supported chord labels:

```text
none, maj, min, dim, aug, sus2, sus4, maj7, min7, dom7, m7b5, dim7, minmaj7
```

Accepted aliases include:

```text
C3      -> C3:none
C3m     -> C3:min
C3m7    -> C3:min7
C3min7  -> C3:min7
C3M7    -> C3:maj7
C3maj7  -> C3:maj7
C37     -> C3:dom7
C3:7    -> C3:dom7
```

Prefer explicit colon form in generated commands:

```bash
uv run python -m integrations.cli edit add-melodic \
  --channel 2 \
  --steps "s0=C3:min7/4s s4=F3:dom7/4s s8=Bb2:maj7/4s s12=G2:dom7/4s"
```

Token rules:

- `s0=` assigns an event at absolute step 0.
- `/4s` sustains the event for 4 steps by writing hold continuation steps.
- `.` is a rest in `--grid-pattern`.
- `_` is a hold in `--grid-pattern`.
- Note names must include octave, for example `C3`, `Eb4`, `F#2`.

Grid example:

```bash
uv run python -m integrations.cli edit add-melodic \
  --channel 2 \
  --grid-pattern "C3:min7 _ _ _ F3:dom7 _ _ _ Bb2:maj7 _ _ _ G2:dom7 _ _ _"
```

Avoid arbitrary MIDI note arrays unless the implementation later extends the persisted model. Raw voicings do not round-trip cleanly through the current GUI chord selector.

