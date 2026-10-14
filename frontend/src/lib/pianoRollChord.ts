import type { PianoRollState, SequencerMode, SequencerScaleRoot } from "../types";
import { scaleDegreeForNote } from "./sequencer";

export function normalizePianoRollChordSize(value: unknown): PianoRollState["autoChordSize"] {
  return value === 4 || value === 5 ? value : 3;
}

/** Stack every other eligible pitch, including across octaves and mixed scales. */
export function pianoRollChordNotes(
  baseNote: number,
  size: PianoRollState["autoChordSize"],
  theories: ReadonlyArray<{ scaleRoot: SequencerScaleRoot; mode: SequencerMode }>
): number[] {
  if (!Number.isInteger(baseNote) || baseNote < 0 || baseNote > 127) return [];
  const eligible = (note: number) => theories.every(theory =>
    scaleDegreeForNote(note, theory.scaleRoot, theory.mode) !== null
  );
  if (theories.length === 0 || !eligible(baseNote)) return [baseNote];

  const notes: number[] = [];
  let position = 0;
  for (let note = baseNote; note <= 127 && notes.length < size; note++) {
    if (eligible(note) && position++ % 2 === 0) notes.push(note);
  }
  return notes;
}
