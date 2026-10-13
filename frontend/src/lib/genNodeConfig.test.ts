import { describe, expect, it } from "vitest";
import { buildGenNodePreview, defaultGenNodeConfig, getGenNodeConfig, normalizeGenNodeConfig, setGenNodeConfig } from "./genNodeConfig";

describe("GEN19", () => {
  const rows = [
    { partial: 0.5, strength: -2, phase: 270, offset: 2 },
    { partial: 3, strength: 0.25, phase: -90, offset: -0.5 }
  ];
  it.each(["ftgen", "ftgenonce"] as const)("round trips partial rows and previews %s", mode => {
    const config = { ...defaultGenNodeConfig(), routineNumber: 19, gen19Partials: rows, normalize: false, tableSize: 1025, startTime: 2, mode };
    const restored = getGenNodeConfig(JSON.parse(JSON.stringify(setGenNodeConfig({}, "g", config))), "g");
    expect(restored).toEqual(config);
    expect(buildGenNodePreview(restored).line).toBe(`{ift} ${mode} 0, ${mode === "ftgen" ? 2 : 0}, 1025, -19, 0.5, -2, 270, 2, 3, 0.25, -90, -0.5`);
  });
  it("starts with a normalized sine partial", () => {
    expect(buildGenNodePreview(normalizeGenNodeConfig({ routineNumber: 19 })).line).toBe("{ift} ftgen 0, 0, 16384, 19, 1, 1, 0, 0");
  });
  it.each([
    { rawArgs: [1, 0.5, 270, 0.5], rawArgsText: "ignored" },
    { rawArgsText: "1, 0.5, 270, 0.5" },
    { rawArgsText: "1, 1/2, 270, 0.5" },
    { rawArgsText: "1, expr:1/2, 270, 0.5" }
  ])("preserves legacy custom arguments %j", raw => {
    const config = normalizeGenNodeConfig({ routineNumber: 19, ...raw });
    expect(config.gen19Partials).toBeNull();
    const restored = getGenNodeConfig(setGenNodeConfig({}, "g", config), "g");
    expect(buildGenNodePreview(restored).line).toBe(`{ift} ftgen 0, 0, 16384, 19, ${raw.rawArgsText?.includes("1/2") ? "1, 1/2, 270, 0.5" : "1, 0.5, 270, 0.5"}`);
  });
  it("uses structured rows over stale raw arguments", () => {
    const config = normalizeGenNodeConfig({ routineNumber: 19, gen19Partials: rows, rawArgsText: "1, 1, 0, 0" });
    expect(buildGenNodePreview(config).args).toEqual(["0.5", "-2", "270", "2", "3", "0.25", "-90", "-0.5"]);
  });
});
