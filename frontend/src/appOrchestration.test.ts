import { describe, expect, it } from "vitest";

import {
  enabledForSequencerConfigExport,
  sanitizeCsdFileBaseName,
  sanitizePerformanceFileBaseName,
  normalizeMidiVelocity,
  trackShouldRunContinuously
} from "./appOrchestration";

describe("application orchestration helpers", () => {
  it("preserves authored MIDI velocity regardless of legacy rack Level", () => {
    expect(normalizeMidiVelocity(127)).toBe(127);
    expect(normalizeMidiVelocity(110)).toBe(110);
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
