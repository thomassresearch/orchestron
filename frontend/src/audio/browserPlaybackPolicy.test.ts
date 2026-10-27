import { describe, expect, it } from "vitest";
import { BrowserPlaybackPolicy, playbackLatencySettings } from "./browserPlaybackPolicy";
import { LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS as defaults, normalizeBrowserClockLatencySettings } from "../lib/browserClockLatencyConfig";

describe("browser playback policy", () => {
  it("migrates saved settings to Auto with ten seconds and bounds the configurable timeout", () => {
    expect(normalizeBrowserClockLatencySettings({ steadyHighWaterMs: 250 })).toMatchObject({
      playbackMode: "auto", inactivityTimeoutSeconds: 10, steadyHighWaterMs: 250
    });
    expect(normalizeBrowserClockLatencySettings({ inactivityTimeoutSeconds: 0 }).inactivityTimeoutSeconds).toBe(1);
    expect(normalizeBrowserClockLatencySettings({ inactivityTimeoutSeconds: Infinity }).inactivityTimeoutSeconds).toBe(10);
    expect(normalizeBrowserClockLatencySettings({ inactivityTimeoutSeconds: 400 }).inactivityTimeoutSeconds).toBe(300);
    expect(normalizeBrowserClockLatencySettings({ playbackMode: "listening", inactivityTimeoutSeconds: 35 })).toMatchObject({ playbackMode: "listening", inactivityTimeoutSeconds: 35 });
  });

  it("starts listening, arms before a note, and times out from the last release", () => {
    const policy = new BrowserPlaybackPolicy();
    expect(policy.mode(defaults, 0)).toBe("listening");
    policy.control("piano:a", "start", 0);
    expect(policy.mode(defaults, 9999)).toBe("live");
    expect(policy.mode(defaults, 10000)).toBe("listening");
    policy.midi({ type: "note_on", channel: 1, note: 60 }, "piano:a", 11000);
    expect(policy.mode(defaults, 90000)).toBe("live");
    policy.midi({ type: "note_off", channel: 1, note: 60 }, "piano:a", 90000);
    expect(policy.mode(defaults, 99999)).toBe("live");
    expect(policy.mode(defaults, 100000)).toBe("listening");
  });

  it("tracks independent keyboards, retriggers, sustain, gestures and source removal", () => {
    const policy = new BrowserPlaybackPolicy();
    for (const source of ["piano:a", "piano:b"]) policy.midi({ type: "note_on", channel: 1, note: 60 }, source, 0);
    policy.midi({ type: "note_on", channel: 1, note: 60 }, "piano:b", 1);
    policy.control("piano:a", "stop", 2);
    expect(policy.mode(defaults, 20000)).toBe("live");
    policy.midi({ type: "note_on", channel: 1, note: 60, velocity: 0 }, "piano:b", 20000);
    expect(policy.mode(defaults, 30000)).toBe("listening");
    policy.midi({ type: "control_change", channel: 1, controller: 64, value: 127 }, "controller:a", 30000);
    expect(policy.mode(defaults, 50000)).toBe("live");
    policy.midi({ type: "control_change", channel: 1, controller: 64, value: 0 }, "controller:a", 50000);
    expect(policy.mode(defaults, 60000)).toBe("listening");
    policy.control("controller:a", "gesture_start", 60000);
    expect(policy.mode(defaults, 90000)).toBe("live");
    policy.control("controller:a", "stop", 90000);
    policy.control("controller:a", "gesture_end", 90001);
    expect(policy.mode(defaults, 90001)).toBe("listening");
  });

  it("protects held external input, resets on disconnect and respects forced modes", () => {
    const policy = new BrowserPlaybackPolicy();
    policy.external(true, true, 0);
    expect(policy.mode(defaults, 100000)).toBe("live");
    expect(policy.mode({ ...defaults, playbackMode: "listening" }, 100000)).toBe("listening");
    policy.external(false, false, 100001);
    expect(policy.mode(defaults, 100001)).toBe("listening");
    expect(policy.mode({ ...defaults, playbackMode: "live" }, 100001)).toBe("live");
    policy.external(true, false, 100002);
    expect(policy.mode({ ...defaults, inactivityTimeoutSeconds: 2 }, 102002)).toBe("listening");
    policy.reset();
    expect(policy.mode(defaults, 100003)).toBe("listening");
  });

  it("clears only the panic channel and ignores late note releases from stopped sources", () => {
    const policy = new BrowserPlaybackPolicy();
    policy.midi({ type: "note_on", channel: 1, note: 60 }, "piano:a", 0);
    policy.midi({ type: "note_on", channel: 2, note: 60 }, "piano:a", 0);
    policy.midi({ type: "all_notes_off", channel: 1 }, "browser", 5);
    expect(policy.mode(defaults, 20000)).toBe("live");
    policy.control("piano:a", "stop", 20000);
    policy.midi({ type: "note_off", channel: 2, note: 60 }, "piano:a", 20001);
    expect(policy.mode(defaults, 20001)).toBe("listening");
  });

  it("keeps Live tuning and larger custom queues while selecting listening headroom", () => {
    expect(playbackLatencySettings(defaults, "live")).toBe(defaults);
    expect(playbackLatencySettings(defaults, "listening")).toMatchObject({
      steadyLowWaterMs: 750, steadyHighWaterMs: 1500, startupLowWaterMs: 1000, startupHighWaterMs: 1800, maxBlocksPerRequest: 512
    });
    expect(playbackLatencySettings({ ...defaults, steadyHighWaterMs: 1900 }, "listening").steadyHighWaterMs).toBe(1900);
  });
});
