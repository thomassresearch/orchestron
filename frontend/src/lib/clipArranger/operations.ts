import { ClipError, contentLength, definitionMap, exactTick, newClipId, validateArrangement, type Clip, type ClipArrangement, type ClipHistory, type ClipLane, type ContentItem, type Definition, type DefinitionDraft, type LaneTiming, type OccurrenceTarget } from "./model";

type IdFactory = () => string;
const clone = <T>(value: T): T => structuredClone(value);
export function laneFor(model: ClipArrangement, id: string): ClipLane {
  const lane = model.lanes.find(l => l.id === id);
  if (!lane) throw new ClipError("missing", "The source lane no longer exists.");
  return lane;
}
export function clipFor(lane: ClipLane, id: string): Clip {
  const clip = lane.clips.find(c => c.id === id);
  if (!clip) throw new ClipError("missing", "The clip no longer exists.");
  return clip;
}
export function definitionAt(lane: ClipLane, target: OccurrenceTarget): Definition {
  let items = clipFor(lane, target.clipId).children;
  const defs = definitionMap(lane);
  let definition: Definition | undefined;
  for (const id of target.path) {
    const item = items.find(item => item.id === id);
    if (!item || !("definitionId" in item)) throw new ClipError("missing", "The selected occurrence no longer exists.");
    definition = defs.get(item.definitionId);
    if (!definition) throw new ClipError("missing", "The selected definition no longer exists.");
    items = definition.kind === "pattern" ? [] : definition.children;
  }
  if (!definition) throw new ClipError("missing", "Select a pattern, group or supergroup.");
  return definition;
}
export function occurrenceNames(lane: ClipLane, target: OccurrenceTarget): string[] {
  return target.path.map((_, index) => definitionAt(lane, { ...target, path: target.path.slice(0, index + 1) }).name);
}
export function beginDraft(model: ClipArrangement, target: OccurrenceTarget): DefinitionDraft {
  const definition = definitionAt(laneFor(model, target.laneId), target);
  return { target: clone(target), baseRevision: definition.revision, baseFingerprint: JSON.stringify(definition), definition: clone(definition) };
}
function finish(next: ClipArrangement, timings: LaneTiming): ClipArrangement {
  next.revision++;
  validateArrangement(next, timings);
  return next;
}
export function updateClip(model: ClipArrangement, laneId: string, clipId: string, patch: Partial<Omit<Clip, "id" | "children">>, timings: LaneTiming = {}): ClipArrangement {
  const next = clone(model), lane = laneFor(next, laneId), clip = clipFor(lane, clipId);
  Object.assign(clip, patch);
  next.end = Math.max(next.end, clip.start + clip.length);
  return finish(next, timings);
}
export function trimClip(model: ClipArrangement, laneId: string, clipId: string, edge: "left" | "right", at: number, timings: LaneTiming = {}): ClipArrangement {
  const clip = clipFor(laneFor(model, laneId), clipId);
  exactTick(at);
  return updateClip(model, laneId, clipId, edge === "right" ? { length: at - clip.start } : {
    start: at, length: clip.start + clip.length - at, offset: clip.offset + at - clip.start
  }, timings);
}
export function fitClip(model: ClipArrangement, laneId: string, clipId: string, timings: LaneTiming = {}): ClipArrangement {
  const lane = laneFor(model, laneId), clip = clipFor(lane, clipId);
  const remaining = contentLength(lane, clip.children, timings[laneId]) - clip.offset;
  if (remaining <= 0) throw new ClipError("offset", "Reset the source offset before fitting this clip.");
  return updateClip(model, laneId, clipId, { length: remaining }, timings);
}
export function addClip(model: ClipArrangement, laneId: string, clip: Clip, timings: LaneTiming = {}): ClipArrangement {
  const next = clone(model);
  laneFor(next, laneId).clips.push(clone(clip));
  next.end = Math.max(next.end, clip.start + clip.length);
  return finish(next, timings);
}
export function deleteClip(model: ClipArrangement, laneId: string, clipId: string, timings: LaneTiming = {}): ClipArrangement {
  const next = clone(model), lane = laneFor(next, laneId);
  clipFor(lane, clipId);
  lane.clips = lane.clips.filter(c => c.id !== clipId);
  return finish(next, timings); // preserve trailing space and all definitions
}
const freshChildren = (items: ContentItem[], id: IdFactory) => items.map(item => ({ ...clone(item), id: id() }));
export function directLinks(lane: ClipLane, definitionId: string): number {
  return [...lane.clips.flatMap(c => c.children), ...lane.definitions.flatMap(d => d.kind === "pattern" ? [] : d.children)]
    .filter(item => "definitionId" in item && item.definitionId === definitionId).length;
}

/** Keep exactly one generated source pass editable; preserve the original window coverage. */
function isolatePass(lane: ClipLane, clip: Clip, pass: number, timing: LaneTiming[string], id: IdFactory): Clip {
  const duration = contentLength(lane, clip.children, timing);
  if (!Number.isSafeInteger(pass) || pass < 0 || !duration) throw new ClipError("invalid", "Invalid repeat pass.");
  if (clip.mode === "once") {
    if (pass !== 0) throw new ClipError("missing", "That pass is not present.");
    return clip;
  }
  const start = Math.max(clip.start, clip.start - clip.offset + pass * duration);
  const end = Math.min(clip.start + clip.length, clip.start - clip.offset + (pass + 1) * duration);
  if (end <= start) throw new ClipError("missing", "That pass is not present.");
  const parts: Clip[] = [];
  if (start > clip.start) parts.push({ ...clone(clip), id: id(), length: start - clip.start, children: freshChildren(clip.children, id) });
  const selected = { ...clip, start, length: end - start, offset: (clip.offset + start - clip.start) % duration, mode: "once" as const };
  parts.push(selected);
  if (end < clip.start + clip.length) parts.push({ ...clone(clip), id: id(), start: end, length: clip.start + clip.length - end,
    offset: clip.offset + end - clip.start, children: freshChildren(clip.children, id) });
  lane.clips.splice(lane.clips.indexOf(clip), 1, ...parts);
  return selected;
}

/** Atomic copy-on-write. Never mutate the supplied draft or an authored object. */
export function saveDraft(model: ClipArrangement, draft: DefinitionDraft, scope: "local" | "all", timings: LaneTiming = {}, id: IdFactory = newClipId): ClipArrangement {
  const next = clone(model), lane = laneFor(next, draft.target.laneId);
  const previous = definitionAt(lane, draft.target);
  if (previous.id !== draft.definition.id || previous.kind !== draft.definition.kind || previous.revision !== draft.baseRevision || (draft.baseFingerprint !== undefined && JSON.stringify(previous) !== draft.baseFingerprint)) throw new ClipError("conflict", "This definition changed after editing began. Reopen or copy your draft.");
  lane.definitions.push(...clone(draft.additions ?? []));
  const replacement = clone(draft.definition);
  replacement.revision = previous.revision + 1;
  if (scope === "all") lane.definitions[lane.definitions.findIndex(d => d.id === previous.id)] = replacement;
  else {
    const clip = isolatePass(lane, clipFor(lane, draft.target.clipId), draft.target.pass, timings[lane.id], id);
    replacement.id = id(); replacement.revision = 0;
    if (replacement.kind !== "pattern") replacement.children = freshChildren(replacement.children, id);
    lane.definitions.push(replacement);
    const fork = (items: ContentItem[], depth: number, sharedParent: boolean): ContentItem[] => items.map(item => {
      if (item.id !== draft.target.path[depth]) return item;
      if (!("definitionId" in item)) throw new ClipError("missing", "Cannot edit a rest as a definition.");
      if (depth === draft.target.path.length - 1) return { ...item, definitionId: replacement.id };
      const ancestor = lane.definitions.find(d => d.id === item.definitionId);
      if (!ancestor || ancestor.kind === "pattern") throw new ClipError("missing", "The selected path changed.");
      const needsCopy = sharedParent || directLinks(lane, ancestor.id) > 1;
      const updated = { ...clone(ancestor), children: fork(ancestor.children, depth + 1, needsCopy) };
      if (needsCopy) {
        updated.id = id(); updated.revision = 0; updated.children = freshChildren(updated.children, id);
        lane.definitions.push(updated);
      } else {
        updated.revision++;
        lane.definitions[lane.definitions.findIndex(d => d.id === ancestor.id)] = updated;
      }
      return { ...item, definitionId: updated.id };
    });
    clip.children = fork(clip.children, 0, false);
  }
  return finish(next, timings);
}

/** Groups are authored definitions with occurrence IDs, not a second pattern workspace. */
export function groupChildren(lane: ClipLane, items: ContentItem[], selectedIds: string[], kind: "group" | "supergroup", name: string, id: IdFactory = newClipId): { definition: Definition; children: ContentItem[] } {
  const indexes = selectedIds.map(selected => items.findIndex(item => item.id === selected)).sort((a, b) => a - b);
  if (!indexes.length || indexes[0] < 0 || new Set(indexes).size !== indexes.length || indexes.some((index, i) => index !== indexes[0] + i)) throw new ClipError("invalid", "Select consecutive children to group.");
  const chosen = items.slice(indexes[0], indexes[indexes.length - 1] + 1), defs = definitionMap(lane);
  for (const item of chosen) if ("definitionId" in item) {
    const def = defs.get(item.definitionId);
    if (!def || def.kind === "supergroup" || kind === "group" && def.kind !== "pattern") throw new ClipError("invalid", "This content cannot be nested at that level.");
  }
  const definition: Definition = { id: id(), name, revision: 0, kind, children: freshChildren(chosen, id) };
  const children = clone(items);
  children.splice(indexes[0], chosen.length, { id: id(), definitionId: definition.id });
  return { definition, children };
}

/** Explicit insert/close time is atomic across selected lanes, including cuts through clips. */
export function editTime(model: ClipArrangement, laneIds: string[], start: number, length: number, operation: "insert" | "close", timings: LaneTiming = {}, id: IdFactory = newClipId): ClipArrangement {
  exactTick(start); exactTick(length, true);
  const next = clone(model);
  for (const laneId of laneIds) {
    const lane = laneFor(next, laneId);
    if (lane.cycleTicks !== null) throw new ClipError("invalid", "Convert the repeating legacy cycle before editing song time.");
    lane.clips = lane.clips.flatMap(clip => {
      const end = clip.start + clip.length, cutEnd = operation === "close" ? start + length : start;
      if (end <= start) return [clip];
      if (clip.start >= cutEnd) return [{ ...clip, start: clip.start + (operation === "insert" ? length : -length) }];
      const pieces: Clip[] = [];
      if (clip.start < start) pieces.push({ ...clip, length: start - clip.start });
      if (end > cutEnd) {
        const from = Math.max(clip.start, cutEnd);
        pieces.push({ ...clip, id: pieces.length ? id() : clip.id, start: from + (operation === "insert" ? length : -length),
          offset: clip.offset + from - clip.start, length: end - from, children: pieces.length ? freshChildren(clip.children, id) : clip.children });
      }
      return pieces;
    });
  }
  const extent = Math.max(0, ...next.lanes.flatMap(l => l.clips.map(c => c.start + c.length)));
  next.end = Math.max(1, extent, operation === "insert" ? next.end + length : next.end - Math.min(length, Math.max(0, next.end - start)));
  return finish(next, timings);
}
export const emptyClipHistory = (): ClipHistory => ({ version: 1, cursor: 0, entries: [] });
export function recordClipEdit(history: ClipHistory, before: ClipArrangement, after: ClipArrangement, label: string): ClipHistory {
  const entries = [...history.entries.slice(0, history.cursor), { label, before: clone(before), after: clone(after) }].slice(-25);
  return { version: 1, cursor: entries.length, entries };
}
export function replayClipEdit(history: ClipHistory, model: ClipArrangement, forward: boolean): { model: ClipArrangement; history: ClipHistory } {
  const index = forward ? history.cursor : history.cursor - 1, entry = history.entries[index];
  if (!entry) return { model, history };
  if (JSON.stringify(model) !== JSON.stringify(forward ? entry.before : entry.after)) throw new ClipError("conflict", "The arrangement changed outside this history.");
  return { model: clone(forward ? entry.after : entry.before), history: { ...history, cursor: history.cursor + (forward ? 1 : -1) } };
}

/** History is optional display/edit metadata; incompatible snapshots must never be replayed. */
export function readClipHistory(value: unknown, model: ClipArrangement, timings: LaneTiming): ClipHistory {
  try {
    const history = value as ClipHistory;
    if (!history || history.version !== 1 || !Array.isArray(history.entries) || history.entries.length > 25 || !Number.isInteger(history.cursor) || history.cursor < 0 || history.cursor > history.entries.length) return emptyClipHistory();
    for (const entry of history.entries) {
      if (typeof entry.label !== "string" || entry.label.length > 256) return emptyClipHistory();
      validateArrangement(entry.before, timings); validateArrangement(entry.after, timings);
      if ([entry.before, entry.after].some(snapshot => snapshot.lanes.some(l => !model.lanes.some(current => current.id === l.id && current.source === l.source)))) return emptyClipHistory();
    }
    const expected = history.cursor ? history.entries[history.cursor - 1].after : history.entries[0]?.before;
    if (expected && JSON.stringify(model) !== JSON.stringify(expected)) return emptyClipHistory();
    return clone(history);
  } catch { return emptyClipHistory(); }
}

export type ClipSection = { length: number; lanes: { id: string; clips: Clip[] }[] };
function sliceWindow(clip: Clip, start: number, end: number, id: IdFactory): Clip | null {
  const left = Math.max(start, clip.start), right = Math.min(end, clip.start + clip.length);
  return right <= left ? null : { ...clone(clip), id: id(), start: left, length: right - left,
    offset: clip.offset + left - clip.start, children: freshChildren(clip.children, id) };
}
export function copyClipRange(model: ClipArrangement, laneIds: string[], start: number, length: number, id: IdFactory = newClipId): ClipSection {
  exactTick(start); exactTick(length, true);
  return { length, lanes: laneIds.map(identity => {
    const lane = laneFor(model, identity);
    if (lane.cycleTicks !== null) throw new ClipError("invalid", "Convert the repeating legacy cycle before copying song time.");
    return { id: identity, clips: lane.clips.flatMap(clip => {
      const sliced = sliceWindow(clip, start, start + length, id);
      return sliced ? [{ ...sliced, start: sliced.start - start }] : [];
    }) };
  }) };
}
export function pasteClipRange(model: ClipArrangement, section: ClipSection, at: number, mode: "overwrite" | "insert", timings: LaneTiming, id: IdFactory = newClipId): ClipArrangement {
  exactTick(at);
  const next = mode === "insert" ? editTime(model, section.lanes.map(l => l.id), at, section.length, "insert", timings, id) : clone(model);
  for (const copied of section.lanes) {
    const lane = laneFor(next, copied.id);
    if (lane.cycleTicks !== null) throw new ClipError("invalid", "Convert the repeating legacy cycle before pasting song time.");
    if (mode === "overwrite") lane.clips = lane.clips.flatMap(clip => {
      if (clip.start + clip.length <= at || clip.start >= at + section.length) return [clip];
      return [sliceWindow(clip, 0, at, id), sliceWindow(clip, at + section.length, next.end, id)].filter((c): c is Clip => c !== null);
    });
    lane.clips.push(...copied.clips.map(clip => ({ ...clone(clip), id: id(), start: at + clip.start, children: freshChildren(clip.children, id) })));
    lane.clips.sort((a, b) => a.start - b.start);
  }
  next.end = Math.max(next.end, at + section.length);
  return finish(next, timings);
}

/** Materialize an independent legacy lane only across the authored song window. */
export function convertLaneCycle(model: ClipArrangement, laneId: string, timings: LaneTiming, id: IdFactory = newClipId): ClipArrangement {
  const next = clone(model), lane = laneFor(next, laneId), cycle = lane.cycleTicks;
  if (cycle === null) return model;
  const repeats = Math.ceil(model.end / cycle);
  if (repeats * lane.clips.length > 2048) throw new ClipError("limit", "The repeating lane exceeds the clip limit. Shorten the song before converting.");
  lane.clips = Array.from({ length: repeats }, (_, pass) => lane.clips.flatMap(clip => {
    const start = clip.start + pass * cycle;
    return start >= model.end ? [] : [{ ...clip, id: id(), start, length: Math.min(clip.length, model.end - start), children: freshChildren(clip.children, id) }];
  })).flat();
  lane.cycleTicks = null;
  return finish(next, timings);
}
