import type { DrummerSequencerPadState, PadLoopPatternItem, PadLoopPatternState, SequencerPadState } from "../types";
import { createDefinition, definitionItem, validateArrangementEdit, type DefinitionRef } from "./arrangementEditing";
import { compilePadLoopPattern } from "./padLoopPattern";

export type PatternWorkspaceDraft = { items: PadLoopPatternItem[]; selection: number[] };

/** Includes unsaved references even when their workspace panel is unmounted. */
export function workspaceUsesDefinition(pattern: PadLoopPatternState, drafts: Record<string, PatternWorkspaceDraft>, ref: DefinitionRef): boolean {
  return Object.entries(drafts).some(([key, draft]) => draft.items.some(item => ref.kind === "group"
    ? item.type === "group" && item.groupId === ref.id : item.type === "super" && item.superGroupId === ref.id) ||
    key === `${ref.kind}:${ref.id}` && JSON.stringify(draft.items) !== JSON.stringify((ref.kind === "group" ? pattern.groups : pattern.superGroups).find(g => g.id === ref.id)?.sequence));
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
