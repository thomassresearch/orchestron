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
  controlWidth?: number;
  controlGapX?: number;
  controlGapY?: number;
  groupPadding?: number;
  cardPadding?: number;
  headerHeight?: number;
  textWidth?: (text: string) => number;
}

export interface ControllerGroupSize extends SizeOption {
  columns: number;
  controlRows: number;
  unusedArea: number;
}
export interface ControllerGroupLayout extends PackedLayout {
  items: Array<ControllerGroupSize & { row: number }>;
}
export const GROUP_HEIGHT_TOLERANCE = 0.05;

export function controllerGroupOptions(group: ControllerGroup, availableWidth: number, metrics: RackMetrics = {}): ControllerGroupSize[] {
  const width = Math.max(1, Math.floor(availableWidth));
  const padding = group.name ? (metrics.groupPadding ?? GROUP_PADDING) : 0;
  const tileWidth = metrics.controlWidth ?? CONTROL_WIDTH;
  const tileHeight = metrics.controlHeight ?? CONTROL_HEIGHT;
  const gapX = metrics.controlGapX ?? RACK_GAP;
  const gapY = metrics.controlGapY ?? CONTROL_GAP_Y;
  const maxColumns = Math.max(1, Math.min(group.controllers.length, Math.floor((width - padding + gapX) / (tileWidth + gapX))));
  return Array.from({ length: maxColumns }, (_, index) => {
    const columns = index + 1;
    const candidate = Math.min(width, Math.ceil(padding + columns * tileWidth + (columns - 1) * gapX));
    const controlRows = Math.ceil(group.controllers.length / columns);
    // The legend has its own horizontal padding in addition to the fieldset's.
    const legend = group.name ? 18 * Math.max(1, Math.ceil((metrics.textWidth?.(group.name) ?? group.name.length * 7) / Math.max(1, candidate - padding - 8))) + 10 : 0;
    const height = controlRows * tileHeight + (controlRows - 1) * gapY + legend;
    return { width: candidate, height, columns, controlRows,
      unusedArea: Math.max(0, candidate * height - group.controllers.length * tileWidth * tileHeight) };
  });
}

type GroupPlan = { height: number; unusedArea: number; controlRows: number; shelves: ControllerGroupSize[][] };
const compareGroupCost = (a: { unusedArea: number; controlRows: number }, b: { unusedArea: number; controlRows: number }) =>
  a.unusedArea - b.unusedArea || a.controlRows - b.controlRows;

/** Exact ordered shelves: optimize shape combinations under a width budget, then
 * choose row breaks within 5% of the minimum total height. Internal whitespace
 * includes vacant slots and the space around tiles, never the empty shelf tail.
 * Groups are not stretched. Pareto pruning retains only useful width/height costs.
 */
export function layoutControllerGroups(groups: ControllerGroup[], availableWidth: number, metrics: RackMetrics = {}): ControllerGroupLayout {
  if (!groups.length) return { items: [], height: 0, unusedArea: 0 };
  const width = Math.max(1, Math.floor(availableWidth));
  const options = groups.map(group => controllerGroupOptions(group, width, metrics));
  const heights = [...new Set(options.flatMap(sizes => sizes.map(size => size.height)))].sort((a, b) => a - b);
  type Shelf = { width: number; height: number; unusedArea: number; controlRows: number; items: ControllerGroupSize[] };
  const shelves = options.map(() => new Map<number, Map<number, Shelf>>());
  for (let start = 0; start < options.length; start++) {
    for (const limit of heights) {
      let states: Shelf[] = [{ width: 0, height: 0, unusedArea: 0, controlRows: 0, items: [] }];
      for (let end = start; end < options.length; end++) {
        const next = new Map<number, Shelf>();
        for (const state of states) for (const size of options[end]) {
          const used = state.width + (end > start ? RACK_GAP : 0) + size.width;
          if (size.height > limit || used > width) continue;
          const candidate: Shelf = { width: used, height: Math.max(state.height, size.height),
            unusedArea: state.unusedArea + size.unusedArea, controlRows: state.controlRows + size.controlRows,
            items: [...state.items, size] };
          const previous = next.get(used);
          if (!previous || compareGroupCost(candidate, previous) < 0 ||
            (compareGroupCost(candidate, previous) === 0 && candidate.height < previous.height)) next.set(used, candidate);
        }
        states = [];
        for (const candidate of [...next.values()].sort((a, b) => a.width - b.width)) {
          if (!states.length || compareGroupCost(candidate, states[states.length - 1]) < 0) states.push(candidate);
        }
        if (!states.length) break;
        const best = states[states.length - 1];
        const byHeight = shelves[start].get(end) ?? new Map<number, Shelf>();
        const previous = byHeight.get(best.height);
        if (!previous || compareGroupCost(best, previous) < 0) byHeight.set(best.height, best);
        shelves[start].set(end, byHeight);
      }
    }
  }
  const minimum = Array<number>(groups.length + 1).fill(0);
  for (let start = groups.length - 1; start >= 0; start--) {
    minimum[start] = Math.min(...[...shelves[start]].flatMap(([end, variants]) =>
      [...variants.values()].map(shelf => shelf.height + (end + 1 < groups.length ? RACK_GAP + minimum[end + 1] : 0))));
  }
  const limit = minimum[0] * (1 + GROUP_HEIGHT_TOLERANCE);
  const plans: GroupPlan[][] = Array.from({ length: groups.length + 1 }, () => []);
  plans[groups.length] = [{ height: 0, unusedArea: 0, controlRows: 0, shelves: [] }];
  for (let start = groups.length - 1; start >= 0; start--) {
    const byHeight = new Map<number, GroupPlan>();
    // Equal-cost plans fill earlier shelves first, retaining natural reading order.
    for (const [end, variants] of [...shelves[start]].sort((a, b) => b[0] - a[0])) for (const shelf of variants.values()) for (const tail of plans[end + 1]) {
      const height = shelf.height + (tail.shelves.length ? RACK_GAP + tail.height : 0);
      if (height > limit) continue;
      const candidate: GroupPlan = { height, unusedArea: shelf.unusedArea + tail.unusedArea,
        controlRows: shelf.controlRows + tail.controlRows, shelves: [shelf.items, ...tail.shelves] };
      const previous = byHeight.get(height);
      if (!previous || compareGroupCost(candidate, previous) < 0) byHeight.set(height, candidate);
    }
    for (const candidate of [...byHeight.values()].sort((a, b) => a.height - b.height)) {
      const frontier = plans[start];
      if (!frontier.length || compareGroupCost(candidate, frontier[frontier.length - 1]) < 0) frontier.push(candidate);
    }
  }
  const best = plans[0][plans[0].length - 1];
  return { items: best.shelves.flatMap((shelf, row) => shelf.map(size => ({ ...size, row }))),
    height: best.height, unusedArea: best.unusedArea };
}

/** Shared grid lines let groups change shelves without reparenting focused inputs. */
export function controllerGroupGrid(layout: ControllerGroupLayout) {
  let left = 0;
  const bounds = layout.items.map((item, index) => {
    if (index === 0 || item.row !== layout.items[index - 1].row) left = 0;
    const start = left;
    left += item.width + RACK_GAP;
    return [start, start + item.width];
  });
  const lines = [...new Set(bounds.flat())].sort((a, b) => a - b);
  return {
    columns: [...lines.slice(1).map((line, index) => `${line - lines[index]}px`), 'minmax(0, 1fr)'].join(' '),
    items: bounds.map(([start, end], index) => ({ gridColumn: `${lines.indexOf(start) + 1} / ${lines.indexOf(end) + 1}`, gridRow: layout.items[index].row + 1 }))
  };
}

export interface RackCardContent {
  definitions: PerformanceControllerDefinition[];
  notices?: string[];
}

export function instrumentSizeOptions(content: RackCardContent, availableWidth: number, metrics: RackMetrics = {}): SizeOption[] {
  const width = Math.max(1, Math.floor(availableWidth));
  const cardPadding = metrics.cardPadding ?? CARD_PADDING;
  const minimum = Math.min(MIN_CARD_WIDTH, width);
  const groups = groupControllers(content.definitions);
  const candidates = new Set([minimum, width]);
  // Include group breakpoints and combinations of groups sharing one row.
  let sums = new Set([0]);
  for (const group of groups) {
    const groupWidths = controllerGroupOptions(group, width - cardPadding, metrics).map(size => size.width);
    const next = new Set<number>();
    for (const previous of sums) for (const groupWidth of groupWidths) {
      const sum = previous + (previous ? RACK_GAP : 0) + groupWidth;
      if (sum + cardPadding <= width) next.add(sum);
    }
    for (const sum of next) if (sum + cardPadding >= minimum) candidates.add(sum + cardPadding);
    // A new group can start a new row. Widths are integer CSS pixels, bounded by container width.
    sums = new Set([0, ...next]);
    for (const groupWidth of groupWidths) if (groupWidth + cardPadding >= minimum) candidates.add(groupWidth + cardPadding);
  }
  return [...candidates].filter(candidate => candidate <= width).sort((a, b) => a - b).map(candidate => {
    const inner = Math.max(1, candidate - cardPadding);
    const notices = (content.notices ?? []).reduce((sum, text) => sum + 8 + 16 * Math.max(1, Math.ceil((metrics.textWidth?.(text) ?? text.length * 7) / inner)), 0);
    return { width: candidate, height: (metrics.headerHeight ?? 58) + cardPadding + notices +
      (groups.length ? 21 + layoutControllerGroups(groups, inner, metrics).height : 0) };
  });
}
