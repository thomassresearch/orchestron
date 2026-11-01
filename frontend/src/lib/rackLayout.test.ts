import { describe, expect, it } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/controller_rack_layout.json";
import type { PerformanceControllerDefinition } from "../types";
import { groupControllers, instrumentSizeOptions, packOrdered, RACK_GAP, type SizeOption } from "./rackLayout";

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
