import { contentLength, definitionMap, type ClipArrangement, type ContentItem, type LaneTiming } from './model';
import { isExpandedStructure, structureClip, structureDisplayGeometry, structurePreview, type ContainerTarget, type StructureDraft } from './structure';

// Keep these in sync with the timeline's clip header, pass label and nested rows.
export const STRUCTURE_TREE_TOP = 4 + 1 + 16 + 16;
const CHILD_ROW_TOP = 22;
type HitItem = { id: string; start: number; length: number; children?: HitItem[] };
export type StructureDropLayout = { start: number; end: number; origin: number; items: HitItem[] };

/** Built once at drag start, independently of virtualized preview DOM nodes. */
export function structureDropLayout(model: ClipArrangement, draft: StructureDraft, timings: LaneTiming): StructureDropLayout {
  const lane = structurePreview(model, draft, timings).lanes.find(l => l.id === draft.laneId)!;
  const clip = lane.clips.find(c => c.id === draft.clipId)!;
  const original = structureClip(draft);
  const timing = timings[lane.id], defs = definitionMap(lane);
  const before = isExpandedStructure(draft) ? draft.expanded!.contentTicks : contentLength(draft.basis, original.children, timing);
  const after = contentLength(lane, clip.children, timing);
  const geometry = structureDisplayGeometry(original, before, after, draft.pass);
  const origin = clip.start + geometry.left(draft.pass);
  const visit = (items: ContentItem[]): HitItem[] => {
    let cursor = 0;
    return items.map(item => {
      const start = cursor, length = contentLength(lane, [item], timing);
      cursor += length;
      const def = 'definitionId' in item ? defs.get(item.definitionId) : undefined;
      return { id: item.id, start, length, ...(def && def.kind !== 'pattern' ? { children: visit(def.children) } : {}) };
    });
  };
  return {
    start: Math.max(clip.start, origin),
    end: clip.mode === 'once' ? clip.start + geometry.length : Math.min(clip.start + geometry.length, origin + after),
    origin, items: visit(clip.children),
  };
}

/** x is in lane ticks; y is relative to the root content row in pixels. */
export function structureInsertionAt(layout: StructureDropLayout, x: number, y: number): ContainerTarget | null {
  if (x < layout.start || x >= layout.end || y < 0 || y > 90) return null;
  const visit = (items: HitItem[], path: string[], offset: number, row: number): ContainerTarget => {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (offset >= item.start + item.length) continue;
      if (item.children && row >= CHILD_ROW_TOP) return visit(item.children, [...path, item.id], offset - item.start, row - CHILD_ROW_TOP);
      return { path, index: index + (offset >= item.start + item.length / 2 ? 1 : 0) };
    }
    return { path, index: items.length };
  };
  return visit(layout.items, [], x - layout.origin, y);
}
