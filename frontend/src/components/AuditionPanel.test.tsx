// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useAppStore } from "../store/useAppStore";
import { audioTemplate } from "../lib/audioTemplates";
import { controllerDefaults } from "../lib/performanceControllers";
import { dx7Offset, dx7Voice, encodeDx7 } from "../lib/dx7";
import { AuditionKeyboardProvider, AuditionPanel, InstrumentAuditionKeyboard } from "./AuditionPanel";
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
afterEach(async () => { await act(async () => cleanup()); vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps Stop available when a running draft gains a sample player", async () => {
  mount();
  await start();
  const draft = useAppStore.getState().currentPatch;
  act(() => useAppStore.setState({ currentPatch: { ...draft, graph: { ...draft.graph, nodes: [
    ...draft.graph.nodes, { id: "sampler", opcode: "sample_player", params: {}, position: { x: 0, y: 0 } }
  ] } } }));
  expect(screen.getByRole("button", { name: "Stop audition" }).hasAttribute("disabled")).toBe(false);
  await stop();
  expect(screen.getByRole("button", { name: "Audition" }).hasAttribute("disabled")).toBe(true);
});

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

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const midiNotes = () => audio.midi.mock.calls.map(([, event]) => [event.type, event.note]);
async function tapKey(name: string) {
  const key = screen.getByRole("button", { name });
  fireEvent.keyDown(key, { key: "Enter" });
  fireEvent.keyUp(key, { key: "Enter" });
  await act(async () => {});
}

it("waits for a key, repeats the latest note at the selected timings and releases it when switched off", async () => {
  mount(); await start();
  vi.useFakeTimers();
  const autoplay = screen.getByRole("checkbox", { name: "Autoplay" });
  fireEvent.click(autoplay);
  const duration = screen.getByRole("slider", { name: "Duration" });
  const interval = screen.getByRole("slider", { name: "Interval" });
  expect([duration.getAttribute("min"), duration.getAttribute("max")]).toEqual(["0.2", "1"]);
  expect([interval.getAttribute("min"), interval.getAttribute("max")]).toEqual(["0.5", "5"]);
  fireEvent.change(duration, { target: { value: "0.2" } });
  fireEvent.change(interval, { target: { value: "5" } });
  await advance(5000);
  expect(audio.midi).not.toHaveBeenCalled();
  await tapKey("C4 (60)");
  audio.midi.mockClear();
  await advance(4999);
  expect(audio.midi).not.toHaveBeenCalled();
  await advance(1);
  await advance(199);
  expect(midiNotes()).toEqual([["note_on", 60]]);
  await advance(1);
  expect(midiNotes()).toEqual([["note_on", 60], ["note_off", 60]]);

  fireEvent.change(interval, { target: { value: "0.5" } });
  await tapKey("D4 (62)");
  audio.midi.mockClear();
  await advance(500);
  fireEvent.click(autoplay);
  await advance(5000);
  expect(midiNotes()).toEqual([["note_on", 62], ["note_off", 62]]);
});

it("retriggers the last autochord cleanly when duration exceeds interval and cancels on audition stop", async () => {
  mount(); await start();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("checkbox", { name: "Autochord" }));
  await tapKey("D4 (62)");
  const on = [62, 65, 69].map(note => ["note_on", note]);
  const off = [62, 65, 69].map(note => ["note_off", note]);
  expect(midiNotes()).toEqual([...on, ...off]);
  audio.midi.mockClear();
  fireEvent.click(screen.getByRole("checkbox", { name: "Autoplay" }));
  fireEvent.change(screen.getByRole("slider", { name: "Duration" }), { target: { value: "1" } });
  fireEvent.change(screen.getByRole("slider", { name: "Interval" }), { target: { value: "0.5" } });
  await advance(500);
  expect(midiNotes()).toEqual(on);
  await advance(500);
  expect(midiNotes()).toEqual([...on, ...off, ...on]);
  fireEvent.click(screen.getByRole("button", { name: "Stop audition" }));
  await advance(5000);
  expect(midiNotes()).toEqual([...on, ...off, ...on, ...off]);
  expect(api.deleteSession).toHaveBeenCalledOnce();
});

it("keeps the repeat in time when the FM6 editor takes the keyboard and releases it on focus loss", async () => {
  const panel = (editorOpen: boolean) => <AuditionKeyboardProvider>
    <AuditionPanel stopPerformance={stopPerformance} />
    {editorOpen && <div role="dialog"><InstrumentAuditionKeyboard /></div>}
  </AuditionKeyboardProvider>;
  const view = render(panel(false));
  await start();
  vi.useFakeTimers();
  await tapKey("C4 (60)");
  fireEvent.click(screen.getByRole("checkbox", { name: "Autoplay" }));
  audio.midi.mockClear();
  await advance(800);
  view.rerender(panel(true));
  expect(screen.getByRole("dialog").contains(screen.getByRole("checkbox", { name: "Autoplay" }))).toBe(true);
  await advance(200);
  expect(midiNotes()).toEqual([["note_on", 60]]);
  fireEvent.blur(window);
  await advance(2000);
  expect(midiNotes()).toEqual([["note_on", 60], ["note_off", 60]]);
  expect((screen.getByRole("checkbox", { name: "Autoplay" }) as HTMLInputElement).checked).toBe(false);
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
  expect(screen.getByRole("checkbox", { name: "Autoplay" }).matches(":disabled")).toBe(true);
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

it("orders live FM6 edits and rollback before the next note without restarting audition", async () => {
  const base = patch();
  const fm = { id: "fm", opcode: "fm6_voice", position: { x: 0, y: 0 }, params: { algorithm: 1, op1_ratio: 2 } };
  base.graph.nodes.push(fm);
  useAppStore.setState({ currentPatch: base });
  vi.mocked(api.compileSession).mockResolvedValue({ session_id: "preview-session", state: "compiled", orc: "", csd: "", diagnostics: [],
    manifest: { instrumentReferences: { preview: "1" }, fm6Preview: { preview: { fm: { ...fm.params, weight_6_5: 1 } } } } });
  const pending = deferred();
  const write = vi.spyOn(api, "updateFm6Preview").mockResolvedValue(undefined).mockImplementationOnce(() => pending.promise);
  mount(); await start();
  const change = (params: typeof fm.params & { weight_6_5?: number }) => act(() => useAppStore.setState({ currentPatch: {
    ...base, graph: { ...base.graph, nodes: base.graph.nodes.map(n => n.id === "fm" ? { ...fm, params } : n) }
  } }));
  change({ algorithm: 4, op1_ratio: 5, weight_6_5: .4 });
  expect(write).toHaveBeenCalledWith("preview-session", "fm", { algorithm: 4, op1_ratio: 5, weight_6_5: .4 });
  change(fm.params);
  fireEvent.keyDown(screen.getByRole("button", { name: "C4 (60)" }), { key: "Enter" });
  expect(audio.midi).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await waitFor(() => expect(audio.midi).toHaveBeenCalledOnce());
  expect(write).toHaveBeenLastCalledWith("preview-session", "fm", { ...fm.params, weight_6_5: 1 });
  expect(write.mock.invocationCallOrder[1]).toBeLessThan(audio.midi.mock.invocationCallOrder[0]);
  expect(screen.queryByRole("status")).toBeNull();
  expect(api.compileSession).toHaveBeenCalledOnce();
});

it("sends the complete opening DX7 voice before a note played immediately after Cancel", async () => {
  const base = patch();
  const opening = dx7Voice({});
  const node = { id: "dx", opcode: "fm_dx7", position: { x: 0, y: 0 }, params: { voice: encodeDx7(opening) } };
  base.graph.nodes.push(node);
  useAppStore.setState({ currentPatch: base });
  const initial = Object.fromEntries(opening.slice(0, 145).map((value, i) => [`dx7_${i}`, value]));
  vi.mocked(api.compileSession).mockResolvedValue({ session_id: "preview-session", state: "compiled", orc: "", csd: "", diagnostics: [],
    manifest: { instrumentReferences: { preview: "1" }, fm6Preview: { preview: { dx: initial } } } });
  const pending = deferred();
  const write = vi.spyOn(api, "updateFm6Preview").mockResolvedValue(undefined).mockImplementationOnce(() => pending.promise);
  mount(); await start();
  const edited = [...opening];
  edited[134] = 3;
  edited[dx7Offset(2) + 4] = 65;
  const setVoice = (bytes: number[]) => act(() => useAppStore.setState({ currentPatch: { ...base, graph: {
    ...base.graph, nodes: base.graph.nodes.map(n => n.id === node.id ? { ...node, params: { voice: encodeDx7(bytes) } } : n)
  } } }));
  setVoice(edited);
  expect(write).toHaveBeenCalledWith("preview-session", "dx", { ...initial, dx7_134: 3, dx7_88: 65 });
  setVoice(opening);
  fireEvent.keyDown(screen.getByRole("button", { name: "C4 (60)" }), { key: "Enter" });
  expect(audio.midi).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await waitFor(() => expect(audio.midi).toHaveBeenCalledOnce());
  expect(write).toHaveBeenLastCalledWith("preview-session", "dx", initial);
  expect(write.mock.invocationCallOrder[1]).toBeLessThan(audio.midi.mock.invocationCallOrder[0]);
  expect(screen.queryByRole("status")).toBeNull();
  expect(api.compileSession).toHaveBeenCalledOnce();
});
