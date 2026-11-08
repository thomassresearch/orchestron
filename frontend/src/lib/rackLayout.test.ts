import { describe, expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/controller_rack_layout.json";
import type { PerformanceControllerDefinition } from "../types";
import { controllerGroupOptions, layoutControllerGroups, groupControllers, instrumentSizeOptions, packOrdered, RACK_GAP, type SizeOption } from "./rackLayout";

const cards = fixture.cards as Array<{ definitions: PerformanceControllerDefinition[] }>;
describe("ordered rack packing", () => {
  it("collects groups by first appearance, retaining controller order and case", () => {
    const definitions = [" Filter ", "", "Envelope", "Filter", "filter", " "].map((controller_group, i) => ({ ...cards[1].definitions[0], node_id: String(i), controller_group }));
    expect(groupControllers(definitions).map(group => [group.name, group.controllers.map(control => control.node_id)])).toEqual([
      ["Filter", ["0", "3"]], ["", ["1", "5"]], ["Envelope", ["2"]], ["filter", ["4"]]
    ]);
  });
  it.each([280, 768, 1280, 1920, 3440])("packs 0/4/16/32/64 controllers without overlap at %i px", width => {
    const options = cards.map(card => instrumentSizeOptions(card, width));
    const layout = packOrdered(options, width);
    expect(layout).toEqual(packOrdered(options, width));
    expect(layout.items).toHaveLength(cards.length);
    expect(layout.items.map(item => item.row)).toEqual([...layout.items.map(item => item.row)].sort((a, b) => a - b));
    for (const row of new Set(layout.items.map(item => item.row))) {
      const items = layout.items.filter(item => item.row === row);
      expect(items.reduce((sum, item) => sum + item.width, 0) + (items.length - 1) * RACK_GAP).toBe(width);
      expect(items.every(item => item.width >= Math.min(width, 360))).toBe(true);
    }
  });
  it("gives a large instrument full width and beats equal columns in a mixed rack", () => {
    const contents = [cards[3], cards[1], cards[0]];
    const options = contents.map(card => instrumentSizeOptions(card, 1280));
    const packed = packOrdered(options, 1280);
    const oldWidth = (1280 - 8) / 2;
    const oldHeights = contents.map(card => { const sizes = instrumentSizeOptions(card, oldWidth); return sizes[sizes.length - 1].height; });
    expect(packed.height).toBeLessThan(Math.max(...oldHeights.slice(0, 2)) + 8 + oldHeights[2]);
    expect(packOrdered([options[0]], 1280).items[0].width).toBe(1280);
  });
  it("matches exhaustive minimum height for small irregular inputs", () => {
    const options: SizeOption[][] = [
      [{ width: 3, height: 9 }, { width: 6, height: 4 }, { width: 12, height: 2 }],
      [{ width: 3, height: 4 }, { width: 7, height: 2 }],
      [{ width: 4, height: 7 }, { width: 9, height: 3 }]
    ];
    const brute = (index: number): number => {
      if (index === options.length) return 0;
      let best = Infinity;
      const visit = (end: number, width: number, height: number) => {
        for (const size of options[end]) {
          const nextWidth = width + (end > index ? 1 : 0) + size.width;
          if (nextWidth > 12) continue;
          const nextHeight = Math.max(height, size.height);
          best = Math.min(best, nextHeight + (end + 1 < options.length ? 1 + brute(end + 1) : 0));
          if (end + 1 < options.length) visit(end + 1, nextWidth, nextHeight);
        }
      };
      visit(index, 0, 0);
      return best;
    };
    expect(packOrdered(options, 12, 1).height).toBe(brute(0));
  });
  it("handles empty racks and 64 instruments", () => {
    expect(packOrdered([], 1200)).toEqual({ items: [], height: 0, unusedArea: 0 });
    expect(packOrdered(Array.from({ length: 64 }, () => instrumentSizeOptions(cards[1], 1920)), 1920).items).toHaveLength(64);
  });
});

const makeGroups = (counts: number[], names = counts.map((_, index) => `Group ${index}`)) => counts.map((count, index) => ({
  name: names[index], controllers: Array.from({ length: count }, (_, i) => ({ ...cards[1].definitions[0], node_id: `${index}:${i}` }))
}));

describe("compact controller groups", () => {
  it("fits the four Envelope controls horizontally within the 5% height allowance", () => {
    const groups = makeGroups([3, 3, 2, 4, 2], ["Wavetable", "Motion", "Stereo", "Envelope", "Output & MIDI"]);
    const result = layoutControllerGroups(groups, 1070);
    expect(result.items.map(item => item.columns)).toEqual([3, 3, 2, 4, 2]);
    expect(result.items.map(item => item.row)).toEqual([0, 0, 0, 1, 1]);
    expect(result.items.map(item => item.width)).toEqual([274, 274, 186, 362, 186]);
    const minimum = packOrdered(groups.map(group => controllerGroupOptions(group, 1070)), 1070).height;
    expect(result.height).toBeGreaterThan(minimum);
    expect(result.height).toBeLessThanOrEqual(minimum * 1.05);
  });

  it("uses measured fractional geometry and keeps wide containers' groups tight", () => {
    const groups = makeGroups([4]);
    const metrics = { controlWidth: 85.25, controlGapX: 8.5, groupPadding: 18.36 };
    const result = layoutControllerGroups(groups, 1600, metrics);
    expect(result.items[0]).toMatchObject({ columns: 4, controlRows: 1, width: 385 });
    expect(layoutControllerGroups(groups, 200, metrics).items[0].columns).toBe(2);
    expect(layoutControllerGroups(groups, 1600, metrics)).toEqual(result);
    expect(layoutControllerGroups([], 1000).items).toEqual([]);
  });

  it("matches exhaustive height-constrained whitespace optimization across irregular groups", () => {
    for (const counts of [[3, 4, 2], [2, 5, 3, 2], [1, 4, 3]]) for (const width of [190, 380, 570, 760, 1070]) {
      const groups = makeGroups(counts, counts.map((_, i) => i === 0 ? "A longer controller group title" : i === 1 ? "" : "Tone"));
      const options = groups.map(group => controllerGroupOptions(group, width));
      const candidates: Array<{ height: number; unusedArea: number; controlRows: number }> = [];
      const visit = (index: number, shelfWidth: number, shelfHeight: number, priorHeight: number, unusedArea: number, controlRows: number) => {
        if (index === groups.length) { candidates.push({ height: priorHeight + shelfHeight, unusedArea, controlRows }); return; }
        for (const size of options[index]) {
          const nextWidth = shelfWidth + (shelfWidth ? RACK_GAP : 0) + size.width;
          if (nextWidth <= width) visit(index + 1, nextWidth, Math.max(shelfHeight, size.height), priorHeight, unusedArea + size.unusedArea, controlRows + size.controlRows);
          if (shelfWidth) visit(index + 1, size.width, size.height, priorHeight + shelfHeight + RACK_GAP, unusedArea + size.unusedArea, controlRows + size.controlRows);
        }
      };
      visit(0, 0, 0, 0, 0, 0);
      const minimum = Math.min(...candidates.map(candidate => candidate.height));
      const expected = candidates.filter(candidate => candidate.height <= minimum * 1.05)
        .sort((a, b) => a.unusedArea - b.unusedArea || a.controlRows - b.controlRows || a.height - b.height)[0];
      const result = layoutControllerGroups(groups, width);
      expect({ height: result.height, unusedArea: result.unusedArea, controlRows: result.items.reduce((sum, item) => sum + item.controlRows, 0) }).toEqual(expected);
      for (const row of new Set(result.items.map(item => item.row))) {
        const items = result.items.filter(item => item.row === row);
        expect(items.reduce((sum, item) => sum + item.width, 0) + (items.length - 1) * RACK_GAP).toBeLessThanOrEqual(width);
      }
    }
  });
});
