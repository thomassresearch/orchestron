import type { PadLoopPatternItem, PadLoopPatternState, SequencerState } from "../types";
import { arrangementSpans, restTokens, validateArrangementEdit } from "./arrangementEditing";
import { sequencerTransportSubunitsPerBeat } from "./sequencer";

export type ArrangementLaneKind = "sequencer" | "drummer" | "controller" | "arpeggiator";
export type RangeLane = {
  id: string; kind: ArrangementLaneKind; pattern: PadLoopPatternState;
  padBeats: number[]; beatSubunits: number;
};
export type ArrangementRange = { startSubunit: number; endSubunit: number; laneIds: string[] };
export type ArrangementRangeUpdate = Pick<RangeLane, "id" | "kind"> & { rootSequence: PadLoopPatternItem[] };
export type ArrangementRangeClipboard = {
  durationSubunits: number;
  lanes: (ArrangementRangeUpdate & { basis: string })[];
};
export type ArrangementRangeMode = "overwrite" | "insert-all" | "insert-selected";
export type RangeErrorCode = "boundary" | "timing" | "missing" | "changed" | "limit" | "empty";
export class ArrangementRangeError extends Error {
  constructor(public code: RangeErrorCode, public laneId?: string) { super(code); }
}

/** Authored lanes only: runtime pad selection and generated repetitions are never copied. */
export function arrangementRangeLanes(sequencer: SequencerState): RangeLane[] {
  const beat = sequencerTransportSubunitsPerBeat();
  return [
    ...sequencer.tracks.map(t => ({ id: t.id, kind: "sequencer" as const, pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatSubunits: beat * t.timing.beatRateDenominator / t.timing.beatRateNumerator })),
    ...sequencer.drummerTracks.map(t => ({ id: t.id, kind: "drummer" as const, pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatSubunits: beat * t.timing.beatRateDenominator / t.timing.beatRateNumerator })),
    ...sequencer.controllerSequencers.map(t => ({ id: t.id, kind: "controller" as const, pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatSubunits: beat * t.timing.beatRateDenominator / t.timing.beatRateNumerator })),
    ...sequencer.arpeggiators.filter(t => t.playbackMode === "arranger").map(t => ({ id: t.id, kind: "arpeggiator" as const, pattern: t.padLoopPattern, padBeats: t.pads.map(p => p.lengthBeats), beatSubunits: beat }))
  ];
}

function laneBasis(lane: RangeLane) {
  return JSON.stringify([lane.kind, lane.beatSubunits, lane.padBeats, lane.pattern.groups, lane.pattern.superGroups]);
}

/** Excludes notes, colours, mixer and transport, none of which invalidate range history. */
export function arrangementRangeSignature(lanes: RangeLane[]): string {
  return JSON.stringify(lanes.map(lane => [lane.id, laneBasis(lane), lane.pattern.rootSequence]));
}

function spansFor(lane: RangeLane) {
  return arrangementSpans(lane.pattern, lane.padBeats).map(span => ({ ...span,
    start: span.start * lane.beatSubunits, duration: span.duration * lane.beatSubunits }));
}

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

/** Expand outwards until every selected lane has whole elements and representable rests. */
export function resolveArrangementRange(lanes: RangeLane[], range: ArrangementRange): ArrangementRange {
  const selected = lanes.filter(lane => range.laneIds.includes(lane.id));
  if (!selected.length) throw new ArrangementRangeError("empty");
  const grid = selected.reduce((value, lane) => value / gcd(value, lane.beatSubunits) * lane.beatSubunits, 1);
  let start = Math.max(0, Math.floor(Math.min(range.startSubunit, range.endSubunit) / grid) * grid);
  let end = Math.max(start + grid, Math.ceil(Math.max(range.startSubunit, range.endSubunit) / grid) * grid);
  const spans = selected.flatMap(spansFor).filter(span => span.item.type !== "pause");
  let changed: boolean;
  do {
    const previousStart = start, previousEnd = end;
    for (const span of spans) {
      if (span.start < start && start < span.start + span.duration) start = Math.floor(span.start / grid) * grid;
      if (span.start < end && end < span.start + span.duration) end = Math.ceil((span.start + span.duration) / grid) * grid;
    }
    changed = start !== previousStart || end !== previousEnd;
  } while (changed);
  return { startSubunit: start, endSubunit: end, laneIds: selected.map(lane => lane.id) };
}

function rests(lane: RangeLane, subunits: number): PadLoopPatternItem[] {
  if (!Number.isSafeInteger(subunits) || subunits < 0 || subunits % lane.beatSubunits !== 0) throw new ArrangementRangeError("timing", lane.id);
  return restTokens(subunits / lane.beatSubunits);
}

/** Extract an interval, preserving musical references and padding implicit silence at the end. */
function slice(lane: RangeLane, start: number, end: number): PadLoopPatternItem[] {
  if (start % lane.beatSubunits || end % lane.beatSubunits) throw new ArrangementRangeError("timing", lane.id);
  const result: PadLoopPatternItem[] = [];
  let cursor = start;
  for (const span of spansFor(lane)) {
    const left = Math.max(start, span.start), right = Math.min(end, span.start + span.duration);
    if (left >= right) continue;
    if (span.item.type === "pause") result.push(...rests(lane, right - left));
    else {
      if (left !== span.start || right !== span.start + span.duration) throw new ArrangementRangeError("boundary", lane.id);
      result.push({ ...span.item });
    }
    cursor = right;
  }
  if (cursor < end) result.push(...rests(lane, end - cursor));
  return result;
}

function compactRests(items: PadLoopPatternItem[]): PadLoopPatternItem[] {
  const result: PadLoopPatternItem[] = [];
  let beats = 0;
  for (const item of items) {
    if (item.type === "pause") beats += item.lengthBeats;
    else { result.push(...restTokens(beats), item); beats = 0; }
  }
  result.push(...restTokens(beats));
  return result;
}

export function copyArrangementRange(lanes: RangeLane[], range: ArrangementRange): ArrangementRangeClipboard {
  if (range.endSubunit <= range.startSubunit || !range.laneIds.length) throw new ArrangementRangeError("empty");
  return {
    durationSubunits: range.endSubunit - range.startSubunit,
    lanes: range.laneIds.map(id => {
      const lane = lanes.find(candidate => candidate.id === id);
      if (!lane) throw new ArrangementRangeError("missing", id);
      return { id, kind: lane.kind, basis: laneBasis(lane), rootSequence: slice(lane, range.startSubunit, range.endSubunit) };
    })
  };
}

/** Compute the whole transaction before any store writes; preview and commit use this same operation. */
export function placeArrangementRange(lanes: RangeLane[], clipboard: ArrangementRangeClipboard,
  position: number, mode: ArrangementRangeMode): ArrangementRangeUpdate[] {
  if (!Number.isSafeInteger(position) || position < 0 || clipboard.durationSubunits <= 0 || !clipboard.lanes.length) throw new ArrangementRangeError("empty");
  for (const entry of clipboard.lanes) {
    const lane = lanes.find(l => l.id === entry.id && l.kind === entry.kind);
    if (!lane) throw new ArrangementRangeError("missing", entry.id);
    if (laneBasis(lane) !== entry.basis) throw new ArrangementRangeError("changed", entry.id);
  }
  return lanes.flatMap(lane => {
    const entry = clipboard.lanes.find(l => l.id === lane.id);
    const end = spansFor(lane).reduce((total, span) => total + span.duration, 0);
    if (!entry && (mode !== "insert-all" || end <= position)) return [];
    try {
      const material = entry?.rootSequence ?? rests(lane, clipboard.durationSubunits);
      // Even a musical-only clipboard must have a duration representable on its target lane.
      if (clipboard.durationSubunits % lane.beatSubunits) throw new ArrangementRangeError("timing", lane.id);
      const tail = mode === "overwrite" ? position + clipboard.durationSubunits : position;
      const rootSequence = compactRests([...slice(lane, 0, position), ...material, ...(tail < end ? slice(lane, tail, end) : [])]);
      validateArrangementEdit(lane.pattern, { ...lane.pattern, rootSequence });
      return [{ id: lane.id, kind: lane.kind, rootSequence }];
    } catch (error) {
      if (error instanceof ArrangementRangeError) throw error;
      throw new ArrangementRangeError("limit", lane.id);
    }
  });
}
