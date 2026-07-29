import { describe, expect, it } from "vitest";

import type { AudibleBrowserClockTransportEvent } from "./browserClockWorkerProtocol";
import {
  availableRingFrames,
  coalesceAudibleTransportEvents,
  mapSourceSampleToTargetFrame,
  translateEpochTimestampToPerformanceTime,
  unsignedCounterDistance
} from "./browserClockShared";

describe("browser clock shared math", () => {
  it("keeps ring distances correct across uint32 rollover", () => {
    expect(unsignedCounterDistance(5, 0xffff_fffd)).toBe(8);
    expect(availableRingFrames(0xffff_fffd, 5, 32)).toBe(8);
  });

  it("rejects impossible ring occupancy", () => {
    expect(availableRingFrames(10, 1000, 128)).toBe(0);
  });

  it("maps engine samples into resampled target-frame offsets", () => {
    expect(mapSourceSampleToTargetFrame(150, 100, 200, 200)).toBe(100);
    expect(mapSourceSampleToTargetFrame(250, 100, 200, 200)).toBe(200);
  });

  it("translates a window event timestamp into the worker performance clock domain", () => {
    const windowTimeOriginMs = 1_700_000_000_000;
    const workerTimeOriginMs = windowTimeOriginMs + 5_000;
    const windowEventPerfMs = 7_200;
    const eventEpochMs = windowTimeOriginMs + windowEventPerfMs;

    expect(translateEpochTimestampToPerformanceTime(eventEpochMs, workerTimeOriginMs)).toBe(2_200);
  });

  it("keeps state events and only the newest delayed step", () => {
    const event = (
      kind: AudibleBrowserClockTransportEvent["kind"],
      frame: number
    ): AudibleBrowserClockTransportEvent => ({
      kind,
      target_frame: frame,
      target_frame_offset: frame,
      payload: {}
    });
    expect(
      coalesceAudibleTransportEvents([
        event("step", 1),
        event("step", 2),
        event("pad_switches", 3),
        event("loop", 4)
      ])
    ).toEqual([event("step", 2), event("pad_switches", 3), event("loop", 4)]);
  });
});
