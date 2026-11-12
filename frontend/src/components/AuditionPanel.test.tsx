// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { audioTemplate } from "../lib/audioTemplates";
import { controllerDefaults } from "../lib/performanceControllers";
import { AuditionPanel } from "./AuditionPanel";
import { isolatedAudition } from "../lib/instrumentAudition";

const audio = vi.hoisted(() => ({ prime: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), midi: vi.fn() }));
vi.mock("../lib/browserClockAudio", () => ({ BrowserClockAudioClient: class {
  prime = audio.prime; connect = audio.connect; disconnect = audio.disconnect; sendManualMidi = audio.midi;
} }));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
const stopPerformance = vi.fn(async () => { useAppStore.setState({ activeSessionState: "compiled" }); });
function patch() {
  const p = audioTemplate("instrument");
  p.graph.nodes.push(...[controllerDefaults(), controllerDefaults("integer"), controllerDefaults("bool")].map((d, i) => ({
    id: `control-${i}`, opcode: "perf_controller", params: { ...d, label: ["Tone", "Octave", "Bright"][i], controller_group: "Hidden group" }, position: { x: 0, y: 0 }
  })));
  return p;
}
const mount = () => render(<StrictMode><AuditionPanel stopPerformance={stopPerformance} /></StrictMode>);
async function start() {
  fireEvent.click(screen.getByRole("button", { name: "Audition" }));
  await screen.findByRole("button", { name: "Stop audition" });
}
async function stop() {
  fireEvent.click(screen.getByRole("button", { name: "Stop audition" }));
  await screen.findByRole("button", { name: "Audition" });
}
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentPatch: patch(), activeSessionId: "original", activeSessionState: "running" });
  for (const fn of Object.values(audio)) fn.mockReset().mockResolvedValue(undefined);
  stopPerformance.mockClear();
  vi.spyOn(api, "createPreview").mockResolvedValue({ session_id: "preview-session", patch_id: "draft", instruments: [], state: "idle" });
  vi.spyOn(api, "compileSession").mockResolvedValue({ session_id: "preview-session", state: "compiled", orc: "", csd: "", diagnostics: [] });
  vi.spyOn(api, "startSession").mockResolvedValue({ session_id: "preview-session", state: "running", detail: "" });
  vi.spyOn(api, "stopSession").mockResolvedValue({ session_id: "preview-session", state: "compiled", detail: "" });
  vi.spyOn(api, "deleteSession").mockResolvedValue(undefined);
  vi.spyOn(api, "updatePerformanceControllers").mockImplementation(async (_id, _assignment, values) => ({ values }));
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(async () => { await act(async () => cleanup()); vi.restoreAllMocks(); });

it("toggles an inline isolated preview and exposes only minimal controls while running", async () => {
  mount();
  expect(screen.queryByRole("group", { name: "Audition keyboard" })).toBeNull();
  await start();
  expect(screen.getByRole("button", { name: "Stop audition" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("slider", { name: "Tone" })).toBeTruthy();
  expect(screen.getByRole("spinbutton", { name: "Octave" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Bright" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByText("Hidden group")).toBeNull();
  expect(audio.midi).not.toHaveBeenCalled();
  const payload = vi.mocked(api.createPreview).mock.calls[0][0];
  expect(payload.patches[0].id).not.toBe(useAppStore.getState().currentPatch.id);
  expect(payload.session.instruments).toHaveLength(1);
  expect(payload.session.instruments[0].performance_controller_midi_ccs).toBeUndefined();
  expect(vi.mocked(api.compileSession).mock.invocationCallOrder[0]).toBeLessThan(stopPerformance.mock.invocationCallOrder[0]);
  await stop();
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.queryByRole("group", { name: "Audition keyboard" })).toBeNull();
  expect(api.deleteSession).toHaveBeenCalledExactlyOnceWith("preview-session");
});

it("keeps the original performance running when compilation fails", async () => {
  vi.mocked(api.compileSession).mockRejectedValue(new Error("Invalid graph"));
  mount(); fireEvent.click(screen.getByRole("button", { name: "Audition" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Invalid graph");
  expect(stopPerformance).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeSessionState).toBe("running");
  expect(api.startSession).not.toHaveBeenCalled();
  await waitFor(() => expect(api.deleteSession).toHaveBeenCalledOnce());
});

it.each(["cancel", "unmount"])("cleans a late preview allocation on %s without stopping the original", async action => {
  const pending = deferred();
  vi.mocked(api.createPreview).mockImplementation(async () => {
    await pending.promise;
    return { session_id: "late", patch_id: "draft", instruments: [], state: "idle" };
  });
  const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Audition" }));
  await waitFor(() => expect(api.createPreview).toHaveBeenCalledOnce());
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Preparing… · Cancel" }));
  else view.unmount();
  await act(async () => pending.resolve());
  expect(stopPerformance).not.toHaveBeenCalled();
  expect(api.compileSession).not.toHaveBeenCalled();
  expect(api.deleteSession).toHaveBeenCalledExactlyOnceWith("late");
});

it("cancels during engine startup without a late browser connection", async () => {
  const pending = deferred();
  vi.mocked(api.startSession).mockImplementation(async () => {
    await pending.promise; return { session_id: "preview-session", state: "running", detail: "" };
  });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Audition" }));
  await waitFor(() => expect(api.startSession).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Preparing… · Cancel" }));
  await act(async () => pending.resolve());
  expect(audio.connect).not.toHaveBeenCalled();
  expect(api.deleteSession).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Audition" })).toBeTruthy();
});

it("rejects a draft changed during preparation and marks running snapshot changes", async () => {
  const pending = deferred();
  vi.mocked(api.compileSession).mockImplementationOnce(async () => {
    await pending.promise; return { session_id: "preview-session", state: "compiled", orc: "", csd: "", diagnostics: [] };
  });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Audition" }));
  await waitFor(() => expect(api.compileSession).toHaveBeenCalledOnce());
  act(() => useAppStore.setState({ currentPatch: { ...patch(), always_on: true } }));
  await act(async () => pending.resolve());
  expect(screen.getByRole("alert").textContent).toContain("Draft changed");
  expect(stopPerformance).not.toHaveBeenCalled();
  await start();
  act(() => useAppStore.setState({ currentPatch: patch() }));
  expect(screen.getByRole("status").textContent).toContain("Draft changed");
});

it("flushes temporary controller values before new notes and retains them across restart", async () => {
  const original = useAppStore.getState();
  mount(); await start();
  fireEvent.keyDown(screen.getByRole("slider", { name: "Tone" }), { key: "End" });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Octave" }), { target: { value: "1" } });
  fireEvent.blur(screen.getByRole("spinbutton", { name: "Octave" }));
  fireEvent.click(screen.getByRole("switch", { name: "Bright" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "C4 (60)" }), { key: "Enter" });
  await waitFor(() => expect(audio.midi).toHaveBeenCalledOnce());
  expect(api.updatePerformanceControllers).toHaveBeenLastCalledWith("preview-session", "preview", { "control-0": 1, "control-1": 1, "control-2": 1 });
  expect(vi.mocked(api.updatePerformanceControllers).mock.invocationCallOrder[0]).toBeLessThan(audio.midi.mock.invocationCallOrder[0]);
  expect(useAppStore.getState().currentPatch).toBe(original.currentPatch);
  expect(useAppStore.getState().sequencerInstruments).toBe(original.sequencerInstruments);
  await stop();
  expect(audio.midi.mock.calls.map(c => c[1].type)).toEqual(["note_on", "note_off"]);
  await start();
  expect(vi.mocked(api.createPreview).mock.calls[1][0].session.instruments[0].performance_controller_values).toEqual({ "control-0": 1, "control-1": 1, "control-2": 1 });
});

it("releases held keyboard notes on blur, octave changes and unmount", async () => {
  const view = mount(); await start();
  const key = screen.getByRole("button", { name: "C4 (60)" });
  fireEvent.keyDown(key, { key: " " });
  await act(async () => {});
  fireEvent.blur(window);
  await act(async () => {});
  fireEvent.keyDown(key, { key: "Enter" });
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Octave up" }));
  await act(async () => {});
  fireEvent.keyDown(screen.getByRole("button", { name: "C5 (72)" }), { key: "Enter" });
  await act(async () => {});
  view.unmount();
  await act(async () => {});
  expect(audio.midi.mock.calls.map(c => [c[1].type, c[1].note])).toEqual([
    ["note_on", 60], ["note_off", 60], ["note_on", 60], ["note_off", 60], ["note_on", 72], ["note_off", 72]
  ]);
  expect(audio.midi.mock.invocationCallOrder.slice(-1)[0]).toBeLessThan(audio.disconnect.mock.invocationCallOrder.slice(-1)[0]);
});

it("orders a quick release after an in-flight note-on", async () => {
  const pending = deferred();
  audio.midi.mockImplementationOnce(() => pending.promise);
  mount(); await start();
  const key = screen.getByRole("button", { name: "C4 (60)" });
  fireEvent.keyDown(key, { key: "Enter" });
  await waitFor(() => expect(audio.midi).toHaveBeenCalledOnce());
  fireEvent.keyUp(key, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Stop audition" }));
  expect(audio.disconnect).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(audio.midi.mock.calls.map(c => c[1].type)).toEqual(["note_on", "note_off"]);
  expect(api.deleteSession).toHaveBeenCalledOnce();
});

it("preserves the original playhead with transport stopped", async () => {
  const runtime = { ...useAppStore.getState().sequencerRuntime, playhead: 12, isPlaying: true };
  useAppStore.setState({ sequencerRuntime: runtime });
  mount(); await start(); await stop();
  expect(useAppStore.getState().sequencerRuntime).toEqual({ ...runtime, isPlaying: false });
  expect(useAppStore.getState().sequencer.isPlaying).toBe(false);
});

it("plays the built-in source for an isolated effect and disables notes for a continuous generator", async () => {
  useAppStore.setState({ currentPatch: audioTemplate("effect") });
  const view = mount(); await start();
  fireEvent.keyDown(screen.getByRole("button", { name: "C4 (60)" }), { key: "Enter" });
  await act(async () => {});
  expect(audio.midi.mock.calls[0][1].channel).toBe(2);
  expect(vi.mocked(api.createPreview).mock.calls[0][0].patches).toHaveLength(2);
  await stop(); view.unmount();
  useAppStore.setState({ currentPatch: { ...audioTemplate("instrument"), always_on: true } });
  mount(); await start();
  expect((screen.getByRole("button", { name: "C4 (60)" }) as HTMLButtonElement).disabled).toBe(true);
});

it("handles direct output without doubling its route and rejects mismatched effect inputs", () => {
  const direct = isolatedAudition(audioTemplate("output"), {}, "Mapping error");
  expect(direct.payload.session.audio_graph.routes).toHaveLength(2);
  expect(direct.payload.session.audio_graph.routes.every(r => r.sourceId === "preview-source")).toBe(true);
  const effect = audioTemplate("effect");
  effect.graph.audio_interface!.groups[0].ports.push("third");
  expect(() => isolatedAudition(effect, {}, "Mapping error")).toThrow("Mapping error");
});

it.each(["pointerCancel", "lostPointerCapture"] as const)("shares a held pitch and releases it exactly once on %s", async releaseEvent => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  });
  try {
    mount(); await start();
    const key = screen.getByRole("button", { name: "C4 (60)" });
    fireEvent.pointerDown(key, { button: 0, pointerId: 1 });
    fireEvent.pointerDown(key, { button: 0, pointerId: 2 });
    await act(async () => {});
    expect(audio.midi).toHaveBeenCalledOnce();
    fireEvent[releaseEvent](key, { pointerId: 1 });
    await act(async () => {});
    expect(audio.midi).toHaveBeenCalledOnce();
    fireEvent[releaseEvent](key, { pointerId: 2 });
    fireEvent[releaseEvent](key, { pointerId: 2 });
    await act(async () => {});
    expect(audio.midi.mock.calls.map(c => c[1].type)).toEqual(["note_on", "note_off"]);
  } finally { vi.unstubAllGlobals(); }
});

it("rejects fractional integer entries and cancels an unfinished entry", async () => {
  mount(); await start();
  const input = screen.getByRole("spinbutton", { name: "Octave" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "0.5" } });
  fireEvent.blur(input);
  expect(input.value).toBe("0");
  input.focus();
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("0");
  expect(api.updatePerformanceControllers).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "999" } });
  fireEvent.blur(input);
  expect(input.value).toBe("1");
});

it("does not restore transport into a newly loaded performance", async () => {
  mount(); await start();
  const state = useAppStore.getState();
  const runtime = { ...state.sequencerRuntime, playhead: 77 };
  act(() => useAppStore.setState({ performanceWorkspaceGeneration: state.performanceWorkspaceGeneration + 1, sequencerRuntime: runtime }));
  await stop();
  expect(useAppStore.getState().sequencerRuntime).toBe(runtime);
});
