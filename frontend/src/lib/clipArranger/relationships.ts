import { contentLength, definitionMap, patternDuration, type ClipLane, type ContentItem, type Definition, type PatternTiming } from './model';

export type EditScope = 'local' | 'all';
/** Editor intent is session-only, never part of a saved definition or runtime configuration. */
export type EditIntent = { scope: EditScope | null; explicit: boolean; variationName?: string };
export type DefinitionRelationship = { occurrences: number; clipIds: string[]; references: number; retained: boolean; shared: boolean };

/** Count intersecting passes arithmetically, including cropped first/last passes. */
export function intersectingPasses(offset: number, length: number, start: number, duration: number, cycle: number, loop: boolean): number {
  if (!loop) return start < offset + length && start + duration > offset ? 1 : 0;
  const first = Math.max(0, Math.floor((offset - start - duration) / cycle) + 1);
  const last = Math.ceil((offset + length - start) / cycle) - 1;
  return Math.max(0, last - first + 1);
}

/** Walk authored paths, never allocate generated repetitions or sample the playback clock. */
export function definitionRelationships(lane: ClipLane, timing?: PatternTiming): Map<string, DefinitionRelationship> {
  const definitions = definitionMap(lane), lengths = new Map<string, number>();
  const result = new Map(lane.definitions.map(d => [d.id, { occurrences: 0, clipIds: [] as string[], references: 0, retained: false, shared: false }]));
  const length = (d: Definition): number => {
    const cached = lengths.get(d.id);
    if (cached !== undefined) return cached;
    const ticks = d.kind === 'pattern' ? patternDuration(d, timing) : itemsLength(d.children);
    lengths.set(d.id, ticks); return ticks;
  };
  const itemsLength = (items: ContentItem[]): number => items.reduce((sum, item) => sum + ('definitionId' in item ? length(definitions.get(item.definitionId)!) : item.restTicks), 0);
  for (const items of [...lane.clips.map(c => c.children), ...lane.definitions.flatMap(d => d.kind === 'pattern' ? [] : [d.children])]) {
    for (const item of items) if ('definitionId' in item) result.get(item.definitionId)!.references++;
  }
  const reachable = new Set<string>();
  const mark = (items: ContentItem[]) => { for (const item of items) if ('definitionId' in item && !reachable.has(item.definitionId)) {
    reachable.add(item.definitionId); const d = definitions.get(item.definitionId)!; if (d.kind !== 'pattern') mark(d.children);
  } };
  lane.clips.forEach(c => mark(c.children));
  const retained = (items: ContentItem[]) => { for (const item of items) if ('definitionId' in item) {
    const entry = result.get(item.definitionId)!; if (entry.retained) continue; entry.retained = true;
    const d = definitions.get(item.definitionId)!; if (d.kind !== 'pattern') retained(d.children);
  } };
  for (const d of lane.definitions) if (!reachable.has(d.id) && d.kind !== 'pattern') retained(d.children);
  for (const clip of lane.clips) {
    const cycle = itemsLength(clip.children);
    const visit = (items: ContentItem[], start: number, inheritedShared: boolean): void => {
      for (const item of items) {
        if (!('definitionId' in item)) { start += item.restTicks; continue; }
        const d = definitions.get(item.definitionId)!, ticks = length(d), entry = result.get(d.id)!;
        const count = cycle ? intersectingPasses(clip.offset, clip.length, start, ticks, cycle, clip.mode === 'loop') : 0;
        entry.occurrences += count;
        if (count && !entry.clipIds.includes(clip.id)) entry.clipIds.push(clip.id);
        entry.shared ||= inheritedShared || entry.references > 1 || count > 1 || entry.retained;
        if (d.kind !== 'pattern') visit(d.children, start, entry.shared);
        start += ticks;
      }
    };
    visit(clip.children, 0, lane.cycleTicks !== null);
  }
  // Propagate sharing through unused ancestors too, and across occurrences visited earlier.
  const propagate = (d: Definition, inherited: boolean) => {
    const entry = result.get(d.id)!; entry.shared ||= inherited || entry.references > 1 || entry.occurrences > 1 || entry.retained;
    if (d.kind !== 'pattern') for (const item of d.children) if ('definitionId' in item) propagate(definitions.get(item.definitionId)!, entry.shared);
  };
  for (const kind of ['supergroup', 'group', 'pattern']) for (const d of lane.definitions) if (d.kind === kind) propagate(d, false);
  return result;
}

export function initialEditIntent(relationship: DefinitionRelationship | undefined, scope?: EditScope): EditIntent {
  return { scope: scope ?? (relationship?.shared ? null : 'all'), explicit: scope !== undefined };
}
export function affectedClipIds(relationships: Map<string, DefinitionRelationship> | undefined, definitions: readonly { id: string }[]): string[] {
  return [...new Set(definitions.flatMap(d => relationships?.get(d.id)?.clipIds ?? []))];
}
/** Original before/edited/after windows, without expanding the loop. */
export function localLoopWindows(lane: ClipLane, clipId: string, pass: number, timing?: PatternTiming): [number, number][] | undefined {
  const clip = lane.clips.find(c => c.id === clipId);
  if (!clip || clip.mode !== 'loop') return;
  const cycle = contentLength(lane, clip.children, timing), end = clip.start + clip.length;
  const start = Math.max(clip.start, clip.start - clip.offset + pass * cycle);
  const stop = Math.min(end, clip.start - clip.offset + (pass + 1) * cycle);
  if (stop <= start) return;
  return ([[clip.start, start], [start, stop], [stop, end]] as [number, number][]).filter(([from, to]) => to > from);
}
export function effectiveScope(intent: EditIntent | undefined, relationship: DefinitionRelationship | undefined): EditScope | null {
  return !intent || (!intent.explicit && relationship?.shared) ? null : intent.scope;
}
export function uniqueVariationName(lane: ClipLane, name: string, suffix: string): string {
  let index = 1, candidate: string;
  do { const tail = ` ${suffix} ${index++}`; candidate = name.slice(0, 128 - tail.length) + tail; } while (lane.definitions.some(d => d.name === candidate));
  return candidate;
}
