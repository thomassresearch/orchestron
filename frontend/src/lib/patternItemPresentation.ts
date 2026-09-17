import type { PadLoopPatternItem } from "../types";

/** Keep a definition's colour stable across pads, palettes, phrases and song occurrences. */
export const PATTERN_ITEM_COLORS: Record<PadLoopPatternItem["type"], string> = {
  pad: "border-emerald-700 bg-emerald-950 text-emerald-100",
  group: "border-red-700 bg-red-950 text-red-100",
  super: "border-violet-700 bg-violet-950 text-violet-100",
  pause: "border-slate-600 bg-slate-900 text-slate-200"
};

export function patternItemButtonClass(type: PadLoopPatternItem["type"]): string {
  return `rounded border px-2 py-1 text-xs hover:border-accent disabled:opacity-40 aria-pressed:ring-2 aria-pressed:ring-cyan-400 ${PATTERN_ITEM_COLORS[type]}`;
}

export function patternPadClass(editing: boolean, queued: boolean): string {
  return `${PATTERN_ITEM_COLORS.pad} hover:border-emerald-400 ${editing ? "ring-2 ring-cyan-400" : ""} ${queued ? "outline outline-1 outline-offset-2 outline-amber-400" : ""}`;
}
