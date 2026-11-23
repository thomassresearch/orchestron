import { CLIP_LIMITS, newClipId, resolveContent, type ClipArrangement, type DefinitionDraft, type LaneTiming, type OccurrenceTarget, type PatternDefinition } from './model';
import { beginDraft } from './operations';
import { structurePreview, type StructureDraft } from './structure';

/** A running container audition owns its pattern slots while song playback follows later edits. */
export function structureAuditionDraft(model: ClipArrangement, structure: StructureDraft, target: OccurrenceTarget, timings: LaneTiming): DefinitionDraft {
  const preview = structurePreview(model, structure, timings);
  const lane = preview.lanes.find(l => l.id === target.laneId)!;
  const draft = beginDraft(preview, target);
  const leaves = resolveContent(lane, [{ id: 'root', definitionId: draft.definition.id }], timings[lane.id]);
  // Pitch is resolved from the captured lane, including any draft-only transpose profiles.
  const patterns = new Map<string, PatternDefinition>();
  for (const { definition } of leaves) {
    if (!definition || patterns.has(definition.id)) continue;
    if (patterns.size >= CLIP_LIMITS.definitions) throw Error('Audition draft exceeds the definition budget.');
    patterns.set(definition.id, { ...definition, id: newClipId(), transposeProfileId: undefined });
  }
  return { ...draft, auditionContext: { lane, patterns: Object.fromEntries(patterns) } };
}
