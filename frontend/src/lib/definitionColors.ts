import type { CSSProperties } from "react";
import type { PadLoopPatternItem, PadLoopPatternState } from "../types";

export function definitionColorKey(item: PadLoopPatternItem): string {
  return item.type === "pad" ? `pad:${item.padIndex}` : item.type === "group" ? `group:${item.groupId}`
    : item.type === "super" ? `super:${item.superGroupId}` : "";
}

export function normalizeDefinitionColors(raw: unknown, pattern: PadLoopPatternState): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const valid = new Set([...Array.from({ length: 8 }, (_, i) => `pad:${i}`),
    ...pattern.groups.map(g => `group:${g.id}`), ...pattern.superGroups.map(g => `super:${g.id}`)]);
  const entries = Object.entries(raw).filter(([key, value]) => valid.has(key) && typeof value === "string" && /^#[\da-f]{6}$/i.test(value));
  return entries.length ? Object.fromEntries(entries.map(([key, value]) => [key, (value as string).toLowerCase()])) : undefined;
}

export function setDefinitionColor(pattern: PadLoopPatternState, item: PadLoopPatternItem, color?: string): PadLoopPatternState {
  const colors = { ...pattern.definitionColors };
  const key = definitionColorKey(item);
  if (color) colors[key] = color;
  else delete colors[key];
  const next = { ...pattern };
  const normalized = normalizeDefinitionColors(colors, pattern);
  if (normalized) next.definitionColors = normalized;
  else delete next.definitionColors;
  return next;
}

export function definitionColorStyle(pattern: PadLoopPatternState, item: PadLoopPatternItem): CSSProperties | undefined {
  const color = pattern.definitionColors?.[definitionColorKey(item)];
  if (!color) return undefined;
  const [r, g, b] = [1, 3, 5].map(start => {
    const value = parseInt(color.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return { backgroundColor: color, borderColor: color, color: 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff" };
}
