import { describe, expect, it } from "vitest";

import {
  enabledForSequencerConfigExport,
  sanitizeCsdFileBaseName,
  sanitizePerformanceFileBaseName,
  scaleVelocityForChannel,
  trackShouldRunContinuously
} from "./appOrchestration";

describe("application orchestration helpers", () => {
  it("scales MIDI velocity with the configured instrument level", () => {
    expect(scaleVelocityForChannel(127, 2, new Map([[2, 5]]))).toBe(64);
    expect(scaleVelocityForChannel(127, 3, new Map([[2, 5]]))).toBe(127);
  });

  it("normalizes exported file names without duplicating extensions", () => {
    expect(sanitizeCsdFileBaseName(" Lead Synth.csd ")).toBe("Lead_Synth");
    expect(sanitizePerformanceFileBaseName("Live Set.orch.zip")).toBe("Live_Set");
  });

  it("keeps runtime and export enablement policies distinct", () => {
    const oneShotLoop = { enabled: true, padLoopEnabled: true, padLoopRepeat: false };
    expect(trackShouldRunContinuously(oneShotLoop)).toBe(false);
    expect(enabledForSequencerConfigExport(oneShotLoop, true)).toBe(true);
    expect(enabledForSequencerConfigExport(oneShotLoop, false)).toBe(true);
  });
});
