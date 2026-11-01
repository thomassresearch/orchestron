import type { PerformanceControllerDefinition } from "../types";

// Shared with the rack widgets. Heights include the value editor and MIDI selector.
export const RACK_GAP = 8;
export const CONTROL_WIDTH = 80;
export const CONTROL_GAP_Y = 16;
export const CONTROL_HEIGHT = 216;
export const CARD_PADDING = 18;
export const GROUP_PADDING = 18;
export const MIN_CARD_WIDTH = 360;

export interface SizeOption { width: number; height: number }
export interface PackedItem extends SizeOption { row: number }
export interface PackedLayout { items: PackedItem[]; height: number; unusedArea: number }

/** Ordered shelf packing. For a given row height, the narrowest legal option for
 * each item determines feasibility. This avoids enumerating width combinations.
 * The outer DP chooses row breaks; equal costs retain the first deterministic fit.
 */
export function packOrdered(options: SizeOption[][], availableWidth: number, gap = RACK_GAP): PackedLayout {
  const width = Math.max(1, Math.floor(availableWidth));
  const sizes = options.map(item => item.filter(size => size.width <= width).sort((a, b) => a.width - b.width));
  if (sizes.some(item => !item.length)) throw new Error("Every rack item needs an option that fits the container.");
  const best: Array<{ height: number; unusedArea: number; rows: SizeOption[][] }> = Array(sizes.length + 1);
  best[sizes.length] = { height: 0, unusedArea: 0, rows: [] };
  for (let start = sizes.length - 1; start >= 0; start--) {
    let minimumWidth = -gap;
    const heights = new Set<number>();
    for (let end = start; end < sizes.length; end++) {
      minimumWidth += sizes[end][0].width + gap;
      if (minimumWidth > width) break;
      sizes[end].forEach(size => heights.add(size.height));
      for (const height of [...heights].sort((a, b) => a - b)) {
        const row: SizeOption[] = [];
        for (let index = start; index <= end; index++) {
          const size = sizes[index].find(size => size.height <= height);
          if (!size) break;
          row.push({ ...size });
        }
        if (row.length !== end - start + 1) continue;
        let spare = width - row.reduce((sum, item) => sum + item.width, 0) - gap * (row.length - 1);
        if (spare < 0) continue;
        // Spend spare width on the tallest content first, reducing empty row area.
        const priority = row.map((_, i) => i).sort((a, b) => row[b].height - row[a].height || a - b);
        for (const index of priority) {
          const expanded = [...sizes[start + index]].reverse().find(size => size.width <= row[index].width + spare && size.height <= height)!;
          spare -= expanded.width - row[index].width;
          row[index] = { ...expanded };
        }
        row[priority[0]].width += spare;
        const rowHeight = Math.max(...row.map(item => item.height));
        const tail = best[end + 1];
        const candidate = {
          height: rowHeight + (tail.rows.length ? gap + tail.height : 0),
          unusedArea: row.reduce((sum, item) => sum + item.width * (rowHeight - item.height), 0) + tail.unusedArea,
          rows: [row, ...tail.rows]
        };
        const previous = best[start];
        if (!previous || candidate.height < previous.height || (candidate.height === previous.height && candidate.unusedArea < previous.unusedArea)) best[start] = candidate;
      }
    }
  }
  const result = best[0];
  return { items: result.rows.flatMap((row, index) => row.map(item => ({ ...item, row: index }))), height: result.height, unusedArea: result.unusedArea };
}

export interface ControllerGroup { name: string; controllers: PerformanceControllerDefinition[] }
export function groupControllers(definitions: PerformanceControllerDefinition[]): ControllerGroup[] {
  const groups = new Map<string, ControllerGroup>();
  for (const definition of definitions) {
    const name = typeof definition.controller_group === "string" ? definition.controller_group.trim() : "";
    if (!groups.has(name)) groups.set(name, { name, controllers: [] });
    groups.get(name)!.controllers.push(definition);
  }
  return [...groups.values()];
}

export interface RackMetrics {
  controlHeight?: number;
  headerHeight?: number;
  textWidth?: (text: string) => number;
}

export function controllerGroupOptions(group: ControllerGroup, availableWidth: number, metrics: RackMetrics = {}): SizeOption[] {
  const width = Math.max(1, Math.floor(availableWidth));
  const padding = group.name ? GROUP_PADDING : 0;
  const maxColumns = Math.max(1, Math.min(group.controllers.length, Math.floor((width - padding + RACK_GAP) / (CONTROL_WIDTH + RACK_GAP))));
  const widths = new Set([width]);
  for (let columns = 1; columns <= maxColumns; columns++) widths.add(Math.min(width, padding + columns * (CONTROL_WIDTH + RACK_GAP) - RACK_GAP));
  return [...widths].sort((a, b) => a - b).map(candidate => {
    const columns = Math.max(1, Math.floor((candidate - padding + RACK_GAP) / (CONTROL_WIDTH + RACK_GAP)));
    const rows = Math.ceil(group.controllers.length / columns);
    const legend = group.name ? 18 * Math.max(1, Math.ceil((metrics.textWidth?.(group.name) ?? group.name.length * 7) / Math.max(1, candidate - padding))) + 10 : 0;
    return { width: candidate, height: rows * (metrics.controlHeight ?? CONTROL_HEIGHT) + (rows - 1) * CONTROL_GAP_Y + legend };
  });
}

export function layoutControllerGroups(groups: ControllerGroup[], width: number, metrics: RackMetrics = {}): PackedLayout {
  return packOrdered(groups.map(group => controllerGroupOptions(group, width, metrics)), width);
}

export interface RackCardContent {
  definitions: PerformanceControllerDefinition[];
  notices?: string[];
}

export function instrumentSizeOptions(content: RackCardContent, availableWidth: number, metrics: RackMetrics = {}): SizeOption[] {
  const width = Math.max(1, Math.floor(availableWidth));
  const minimum = Math.min(MIN_CARD_WIDTH, width);
  const groups = groupControllers(content.definitions);
  const candidates = new Set([minimum, width]);
  // Include group breakpoints and combinations of groups sharing one row.
  let sums = new Set([0]);
  for (const group of groups) {
    const groupWidths = controllerGroupOptions(group, width - CARD_PADDING, metrics).map(size => size.width);
    const next = new Set<number>();
    for (const previous of sums) for (const groupWidth of groupWidths) {
      const sum = previous + (previous ? RACK_GAP : 0) + groupWidth;
      if (sum + CARD_PADDING <= width) next.add(sum);
    }
    for (const sum of next) if (sum + CARD_PADDING >= minimum) candidates.add(sum + CARD_PADDING);
    // A new group can start a new row. Widths are integer CSS pixels, bounded by container width.
    sums = new Set([0, ...next]);
    for (const groupWidth of groupWidths) if (groupWidth + CARD_PADDING >= minimum) candidates.add(groupWidth + CARD_PADDING);
  }
  return [...candidates].filter(candidate => candidate <= width).sort((a, b) => a - b).map(candidate => {
    const inner = Math.max(1, candidate - CARD_PADDING);
    const notices = (content.notices ?? []).reduce((sum, text) => sum + 8 + 16 * Math.max(1, Math.ceil((metrics.textWidth?.(text) ?? text.length * 7) / inner)), 0);
    return { width: candidate, height: (metrics.headerHeight ?? 58) + CARD_PADDING + notices +
      (groups.length ? 21 + layoutControllerGroups(groups, inner, metrics).height : 0) };
  });
}
