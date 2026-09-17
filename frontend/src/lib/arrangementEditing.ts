import type { PadLoopPatternItem, PadLoopPatternState } from "../types";
import {
  clonePadLoopPattern, compilePadLoopPattern, nextPadLoopGroupId, nextPadLoopSuperGroupId,
  type PadLoopContainerRef
} from "./padLoopPattern";

export type DefinitionRef = Exclude<PadLoopContainerRef, { kind: "root" }>;

export function definitionUses(pattern: PadLoopPatternState, ref: DefinitionRef): string[] {
  const references = (items: PadLoopPatternItem[]) => items.some(item => ref.kind === "group"
    ? item.type === "group" && item.groupId === ref.id
    : item.type === "super" && item.superGroupId === ref.id);
  return [
    ...(references(pattern.rootSequence) ? ["Arrangement"] : []),
    ...pattern.superGroups.filter(group => references(group.sequence)).map(group => group.id)
  ];
}

export function definitionItem(ref: DefinitionRef): PadLoopPatternItem {
  return ref.kind === "group" ? { type: "group", groupId: ref.id } : { type: "super", superGroupId: ref.id };
}

export function compileDefinition(pattern: PadLoopPatternState, item: PadLoopPatternItem): number[] {
  return compilePadLoopPattern({ ...pattern, rootSequence: [item] }).sequence;
}

/** Validate the entire library, including unused definitions, before committing any edit. */
export function validateArrangementEdit(_previous: PadLoopPatternState, next: PadLoopPatternState): void {
  if (next.groups.length > 256 || next.superGroups.length > 256) throw new Error("Definition limit: 256.");
  const groupIds = new Set(next.groups.map(g => g.id));
  const superIds = new Set(next.superGroups.map(g => g.id));
  if (groupIds.size !== next.groups.length || superIds.size !== next.superGroups.length ||
      [...groupIds].some(id => !/^[A-Z]+$/.test(id)) || [...superIds].some(id => !/^[IVXLCDM]+$/.test(id))) throw new Error("Invalid definition ID.");
  const validItems = (items: PadLoopPatternItem[], level: number) => {
    if (items.length > 256) throw new Error("Sequence limit: 256.");
    for (const item of items) {
      const valid = item.type === "pad" ? Number.isInteger(item.padIndex) && item.padIndex >= 0 && item.padIndex < 8
        : item.type === "pause" ? [1,2,4,8,16].includes(item.lengthBeats)
        : item.type === "group" ? level >= 2 && groupIds.has(item.groupId)
        : item.type === "super" && level === 3 && superIds.has(item.superGroupId);
      if (!valid) throw new Error("Invalid phrase hierarchy or reference.");
    }
  };
  validItems(next.rootSequence, 3);
  next.groups.forEach(g => validItems(g.sequence, 1));
  next.superGroups.forEach(g => validItems(g.sequence, 2));
  compilePadLoopPattern(next);
  for (const kind of ["group", "super"] as const) {
    for (const group of kind === "group" ? next.groups : next.superGroups) {
      const ref = { kind, id: group.id };
      if (group.sequence.length > 256) throw new Error("Sequence limit: 256.");
      const tokens = compileDefinition(next, definitionItem(ref));
      if (!tokens.length && definitionUses(next, ref).length) {
        throw new Error("Remove this definition's occurrences before emptying it.");
      }
    }
  }
}

export function createDefinition(pattern: PadLoopPatternState, kind: "group" | "super", sequence: PadLoopPatternItem[] = []) {
  const next = clonePadLoopPattern(pattern);
  const definitions = kind === "group" ? next.groups : next.superGroups;
  const id = kind === "group" ? nextPadLoopGroupId(definitions.map(d => d.id)) : nextPadLoopSuperGroupId(definitions.map(d => d.id));
  definitions.push({ id, sequence: structuredClone(sequence) });
  validateArrangementEdit(pattern, next);
  return { pattern: next, ref: { kind, id } as DefinitionRef };
}

export function deleteDefinition(pattern: PadLoopPatternState, ref: DefinitionRef): PadLoopPatternState {
  if (definitionUses(pattern, ref).length) return pattern;
  return { ...pattern, groups: ref.kind === "group" ? pattern.groups.filter(g => g.id !== ref.id) : pattern.groups,
    superGroups: ref.kind === "super" ? pattern.superGroups.filter(g => g.id !== ref.id) : pattern.superGroups };
}

export function restTokens(beats: number): PadLoopPatternItem[] {
  if (!Number.isInteger(beats) || beats < 0) throw new Error("Rest duration must be a whole number of beats.");
  const result: PadLoopPatternItem[] = [];
  for (const size of [16, 8, 4, 2, 1] as const) {
    while (beats >= size) {
      result.push({ type: "pause", lengthBeats: size });
      beats -= size;
      if (result.length > 256) throw new Error("Sequence limit: 256.");
    }
  }
  return result;
}

export function removeArrangementItems(pattern: PadLoopPatternState, indexes: number[],
  beatsFor: (item: PadLoopPatternItem) => number, closeGap = false): PadLoopPatternState {
  const selected = new Set(indexes);
  const rootSequence = pattern.rootSequence.flatMap((item, index) => !selected.has(index) ? [item]
    : closeGap ? [] : item.type === "pause" ? [item] : restTokens(beatsFor(item)));
  const next = { ...pattern, rootSequence };
  validateArrangementEdit(pattern, next);
  return next;
}

export type ArrangementSpan = { item: PadLoopPatternItem; indexes: number[]; start: number; duration: number };
export function arrangementSpans(pattern: PadLoopPatternState, padBeats: number[]): ArrangementSpan[] {
  const spans: ArrangementSpan[] = [];
  let start = 0;
  pattern.rootSequence.forEach((item, index) => {
    const duration = compileDefinition(pattern, item).reduce((sum, token) => sum + (token < 0 ? -token : padBeats[token] ?? 4), 0);
    const last = spans[spans.length - 1];
    if (item.type === "pause" && last?.item.type === "pause") {
      last.indexes.push(index); last.duration += duration;
    } else spans.push({ item, indexes: [index], start, duration });
    start += duration;
  });
  return spans;
}

/** Absolute placement into silence; occupied destinations are rejected, never moved elsewhere. */
export function placeArrangementItems(pattern: PadLoopPatternState, items: PadLoopPatternItem[], position: number,
  padBeats: number[], shift = false): PadLoopPatternState {
  if (!Number.isInteger(position) || position < 0) throw new Error("Invalid position.");
  const spans = arrangementSpans(pattern, padBeats);
  const duration = arrangementSpans({ ...pattern, rootSequence: items }, padBeats).reduce((n, span) => n + span.duration, 0);
  if (items.some(item => !compileDefinition(pattern, item).length)) throw new Error("Empty definitions cannot be placed.");
  const end = spans.reduce((n, span) => n + span.duration, 0);
  let rootSequence: PadLoopPatternItem[];
  if (position >= end) rootSequence = [...pattern.rootSequence, ...restTokens(position - end), ...items];
  else if (shift) {
    const boundary = spans.find(span => span.start === position);
    if (!boundary) throw new Error("Insert at an item boundary.");
    rootSequence = [...pattern.rootSequence.slice(0, boundary.indexes[0]), ...items, ...pattern.rootSequence.slice(boundary.indexes[0])];
  } else {
    const gap = spans.find(span => span.item.type === "pause" && position >= span.start && position + duration <= span.start + span.duration);
    if (!gap) throw new Error("Occupied destination.");
    rootSequence = [...pattern.rootSequence.slice(0, gap.indexes[0]), ...restTokens(position - gap.start), ...items,
      ...restTokens(gap.start + gap.duration - position - duration), ...pattern.rootSequence.slice(gap.indexes[gap.indexes.length - 1] + 1)];
  }
  const next = { ...pattern, rootSequence };
  validateArrangementEdit(pattern, next);
  return next;
}

export function moveArrangementItems(pattern: PadLoopPatternState, indexes: number[], position: number, padBeats: number[]): PadLoopPatternState {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  if (!sorted.length || sorted.some((value, i) => i > 0 && value !== sorted[i - 1] + 1)) throw new Error("Move a contiguous block.");
  const items = sorted.map(index => pattern.rootSequence[index]);
  const beatsFor = (item: PadLoopPatternItem) => compileDefinition(pattern, item).reduce((n, token) => n + (token < 0 ? -token : padBeats[token] ?? 4), 0);
  return placeArrangementItems(removeArrangementItems(pattern, sorted, beatsFor), items, position, padBeats);
}

/** An empty pad that is already referenced is still occupied song content. */
export function firstUnusedPad(pattern: PadLoopPatternState, empty: boolean[]): number {
  const used = new Set([...pattern.rootSequence, ...pattern.groups.flatMap(g => g.sequence), ...pattern.superGroups.flatMap(g => g.sequence)]
    .flatMap(item => item.type === "pad" ? [item.padIndex] : []));
  return empty.findIndex((isEmpty, index) => isEmpty && !used.has(index));
}
