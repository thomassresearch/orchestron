import type {
  PadLoopGroupPatternState,
  PadLoopPauseStepCount,
  PadLoopPatternItem,
  PadLoopPatternState,
  PadLoopSuperGroupPatternState
} from "../types";

export const PAD_LOOP_PAD_COUNT = 8;
export const PAD_LOOP_COMPILED_MAX_LENGTH = 256;
export const PAD_LOOP_PAUSE_STEP_OPTIONS: readonly PadLoopPauseStepCount[] = [4, 8, 16, 32];
const MAX_PATTERN_DEFINITIONS = 256;
const PAD_LOOP_PAUSE_STEP_SET = new Set<number>(PAD_LOOP_PAUSE_STEP_OPTIONS);

const GROUP_LABEL_RE = /^[A-Z]+$/;
const SUPER_GROUP_LABEL_RE = /^[IVXLCDM]+$/;

export type PadLoopContainerRef =
  | {
      kind: "root";
    }
  | {
      kind: "group";
      id: string;
    }
  | {
      kind: "super";
      id: string;
    };

export interface CompiledPadLoopPattern {
  sequence: number[];
  rootRanges: Array<{ start: number; end: number }>;
}

type ParsedGroupLike = {
  id: string;
  sequence: PadLoopPatternItem[];
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizePadLoopPauseStepCount(value: unknown): PadLoopPauseStepCount | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (PAD_LOOP_PAUSE_STEP_SET.has(rounded)) {
    return rounded as PadLoopPauseStepCount;
  }
  return null;
}

export function normalizePadIndex(value: number): number {
  return clampInt(value, 0, PAD_LOOP_PAD_COUNT - 1);
}

export function encodePadLoopPauseToken(stepCount: PadLoopPauseStepCount): number {
  return -stepCount;
}

export function decodePadLoopPauseToken(token: number): PadLoopPauseStepCount | null {
  if (!Number.isFinite(token)) {
    return null;
  }
  const rounded = Math.round(token);
  if (rounded >= 0) {
    return null;
  }
  const pauseStepCount = Math.abs(rounded);
  if (!PAD_LOOP_PAUSE_STEP_SET.has(pauseStepCount)) {
    return null;
  }
  return pauseStepCount as PadLoopPauseStepCount;
}

export function normalizePadLoopSequenceToken(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  const pauseStepCount = decodePadLoopPauseToken(rounded);
  if (pauseStepCount !== null) {
    return encodePadLoopPauseToken(pauseStepCount);
  }
  if (rounded >= 0 && rounded < PAD_LOOP_PAD_COUNT) {
    return normalizePadIndex(rounded);
  }
  return null;
}

export function padLoopPatternItemFromSequenceToken(value: number): PadLoopPatternItem | null {
  const normalized = normalizePadLoopSequenceToken(value);
  if (normalized === null) {
    return null;
  }
  const pauseStepCount = decodePadLoopPauseToken(normalized);
  if (pauseStepCount !== null) {
    return { type: "pause", stepCount: pauseStepCount };
  }
  return { type: "pad", padIndex: normalizePadIndex(normalized) };
}

export function isPadLoopGroupId(value: string): boolean {
  return GROUP_LABEL_RE.test(value);
}

export function isPadLoopSuperGroupId(value: string): boolean {
  return SUPER_GROUP_LABEL_RE.test(value);
}

function sanitizeGroupId(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const next = raw.trim().toUpperCase();
  return isPadLoopGroupId(next) ? next : null;
}

function sanitizeSuperGroupId(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const next = raw.trim().toUpperCase();
  return isPadLoopSuperGroupId(next) ? next : null;
}

export function clonePadLoopPatternItem(item: PadLoopPatternItem): PadLoopPatternItem {
  if (item.type === "pad") {
    return { type: "pad", padIndex: normalizePadIndex(item.padIndex) };
  }
  if (item.type === "pause") {
    return {
      type: "pause",
      stepCount: normalizePadLoopPauseStepCount(item.stepCount) ?? 4
    };
  }
  if (item.type === "group") {
    return { type: "group", groupId: item.groupId };
  }
  return { type: "super", superGroupId: item.superGroupId };
}

export function clonePadLoopPattern(pattern: PadLoopPatternState): PadLoopPatternState {
  return {
    rootSequence: pattern.rootSequence.map(clonePadLoopPatternItem),
    groups: pattern.groups.map((group) => ({
      id: group.id,
      sequence: group.sequence.map(clonePadLoopPatternItem)
    })),
    superGroups: pattern.superGroups.map((group) => ({
      id: group.id,
      sequence: group.sequence.map(clonePadLoopPatternItem)
    }))
  };
}

export function createEmptyPadLoopPattern(): PadLoopPatternState {
  return {
    rootSequence: [],
    groups: [],
    superGroups: []
  };
}

function itemLevel(item: PadLoopPatternItem): 0 | 1 | 2 {
  if (item.type === "pad" || item.type === "pause") {
    return 0;
  }
  if (item.type === "group") {
    return 1;
  }
  return 2;
}

export function padLoopContainerLevel(container: PadLoopContainerRef): 1 | 2 | 3 {
  if (container.kind === "group") {
    return 1;
  }
  if (container.kind === "super") {
    return 2;
  }
  return 3;
}

function normalizeRootItem(raw: unknown): PadLoopPatternItem | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return padLoopPatternItemFromSequenceToken(raw);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const rawType = typeof item.type === "string" ? item.type : null;
  if (rawType === "pad") {
    const padIndex = item.padIndex ?? item.pad_index;
    if (typeof padIndex !== "number" || !Number.isFinite(padIndex)) {
      return null;
    }
    return { type: "pad", padIndex: normalizePadIndex(padIndex) };
  }
  if (rawType === "pause") {
    const stepCount = normalizePadLoopPauseStepCount(item.stepCount ?? item.step_count ?? item.steps ?? item.length);
    return stepCount === null ? null : { type: "pause", stepCount };
  }
  if (rawType === "group") {
    const groupId = sanitizeGroupId(item.groupId ?? item.group_id ?? item.id);
    return groupId ? { type: "group", groupId } : null;
  }
  if (rawType === "super") {
    const superGroupId = sanitizeSuperGroupId(item.superGroupId ?? item.super_group_id ?? item.id);
    return superGroupId ? { type: "super", superGroupId } : null;
  }
  return null;
}

function parseItemArray(raw: unknown): PadLoopPatternItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const sequence: PadLoopPatternItem[] = [];
  for (const entry of raw) {
    const item = normalizeRootItem(entry);
    if (!item) {
      continue;
    }
    sequence.push(item);
    if (sequence.length >= PAD_LOOP_COMPILED_MAX_LENGTH) {
      break;
    }
  }
  return sequence;
}

function parseGroupDefinitions(
  raw: unknown,
  kind: "group" | "super"
): ParsedGroupLike[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: ParsedGroupLike[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id =
      kind === "group"
        ? sanitizeGroupId(record.id ?? record.label ?? record.name)
        : sanitizeSuperGroupId(record.id ?? record.label ?? record.name);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push({
      id,
      sequence: parseItemArray(record.sequence ?? record.items ?? record.rootSequence ?? record.root_sequence)
    });
    if (result.length >= MAX_PATTERN_DEFINITIONS) {
      break;
    }
  }
  return result;
}

function sanitizePatternWithHierarchyRules(pattern: PadLoopPatternState): PadLoopPatternState {
  const groupIds = new Set(pattern.groups.map((group) => group.id));
  const superGroupIds = new Set(pattern.superGroups.map((group) => group.id));

  const sanitizeGroupSequence = (source: PadLoopPatternItem[]): PadLoopPatternItem[] =>
    source
      .filter(
        (item): item is Extract<PadLoopPatternItem, { type: "pad" | "pause" }> =>
          item.type === "pad" || item.type === "pause"
      )
      .map((item) =>
        item.type === "pad"
          ? ({ type: "pad", padIndex: normalizePadIndex(item.padIndex) } satisfies PadLoopPatternItem)
          : ({
              type: "pause",
              stepCount: normalizePadLoopPauseStepCount(item.stepCount) ?? 4
            } satisfies PadLoopPatternItem)
      );

  const sanitizeSuperGroupSequence = (source: PadLoopPatternItem[]): PadLoopPatternItem[] => {
    const next: PadLoopPatternItem[] = [];
    for (const item of source) {
      if (item.type === "pad") {
        next.push({ type: "pad", padIndex: normalizePadIndex(item.padIndex) });
        continue;
      }
      if (item.type === "pause") {
        next.push({ type: "pause", stepCount: normalizePadLoopPauseStepCount(item.stepCount) ?? 4 });
        continue;
      }
      if (item.type === "group" && groupIds.has(item.groupId)) {
        next.push({ type: "group", groupId: item.groupId });
      }
    }
    return next;
  };

  const sanitizeRootSequence = (source: PadLoopPatternItem[]): PadLoopPatternItem[] => {
    const next: PadLoopPatternItem[] = [];
    for (const item of source) {
      if (item.type === "pad") {
        next.push({ type: "pad", padIndex: normalizePadIndex(item.padIndex) });
        continue;
      }
      if (item.type === "pause") {
        next.push({ type: "pause", stepCount: normalizePadLoopPauseStepCount(item.stepCount) ?? 4 });
        continue;
      }
      if (item.type === "group" && groupIds.has(item.groupId)) {
        next.push({ type: "group", groupId: item.groupId });
        continue;
      }
      if (item.type === "super" && superGroupIds.has(item.superGroupId)) {
        next.push({ type: "super", superGroupId: item.superGroupId });
      }
    }
    return next;
  };

  const sanitizedGroups = pattern.groups.map((group) => ({
    id: group.id,
    sequence: sanitizeGroupSequence(group.sequence)
  }));
  const sanitizedSuperGroups = pattern.superGroups.map((group) => ({
    id: group.id,
    sequence: sanitizeSuperGroupSequence(group.sequence)
  }));
  const sanitizedRootSequence = sanitizeRootSequence(pattern.rootSequence);

  // Keep only definitions that are reachable from the main sequence.
  const reachableSuperGroupIds = new Set<string>();
  const reachableGroupIds = new Set<string>();
  for (const item of sanitizedRootSequence) {
    if (item.type === "group") {
      reachableGroupIds.add(item.groupId);
      continue;
    }
    if (item.type === "super") {
      reachableSuperGroupIds.add(item.superGroupId);
    }
  }

  for (const group of sanitizedSuperGroups) {
    if (!reachableSuperGroupIds.has(group.id)) {
      continue;
    }
    for (const item of group.sequence) {
      if (item.type === "group") {
        reachableGroupIds.add(item.groupId);
      }
    }
  }

  const filteredGroups = sanitizedGroups.filter((group) => reachableGroupIds.has(group.id));
  const filteredGroupIds = new Set(filteredGroups.map((group) => group.id));

  const filteredSuperGroups = sanitizedSuperGroups
    .filter((group) => reachableSuperGroupIds.has(group.id))
    .map((group) => ({
      ...group,
      sequence: group.sequence.filter(
        (item) => item.type === "pad" || (item.type === "group" && filteredGroupIds.has(item.groupId))
      )
    }));

  return {
    rootSequence: sanitizedRootSequence.filter(
      (item) =>
        item.type === "pad" ||
        item.type === "pause" ||
        (item.type === "group" && filteredGroupIds.has(item.groupId)) ||
        (item.type === "super" && reachableSuperGroupIds.has(item.superGroupId))
    ),
    groups: filteredGroups,
    superGroups: filteredSuperGroups
  };
}

export function normalizePadLoopPatternState(
  rawPattern: unknown,
  rawLegacySequence?: unknown
): { pattern: PadLoopPatternState; compiledSequence: number[] } {
  let pattern = createEmptyPadLoopPattern();

  if (rawPattern && typeof rawPattern === "object" && !Array.isArray(rawPattern)) {
    const record = rawPattern as Record<string, unknown>;
    const groups = parseGroupDefinitions(record.groups, "group");
    const superGroups = parseGroupDefinitions(record.superGroups ?? record.super_groups, "super");
    pattern = {
      rootSequence: parseItemArray(record.rootSequence ?? record.root_sequence ?? record.sequence ?? record.items),
      groups: groups.map((group): PadLoopGroupPatternState => ({
        id: group.id,
        sequence: group.sequence
      })),
      superGroups: superGroups.map((group): PadLoopSuperGroupPatternState => ({
        id: group.id,
        sequence: group.sequence
      }))
    };
  } else if (Array.isArray(rawPattern)) {
    pattern = {
      ...createEmptyPadLoopPattern(),
      rootSequence: parseItemArray(rawPattern)
    };
  }

  if (pattern.rootSequence.length === 0 && rawLegacySequence !== undefined) {
    pattern.rootSequence = parseItemArray(rawLegacySequence);
  }

  pattern = sanitizePatternWithHierarchyRules(pattern);
  const compiled = compilePadLoopPattern(pattern).sequence;
  return { pattern, compiledSequence: compiled };
}

function groupSequenceByContainerKind(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef
): PadLoopPatternItem[] | null {
  if (container.kind === "root") {
    return pattern.rootSequence;
  }
  if (container.kind === "group") {
    return pattern.groups.find((group) => group.id === container.id)?.sequence ?? null;
  }
  return pattern.superGroups.find((group) => group.id === container.id)?.sequence ?? null;
}

export function getPadLoopContainerSequence(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef
): PadLoopPatternItem[] | null {
  const sequence = groupSequenceByContainerKind(pattern, container);
  return sequence ? sequence.map(clonePadLoopPatternItem) : null;
}

function replaceContainerSequence(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  nextSequence: PadLoopPatternItem[]
): PadLoopPatternState {
  const next = clonePadLoopPattern(pattern);
  if (container.kind === "root") {
    next.rootSequence = nextSequence.map(clonePadLoopPatternItem);
    return sanitizePatternWithHierarchyRules(next);
  }
  if (container.kind === "group") {
    next.groups = next.groups.map((group) =>
      group.id === container.id ? { ...group, sequence: nextSequence.map(clonePadLoopPatternItem) } : group
    );
    return sanitizePatternWithHierarchyRules(next);
  }
  next.superGroups = next.superGroups.map((group) =>
    group.id === container.id ? { ...group, sequence: nextSequence.map(clonePadLoopPatternItem) } : group
  );
  return sanitizePatternWithHierarchyRules(next);
}

export function canInsertItemIntoPadLoopContainer(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  item: PadLoopPatternItem
): boolean {
  if (itemLevel(item) >= padLoopContainerLevel(container)) {
    return false;
  }
  if (item.type === "group") {
    return pattern.groups.some((group) => group.id === item.groupId);
  }
  if (item.type === "super") {
    return pattern.superGroups.some((group) => group.id === item.superGroupId);
  }
  return true;
}

export function insertPadLoopItem(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  index: number,
  item: PadLoopPatternItem
): PadLoopPatternState {
  if (!canInsertItemIntoPadLoopContainer(pattern, container, item)) {
    return pattern;
  }
  const sequence = groupSequenceByContainerKind(pattern, container);
  if (!sequence) {
    return pattern;
  }
  const nextSequence = sequence.map(clonePadLoopPatternItem);
  const insertionIndex = clampInt(index, 0, nextSequence.length);
  nextSequence.splice(insertionIndex, 0, clonePadLoopPatternItem(item));
  return replaceContainerSequence(pattern, container, nextSequence);
}

export function movePadLoopItemWithinContainer(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  fromIndex: number,
  toIndex: number
): PadLoopPatternState {
  const sequence = groupSequenceByContainerKind(pattern, container);
  if (!sequence || sequence.length === 0) {
    return pattern;
  }
  const sourceIndex = clampInt(fromIndex, 0, sequence.length - 1);
  const rawTargetIndex = clampInt(toIndex, 0, sequence.length);
  const nextSequence = sequence.map(clonePadLoopPatternItem);
  const [moved] = nextSequence.splice(sourceIndex, 1);
  if (!moved) {
    return pattern;
  }
  const targetIndex = rawTargetIndex > sourceIndex ? rawTargetIndex - 1 : rawTargetIndex;
  nextSequence.splice(clampInt(targetIndex, 0, nextSequence.length), 0, moved);
  return replaceContainerSequence(pattern, container, nextSequence);
}

export function removePadLoopItemsFromContainer(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  indexes: number[]
): PadLoopPatternState {
  const sequence = groupSequenceByContainerKind(pattern, container);
  if (!sequence || sequence.length === 0) {
    return pattern;
  }
  const removeSet = new Set(
    indexes
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.round(value))
      .filter((value) => value >= 0 && value < sequence.length)
  );
  if (removeSet.size === 0) {
    return pattern;
  }
  const nextSequence = sequence.filter((_, index) => !removeSet.has(index));
  return replaceContainerSequence(pattern, container, nextSequence);
}

function spliceSelection(
  sequence: PadLoopPatternItem[],
  indexes: number[],
  replacement: PadLoopPatternItem[]
): PadLoopPatternItem[] {
  const sorted = Array.from(
    new Set(
      indexes
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value))
        .filter((value) => value >= 0 && value < sequence.length)
    )
  ).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return sequence.map(clonePadLoopPatternItem);
  }
  const first = sorted[0];
  const selectedSet = new Set(sorted);
  const next: PadLoopPatternItem[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    if (index === first) {
      for (const item of replacement) {
        next.push(clonePadLoopPatternItem(item));
      }
    }
    if (selectedSet.has(index)) {
      continue;
    }
    next.push(clonePadLoopPatternItem(sequence[index]));
  }
  return next;
}

function alphaLabelFor(index: number): string {
  let value = Math.max(0, Math.floor(index));
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function romanLabelFor(value: number): string {
  const entries: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let remaining = clampInt(value, 1, 3999);
  let result = "";
  for (const [amount, symbol] of entries) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result || "I";
}

export function nextPadLoopGroupId(existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds, (id) => id.trim().toUpperCase()).filter(isPadLoopGroupId));
  for (let index = 0; index < 4096; index += 1) {
    const candidate = alphaLabelFor(index);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `G${Date.now()}`;
}

export function nextPadLoopSuperGroupId(existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds, (id) => id.trim().toUpperCase()).filter(isPadLoopSuperGroupId));
  for (let index = 1; index <= 3999; index += 1) {
    const candidate = romanLabelFor(index);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `M${Date.now()}`;
}

export function groupPadLoopItemsInContainer(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  indexes: number[],
  target: "group" | "super"
): PadLoopPatternState {
  const sequence = groupSequenceByContainerKind(pattern, container);
  if (!sequence || sequence.length === 0) {
    return pattern;
  }
  const sorted = Array.from(
    new Set(
      indexes
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value))
        .filter((value) => value >= 0 && value < sequence.length)
    )
  ).sort((a, b) => a - b);
  if (sorted.length < 2) {
    return pattern;
  }
  const selectedItems = sorted.map((index) => sequence[index]).filter(Boolean);
  const targetLevel = target === "group" ? 1 : 2;
  if (targetLevel >= padLoopContainerLevel(container)) {
    return pattern;
  }
  if (selectedItems.some((item) => itemLevel(item) >= targetLevel)) {
    return pattern;
  }

  const next = clonePadLoopPattern(pattern);
  if (target === "group") {
    const id = nextPadLoopGroupId(next.groups.map((group) => group.id));
    next.groups = [
      ...next.groups,
      {
        id,
        sequence: selectedItems.map(clonePadLoopPatternItem)
      }
    ];
    const replacement: PadLoopPatternItem[] = [{ type: "group", groupId: id }];
    return replaceContainerSequence(next, container, spliceSelection(sequence, sorted, replacement));
  }

  const id = nextPadLoopSuperGroupId(next.superGroups.map((group) => group.id));
  next.superGroups = [
    ...next.superGroups,
    {
      id,
      sequence: selectedItems.map(clonePadLoopPatternItem)
    }
  ];
  const replacement: PadLoopPatternItem[] = [{ type: "super", superGroupId: id }];
  return replaceContainerSequence(next, container, spliceSelection(sequence, sorted, replacement));
}

function resolvedImmediateSequence(
  pattern: PadLoopPatternState,
  item: PadLoopPatternItem
): PadLoopPatternItem[] {
  if (item.type === "pad") {
    return [clonePadLoopPatternItem(item)];
  }
  if (item.type === "pause") {
    return [clonePadLoopPatternItem(item)];
  }
  if (item.type === "group") {
    const group = pattern.groups.find((candidate) => candidate.id === item.groupId);
    return group ? group.sequence.map(clonePadLoopPatternItem) : [];
  }
  const group = pattern.superGroups.find((candidate) => candidate.id === item.superGroupId);
  return group ? group.sequence.map(clonePadLoopPatternItem) : [];
}

export function ungroupPadLoopItemsInContainer(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  indexes: number[]
): PadLoopPatternState {
  const sequence = groupSequenceByContainerKind(pattern, container);
  if (!sequence || sequence.length === 0) {
    return pattern;
  }
  const sorted = Array.from(
    new Set(
      indexes
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value))
        .filter((value) => value >= 0 && value < sequence.length)
    )
  ).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return pattern;
  }
  const selectedSet = new Set(sorted);
  const firstSelected = sorted[0];
  const replacement: PadLoopPatternItem[] = [];
  let didUngroup = false;
  for (const index of sorted) {
    const item = sequence[index];
    if (!item) {
      continue;
    }
    if (item.type === "pad") {
      replacement.push(clonePadLoopPatternItem(item));
      continue;
    }
    didUngroup = true;
    for (const nested of resolvedImmediateSequence(pattern, item)) {
      if (canInsertItemIntoPadLoopContainer(pattern, container, nested)) {
        replacement.push(nested);
      }
    }
  }
  if (!didUngroup) {
    return pattern;
  }
  const nextSequence: PadLoopPatternItem[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    if (index === firstSelected) {
      nextSequence.push(...replacement.map(clonePadLoopPatternItem));
    }
    if (selectedSet.has(index)) {
      continue;
    }
    nextSequence.push(clonePadLoopPatternItem(sequence[index]));
  }
  return replaceContainerSequence(pattern, container, nextSequence);
}

export function compilePadLoopPattern(pattern: PadLoopPatternState): CompiledPadLoopPattern {
  const groupMap = new Map(pattern.groups.map((group) => [group.id, group]));
  const superGroupMap = new Map(pattern.superGroups.map((group) => [group.id, group]));
  const sequence: number[] = [];
  const rootRanges: Array<{ start: number; end: number }> = [];

  const appendItem = (item: PadLoopPatternItem, path: string[]): void => {
    if (sequence.length >= PAD_LOOP_COMPILED_MAX_LENGTH) {
      return;
    }
    if (item.type === "pad") {
      sequence.push(normalizePadIndex(item.padIndex));
      return;
    }
    if (item.type === "pause") {
      sequence.push(encodePadLoopPauseToken(item.stepCount));
      return;
    }
    if (item.type === "group") {
      if (path.includes(`group:${item.groupId}`)) {
        return;
      }
      const group = groupMap.get(item.groupId);
      if (!group) {
        return;
      }
      for (const nested of group.sequence) {
        appendItem(nested, [...path, `group:${item.groupId}`]);
        if (sequence.length >= PAD_LOOP_COMPILED_MAX_LENGTH) {
          return;
        }
      }
      return;
    }
    if (path.includes(`super:${item.superGroupId}`)) {
      return;
    }
    const superGroup = superGroupMap.get(item.superGroupId);
    if (!superGroup) {
      return;
    }
    for (const nested of superGroup.sequence) {
      appendItem(nested, [...path, `super:${item.superGroupId}`]);
      if (sequence.length >= PAD_LOOP_COMPILED_MAX_LENGTH) {
        return;
      }
    }
  };

  for (const item of pattern.rootSequence) {
    const start = sequence.length;
    appendItem(item, []);
    rootRanges.push({ start, end: sequence.length });
    if (sequence.length >= PAD_LOOP_COMPILED_MAX_LENGTH) {
      break;
    }
  }

  return {
    sequence,
    rootRanges
  };
}

export function itemDisplayLabel(item: PadLoopPatternItem): string {
  if (item.type === "pad") {
    return String(normalizePadIndex(item.padIndex) + 1);
  }
  if (item.type === "pause") {
    return `P${item.stepCount}`;
  }
  if (item.type === "group") {
    return item.groupId;
  }
  return item.superGroupId;
}

export function itemColorKind(item: PadLoopPatternItem): "pad" | "pause" | "group" | "super" {
  return item.type;
}

export function canCreatePadLoopGroupFromSelection(
  pattern: PadLoopPatternState,
  container: PadLoopContainerRef,
  indexes: number[],
  target: "group" | "super"
): boolean {
  const sequence = groupSequenceByContainerKind(pattern, container);
  if (!sequence) {
    return false;
  }
  const selected = Array.from(
    new Set(
      indexes
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value))
        .filter((value) => value >= 0 && value < sequence.length)
    )
  );
  if (selected.length < 2) {
    return false;
  }
  const targetLevel = target === "group" ? 1 : 2;
  if (targetLevel >= padLoopContainerLevel(container)) {
    return false;
  }
  const items = selected.map((index) => sequence[index]).filter(Boolean);
  if (items.some((item) => itemLevel(item) >= targetLevel)) {
    return false;
  }
  if (target === "super" && items.some((item) => item.type !== "group")) {
    return false;
  }
  return true;
}
