import { newClipId, type ClipArrangement, type DefinitionDraft, type LaneTiming, type OccurrenceTarget } from './model';
import { beginDraft } from './operations';
import { structurePreview, type StructureDraft } from './structure';

/** Preview paths stay stable for hit testing; audio additions need globally unique child IDs. */
export function structureAuditionDraft(model: ClipArrangement, structure: StructureDraft, target: OccurrenceTarget, timings: LaneTiming): DefinitionDraft {
  const preview = structurePreview(model, structure, timings);
  const lane = preview.lanes.find(l => l.id === target.laneId)!;
  const saved = model.lanes.find(l => l.id === target.laneId)!;
  const childIds: Record<string,string> = {};
  const additions = lane.definitions.filter(d => !saved.definitions.some(old => old.id === d.id)).map(d =>
    d.kind === 'pattern' ? d : { ...d, children: d.children.map(child => ({ ...child, id: childIds[child.id] = newClipId() })) });
  return { ...beginDraft(preview, target), additions, auditionContext:{lane,childIds} };
}
