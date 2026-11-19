import type {
  DrummerSequencerPadState,
  ScorePadState,
  SequencerPadState,
  SequencerTimingConfig,
  SequencerStepState,
} from "../types";
import type { MarkovEvent } from "./markov";
import { buildSequencerStepChordMidiNotes, MODE_INTERVALS, SEQUENCER_SCALE_ROOTS } from "./sequencer";
import { SCORE_MAX_BEATS, SCORE_MAX_PAD_NOTES, SCORE_TICKS_PER_QUARTER, scoreBeatTicks } from "./scoreSequencer";

export type GeneratedPattern =
  | { source: "sequencer"; payload: SequencerPadState }
  | { source: "score"; payload: ScorePadState }
  | { source: "drummer"; payload: DrummerSequencerPadState };
export type PadAudition = { deviceId: string; pattern: GeneratedPattern };

export function scalePitches(pad: Pick<SequencerPadState, "scaleRoot" | "mode">, octave: number) {
  const root = SEQUENCER_SCALE_ROOTS.find((r) => r.value === pad.scaleRoot)!;
  return [...MODE_INTERVALS[pad.mode], 12].map((interval) => (octave + 1) * 12 + root.pitchClass + interval);
}

/** Read only audible source material whose attack is inside the edited pattern. */
export function patternVocabulary(
  pattern: GeneratedPattern,
  timing: SequencerTimingConfig,
  selectedRows?: string[],
) {
  const steps = pattern.payload.lengthBeats * timing.stepsPerBeat;
  const pitches = new Set<number>();
  const durations = new Set<number>();
  const drumRows = new Set<string>();
  const combinations = new Map<string, string[]>();
  let unitsPerStep = 1;
  if (pattern.source === "sequencer") {
    const pad = pattern.payload;
    for (let i = 0; i < steps; i++) {
      const cell = pad.steps[i];
      if (cell?.note == null || !cell.velocity) continue;
      for (const pitch of buildSequencerStepChordMidiNotes(cell.note, cell.chord, pad.scaleRoot, pad.mode))
        pitches.add(pitch);
      let length = 1;
      while (i + length < steps && pad.steps[i + length]?.hold && pad.steps[i + length].note == null) length++;
      durations.add(length);
    }
  } else if (pattern.source === "score") {
    unitsPerStep = scoreBeatTicks(timing) / timing.stepsPerBeat;
    for (const note of pattern.payload.notes) {
      if (!note.velocity || note.startTicks >= steps * unitsPerStep) continue;
      pitches.add(note.pitch);
      durations.add(note.durationTicks);
    }
  } else {
    const rows = pattern.payload.rows.filter((row) => !selectedRows || selectedRows.includes(row.rowId));
    const attacks: number[] = [];
    for (let i = 0; i < steps; i++) {
      const group = rows
        .filter((row) => row.steps[i]?.active && row.steps[i].velocity > 0)
        .map((row) => row.rowId);
      if (!group.length) continue;
      attacks.push(i);
      for (const row of group) drumRows.add(row);
      if (group.length > 1) combinations.set(JSON.stringify(group), group);
    }
    attacks.forEach((at, i) => durations.add((attacks[i + 1] ?? steps + attacks[0]) - at));
  }
  return {
    pitches: [...pitches].sort((a, b) => a - b),
    drumRows,
    combinations: [...combinations.values()],
    durations: [...durations].sort((a, b) => a - b),
    unitsPerStep,
  };
}

export function writeMarkovPattern(
  pattern: GeneratedPattern,
  timing: SequencerTimingConfig,
  events: MarkovEvent[],
  pitches: number[],
  hits: string[][],
  id: () => string = () => crypto.randomUUID(),
): GeneratedPattern {
  const steps = pattern.payload.lengthBeats * timing.stepsPerBeat;
  if (pattern.source === "sequencer") {
    const cells = Array.from(
      { length: steps },
      (): SequencerStepState => ({ note: null, chord: "none", hold: false, velocity: 100 }),
    );
    for (const event of events) {
      const pitch = pitches[event.state];
      if (pitch === undefined) continue;
      cells[event.start].note = pitch;
      for (let t = 1; t < event.length; t++) cells[event.start + t].hold = true;
    }
    return {
      ...pattern,
      payload: { ...pattern.payload, steps: cells.concat(pattern.payload.steps.slice(steps)) },
    };
  }
  if (pattern.source === "score") {
    const tick = scoreBeatTicks(timing) / timing.stepsPerBeat,
      end = steps * tick;
    const tickLimit = SCORE_MAX_BEATS * SCORE_TICKS_PER_QUARTER;
    const notes = pattern.payload.notes.flatMap((note) => {
      if (note.startTicks >= end) return [note];
      const tail = note.startTicks + note.durationTicks - end;
      if (tail > 0 && end >= tickLimit) throw new Error("scoreRange");
      return tail > 0 ? [{ ...note, startTicks: end, durationTicks: tail }] : [];
    });
    for (const event of events) {
      const pitch = pitches[event.state];
      if (pitch === undefined) continue;
      if (event.start * tick >= tickLimit || event.length * tick > tickLimit) throw new Error("scoreRange");
      if (notes.length >= SCORE_MAX_PAD_NOTES) throw new Error("capacity");
      notes.push({
        id: id(),
        pitch,
        startTicks: Math.round(event.start * tick),
        durationTicks: Math.round(event.length * tick),
        velocity: 100,
      });
    }
    notes.sort((a, b) => a.startTicks - b.startTicks);
    return { ...pattern, payload: { ...pattern.payload, notes } };
  }
  const participating = new Set(hits.flat());
  const attacks = events.map((event) => ({ at: event.start, rows: hits[event.state] ?? [] }));
  const rows = pattern.payload.rows.map((row) => {
    if (!participating.has(row.rowId)) return row;
    const cells = Array.from({ length: steps }, () => ({ active: false, velocity: 100 }));
    for (const { at, rows: group } of attacks) if (group.includes(row.rowId)) cells[at].active = true;
    return { ...row, steps: cells.concat(row.steps.slice(steps)) };
  });
  return { ...pattern, payload: { ...pattern.payload, rows } };
}
