import { expect, it } from "vitest";
import { colorForDegrees, scaleDegreeBorderBackground } from "./scaleDegreeColors";

it("preserves the piano keyboard palette for all seven scale degrees", () => {
  expect(Array.from({ length: 7 }, (_, i) => colorForDegrees([i + 1]))).toEqual([
    { h: expect.closeTo(0), s: 0.86, v: 0.94 }, { h: expect.closeTo(30), s: 0.87, v: 0.95 }, { h: expect.closeTo(54), s: 0.84, v: 0.95 },
    { h: expect.closeTo(120), s: 0.74, v: 0.86 }, { h: expect.closeTo(170), s: 0.78, v: 0.85 },
    { h: expect.closeTo(220), s: 0.8, v: 0.9 }, { h: expect.closeTo(275), s: 0.74, v: 0.9 }
  ]);
  expect(colorForDegrees([])).toBeNull();
  expect(colorForDegrees([1, 3])?.h).toBeCloseTo(27);
});

it("uses solid colours for a degree and sorted equal hard segments for chords", () => {
  expect(scaleDegreeBorderBackground([])).toBeUndefined();
  expect(scaleDegreeBorderBackground([0, 8])).toBeUndefined();
  expect(scaleDegreeBorderBackground([1, 1])).toBe("rgb(240 34 34)");
  expect(scaleDegreeBorderBackground([4, 1, 4, 1])).toBe(
    "conic-gradient(rgb(240 34 34) 0% 50%, rgb(57 219 57) 50% 100%)"
  );
});
