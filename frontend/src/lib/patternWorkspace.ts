import type { DrummerSequencerPadState, PadLoopPatternItem, PadLoopPatternState, PerformanceAuditionStatus, SequencerPadState } from "../types";
import { createDefinition, definitionItem, definitionUses, deleteDefinition, validateArrangementEdit, type DefinitionRef } from "./arrangementEditing";
import { compilePadLoopPattern } from "./padLoopPattern";

export type PatternWorkspaceDraft = { items: PadLoopPatternItem[]; selection: number[] };

/** Deleting an unused saved definition preserves temporary assemblies by expanding its references. */
export function deleteWorkspaceDefinition(pattern: PadLoopPatternState, drafts: Record<string, PatternWorkspaceDraft>, ref: DefinitionRef) {
  if (definitionUses(pattern, ref).length) throw new Error("Definition is used by saved material.");
  const sequence = (ref.kind === "group" ? pattern.groups : pattern.superGroups).find(g => g.id === ref.id)?.sequence;
  if (!sequence) throw new Error("Definition no longer exists.");
  const nextDrafts = Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== `${ref.kind}:${ref.id}`).map(([key, draft]) => {
    const items: PadLoopPatternItem[] = [], selection: number[] = [];
    for (const [index, item] of draft.items.entries()) {
      const matches = ref.kind === "group" ? item.type === "group" && item.groupId === ref.id : item.type === "super" && item.superGroupId === ref.id;
      const replacement = matches ? structuredClone(sequence) : [item];
      if (draft.selection.includes(index)) selection.push(...replacement.map((_, i) => items.length + i));
      items.push(...replacement);
    }
    return [key, { items, selection }];
  }));
  return { pattern: deleteDefinition(pattern, ref), drafts: nextDrafts };
}

/** Resolve audible flattened tokens to the displayed occurrence, including repeated pads and nested phrases. */
export function workspacePlayingIndex(pattern: PadLoopPatternState, items: PadLoopPatternItem[], status: PerformanceAuditionStatus[string] | undefined, gesture: string | null): number {
  if (!gesture || status?.workspace_gesture !== gesture || !status.workspace_active || status.preview_active || status.workspace_position == null) return -1;
  try {
    const compiled = compilePadLoopPattern({ ...pattern, rootSequence: items });
    // Edits may be waiting at the cycle boundary. Never map the old sequence onto a new draft.
    if (JSON.stringify(compiled.sequence) !== JSON.stringify(status.workspace_sequence)) return -1;
    return compiled.rootRanges.findIndex(range => status.workspace_position! >= range.start && status.workspace_position! < range.end);
  } catch { return -1; }
}

export function melodicPadHasSound(pad?: SequencerPadState): boolean {
  return !!pad?.steps.slice(0, pad.stepCount).some(step => step.note !== null && step.velocity > 0);
}

export function drummerPadHasSound(pad?: DrummerSequencerPadState): boolean {
  return !!pad?.rows.some(row => row.steps.slice(0, pad.stepCount).some(cell => cell.active && cell.velocity > 0));
}

export function workspaceSelection(indexes: number[], length: number): number[] {
  return [...new Set(indexes)].filter(i => Number.isInteger(i) && i >= 0 && i < length).sort((a, b) => a - b);
}

export function validateWorkspace(pattern: PadLoopPatternState, items: PadLoopPatternItem[], target: DefinitionRef | null = null) {
  if (target && items.some(item => item.type === "super" || target.kind === "group" && item.type === "group")) {
    throw new Error("Invalid phrase hierarchy.");
  }
  const draft = { ...pattern, rootSequence: items };
  validateArrangementEdit(pattern, draft);
  return compilePadLoopPattern(draft).sequence;
}

export function moveWorkspaceItems(items: PadLoopPatternItem[], indexes: number[], position: number) {
  const selection = workspaceSelection(indexes, items.length);
  const remaining = items.filter((_, i) => !selection.includes(i));
  const insertion = Math.max(0, Math.min(items.length, position)) - selection.filter(i => i < position).length;
  return [...remaining.slice(0, insertion), ...selection.map(i => items[i]), ...remaining.slice(insertion)];
}

export function groupWorkspaceItems(pattern: PadLoopPatternState, items: PadLoopPatternItem[], indexes: number[], kind: "group" | "super", target: DefinitionRef | null = null) {
  const selection = workspaceSelection(indexes, items.length);
  if (selection.length < 2 || selection.some(i => items[i].type === "super" || kind === "group" && items[i].type === "group")) throw new Error("Invalid group selection.");
  const result = createDefinition(pattern, kind, selection.map(i => items[i]));
  const nextItems = items.flatMap((item, i) => i === selection[0] ? [definitionItem(result.ref)] : selection.includes(i) ? [] : [item]);
  validateWorkspace(result.pattern, nextItems, target);
  return { ...result, items: nextItems };
}

export function splitWorkspaceItems(pattern: PadLoopPatternState, items: PadLoopPatternItem[], indexes: number[]) {
  const selection = new Set(indexes);
  return items.flatMap((item, i) => !selection.has(i) ? [item] : item.type === "group"
    ? pattern.groups.find(g => g.id === item.groupId)?.sequence ?? [item]
    : item.type === "super" ? pattern.superGroups.find(g => g.id === item.superGroupId)?.sequence ?? [item] : [item]);
}

export function applyWorkspaceDefinition(pattern: PadLoopPatternState, target: DefinitionRef, items: PadLoopPatternItem[]) {
  validateWorkspace(pattern, items, target);
  const field = target.kind === "group" ? "groups" : "superGroups";
  if (!pattern[field].some(g => g.id === target.id)) throw new Error("Definition no longer exists.");
  const next = { ...pattern, [field]: pattern[field].map(g => g.id === target.id ? { ...g, sequence: structuredClone(items) } : g) };
  validateArrangementEdit(pattern, next);
  return next;
}
