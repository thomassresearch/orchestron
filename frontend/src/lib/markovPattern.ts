import type {
  DrummerSequencerPadState,
  ScorePadState,
  SequencerPadState,
  SequencerTimingConfig,
  SequencerStepState,
} from "../types";
import type { MarkovEvent } from "./markov";
import { MODE_INTERVALS, SEQUENCER_SCALE_ROOTS } from "./sequencer";
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
        startTicks: event.start * tick,
        durationTicks: event.length * tick,
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
