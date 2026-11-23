import { create } from 'zustand';
import { newClipId, type ClipArrangement, type LaneTiming, type DefinitionDraft, type PatternDefinition } from './model';
import { applyStructure, duplicatePattern, prepareStructure, type StructureDraft } from './structure';
/** Session-only; deliberately excluded from performance and app-state serializers. */
export const useStructureDraft = create<{draft:StructureDraft|null}>(()=>({draft:null}));

/** The structure owns these notes. The ordinary pad editor displays its current leaf. */
export function editDuplicatePattern(editor: DefinitionDraft, pattern: PatternDefinition) {
  const draft = useStructureDraft.getState().draft;
  const current = duplicatePattern(draft, editor.target);
  if (!draft || !current || JSON.stringify(current) === JSON.stringify(pattern)) return;
  const path = editor.target.path;
  const previous = draft.commands[draft.cursor - 1];
  // Keep a continuous series of note edits in one draft undo step.
  const replacing = previous?.kind === 'editDuplicate' && JSON.stringify(previous.path) === JSON.stringify(path);
  const id = replacing ? previous.pattern.id : newClipId();
  const basis = replacing ? { ...draft, cursor: draft.cursor - 1 } : draft;
  useStructureDraft.setState({ draft: applyStructure(basis, { kind: 'editDuplicate', path, pattern: { ...pattern, id } }) });
}

/** Refresh open and suspended editors on draft edits/undo, and release removed copies. */
export function refreshDuplicateEditors(draft: StructureDraft | null, editors: Record<string, DefinitionDraft>) {
  let result = editors;
  for (const [key, editor] of Object.entries(editors)) {
    if (!editor.provisionalDuplicate) continue;
    const definition = duplicatePattern(draft, editor.target);
    if (definition === editor.definition) continue;
    if (result === editors) result = { ...editors };
    if (definition) result[key] = { ...editor, definition };
    else delete result[key];
  }
  return result;
}

type StructureReview = { result: ReturnType<typeof prepareStructure> | null; error: string };
const emptyReview: StructureReview = { result: null, error: '' };
const reviews = new WeakMap<StructureDraft, { model: ClipArrangement; timingKey: string; review: StructureReview }>();

/** Share validated windows and generated IDs between the inspector, runtime requests and Save. */
export function reviewStructureDraft(model: ClipArrangement, draft: StructureDraft | null, timings: LaneTiming): StructureReview {
  if (!draft?.cursor || !draft.editIntent?.scope) return emptyReview;
  const timingKey = JSON.stringify(timings);
  const cached = reviews.get(draft);
  if (cached?.model === model && cached.timingKey === timingKey) return cached.review;
  let review: StructureReview;
  try {
    review = { result: prepareStructure(model, draft, draft.editIntent.scope, timings), error: '' };
  } catch (error) {
    review = { result: null, error: String(error) };
  }
  reviews.set(draft, { model, timingKey, review });
  return review;
}
