import { CLIP_LIMITS, ClipError, clipWindows, windowRange, type ClipWindow, contentLength, exactTick, newClipId, validateArrangement, type Clip, type ClipArrangement, type ClipLane, type LaneTiming } from "./model";
import { clipDisplayName, freshClip, laneFor } from "./operations";

function edit(model: ClipArrangement, laneId: string, timings: LaneTiming, action: (lane: ClipLane, windows: ClipWindow[]) => string) {
  const next = structuredClone(model), lane = laneFor(next, laneId);
  const selected = action(lane, clipWindows(lane));
  if (lane.clips.some(c => c.windowGroupId || c.continuityId)) next.version = 5;
  next.revision++;
  next.end = Math.max(next.end, ...lane.clips.map(c => c.start + c.length));
  validateArrangement(next, timings);
  return { model: next, selected };
}

function find(windows: ClipWindow[], id: string) {
  const window = windows.find(w => w.clip.id === id);
  if (!window) throw new ClipError("missing", "The selected clip has changed.");
  return window;
}

function silence(start: number, length: number): Clip {
  return { id: newClipId(), name: "Rest", start, length, offset: 0, mode: "once", children: [{ id: newClipId(), restTicks: length }] };
}

function setGroup(parts: Clip[]) {
  const groupId = parts.length > 1 ? newClipId() : undefined;
  for (const part of parts) {
    if (groupId) part.windowGroupId = groupId;
    else delete part.windowGroupId;
  }
}

function comparableContent(clip: Clip) {
  const roots = new Map(clip.children.map((item, index) => [item.id, index]));
  return {
    children: clip.children.map(item => ({ ...item, id: undefined })),
    placements: clip.transposePlacements?.map(p => ({ ...p, path: [roots.get(p.path[0]), ...p.path.slice(1)] })),
  };
}

export function mergeClips(model: ClipArrangement, laneId: string, ids: string[], timings: LaneTiming = {}) {
  return edit(model, laneId, timings, (lane, windows) => {
    const range = windowRange(windows, ids[0], ids[ids.length - 1]);
    if (range.length < 2 || range.length !== ids.length || range.some((w, i) => w.clip.id !== ids[i])) {
      throw new ClipError("conflict", "Select consecutive clips on one track.");
    }
    const parts: Clip[] = [];
    for (const window of range) {
      const last = parts[parts.length - 1];
      if (last && window.clip.start > last.start + last.length) {
        const rest = silence(last.start + last.length, window.clip.start - last.start - last.length);
        parts.push(rest);
        lane.clips.push(rest);
      }
      parts.push(...window.parts);
    }
    const first = parts[0];
    const source = first.continuityId;
    const firstContent = source && JSON.stringify(comparableContent(first));
    if (source && parts.every((part, i) => !i || (
      part.continuityId === source && part.offset === first.offset + part.start - first.start &&
      part.mode === first.mode && part.repeatIndexBase === first.repeatIndexBase &&
      JSON.stringify(comparableContent(part)) === firstContent
    ))) {
      const removed = new Set(parts.slice(1).map(p => p.id));
      delete first.windowGroupId;
      first.length = range[range.length - 1].end - first.start;
      lane.clips = lane.clips.filter(p => !removed.has(p.id));
      return first.id;
    }
    first.name = clipDisplayName(lane, first);
    first.nameIsExplicit = true;
    // Whole, untransformed sequences can remain one ordinary editable content list.
    if (parts.every(c => !c.offset && !c.continuityId && !c.repeatIndexBase &&
      !c.transposePlacements?.length && c.length === contentLength(lane, c.children, timings[laneId])) &&
      parts.reduce((n, c) => n + c.children.length, 0) <= CLIP_LIMITS.children) {
      const removed = new Set(parts.slice(1).map(c => c.id));
      first.children = parts.flatMap(c => c.children);
      delete first.windowGroupId;
      first.length = range[range.length - 1].end - first.start;
      lane.clips = lane.clips.filter(c => !removed.has(c.id));
    } else {
      setGroup(parts);
    }
    return first.id;
  });
}

export function splitClip(model: ClipArrangement, laneId: string, clipId: string, at: number, timings: LaneTiming = {}) {
  exactTick(at);
  return edit(model, laneId, timings, (lane, windows) => {
    const window = find(windows, clipId);
    if (at <= window.clip.start || at >= window.end) throw new ClipError("invalid", "Cut inside the clip.");
    const index = window.parts.findIndex(c => c.start + c.length > at);
    const part = window.parts[index];
    if (at === part.start) {
      setGroup(window.parts.slice(0, index));
      setGroup(window.parts.slice(index));
      return part.id;
    }
    const elapsed = at - part.start;
    const right = freshClip(part, newClipId);
    right.id = newClipId();
    right.start = at;
    right.length = part.length - elapsed;
    const offset = right.offset + elapsed;
    right.offset = Math.min(CLIP_LIMITS.ticks, offset);
    if (offset > CLIP_LIMITS.ticks && right.mode === "loop") {
      const duration = contentLength(lane, part.children, timings[laneId]);
      right.offset = offset % duration;
      right.repeatIndexBase = (part.repeatIndexBase ?? 0) + Math.floor(offset / duration);
    }
    right.continuityId = part.continuityId ?? part.id;
    part.continuityId = right.continuityId;
    part.length = elapsed;
    setGroup(window.parts.slice(0, index + 1));
    setGroup([right, ...window.parts.slice(index + 1)]);
    lane.clips.push(right);
    return right.id;
  });
}
