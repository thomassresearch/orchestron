// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import type { EngineStats } from "../types";
import { cpuLoadColor, EngineStatusLine } from "./EngineStatusLine";

const observation: EngineStats = { session_id: "one", state: "running", available: true, scope: "renderer_cpus",
  cpus: [{ cpu: 0, percent: 60 }, { cpu: 1, percent: 45 }, { cpu: 3, percent: 90 }],
  process_percent: null, sample_seconds: 1,
  renderer: { requested: "auto", selected: "parallel", worker_count: 3, qualified: true, failed: false,
    committed_sample: 32, published_sample: 32, fallback_reason: null } };

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(useAppStore.getInitialState(), true);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

it("shows only the used CPU IDs, colors the numbers and keeps mode changes stopped-only", async () => {
  vi.spyOn(api, "getEngineStats").mockResolvedValue(observation);
  useAppStore.setState({ activeSessionId: "one", activeSessionState: "running" });
  render(<EngineStatusLine />);
  await act(async () => {});
  expect(screen.getByText("60%").className).toContain("text-orange-400");
  expect(screen.getByText("45%").className).toContain("text-emerald-400");
  expect(screen.getByText("90%").className).toContain("text-red-400");
  expect(screen.getByText("cpu3:")).toBeTruthy();
  expect(screen.queryByText("cpu2:")).toBeNull();
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByLabelText("Engine stats").className).toContain("fixed");
});

it("covers the previously unspecified range without a color gap", () => {
  for (const value of [0, 50]) expect(cpuLoadColor(value)).toBe("text-emerald-400");
  for (const value of [50.1, 59, 60, 85]) expect(cpuLoadColor(value)).toBe("text-orange-400");
  for (const value of [85.1, 100]) expect(cpuLoadColor(value)).toBe("text-red-400");
  expect(cpuLoadColor(null)).toBe("text-slate-400");
});

it("offers an unchecked stopped-session opt-in and does not start or change audio", () => {
  const start = vi.spyOn(api, "startSession");
  render(<EngineStatusLine />);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(useAppStore.getState().parallelPlaybackEnabled).toBe(true);
  expect(start).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeSessionId).toBeNull();
});

it("suspends polling while hidden and cancels observation when unmounted", async () => {
  const get = vi.spyOn(api, "getEngineStats").mockResolvedValue(observation);
  useAppStore.setState({ activeSessionId: "one", activeSessionState: "running" });
  const view = render(<EngineStatusLine />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(get).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(get).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => {});
  expect(get).toHaveBeenCalledTimes(3);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(get).toHaveBeenCalledTimes(3);
});

it("ignores a late response from another session and labels single-process usage honestly", async () => {
  let finish!: (value: EngineStats) => void;
  vi.spyOn(api, "getEngineStats").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ...observation, session_id: "two", renderer: null, scope: "server_process", cpus: [], process_percent: 21 });
  useAppStore.setState({ activeSessionId: "one", activeSessionState: "running" });
  render(<EngineStatusLine />);
  await act(async () => { useAppStore.setState({ activeSessionId: "two" }); });
  await act(async () => { finish(observation); });
  expect(screen.queryByText("cpu0:")).toBeNull();
  expect(screen.getByText("Server process:")).toBeTruthy();
  expect(screen.getByText("21%")).toBeTruthy();
});

it("does not turn unavailable readings into zero load", async () => {
  vi.spyOn(api, "getEngineStats").mockRejectedValue(new Error("offline"));
  useAppStore.setState({ activeSessionId: "one", activeSessionState: "running", guiLanguage: "german" });
  render(<EngineStatusLine />);
  await act(async () => {});
  expect(screen.getByText("CPU-Auslastung nicht verfügbar")).toBeTruthy();
  expect(screen.queryByText("0%")).toBeNull();
});
