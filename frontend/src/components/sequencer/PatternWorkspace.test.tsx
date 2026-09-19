// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ArpeggiatorState, ControllerSequencerState, DrummerSequencerTrackState, SequencerTrackState } from "../../types";
import { buildPerformanceExportPayload } from "../../lib/bundleImportExport";
import { useAppStore } from "../../store/useAppStore";
import { normalizeArpeggiatorState, normalizeControllerSequencerState } from "../../store/appStoreModel";
import { PatternWorkspace } from "./PatternWorkspace";
import { PerformanceEditorProvider } from "./PerformanceEditorState";
import { PerformanceAuditionContext } from "./PerformanceAudition";
import { cancelArrangerPreviewGestures } from "../../lib/arrangerPreviewGesture";

const audition = vi.fn().mockResolvedValue(undefined);
let current: SequencerTrackState | DrummerSequencerTrackState | ControllerSequencerState | ArpeggiatorState;
const kinds = ["melodic", "controller", "arpeggiator"] as const;
function Editor({ shown = true, drummer = false, kind = "melodic" }: { shown?: boolean; drummer?: boolean; kind?: typeof kinds[number] }) {
  const [track, setTrack] = useState(() => {
    const t = kind === "arpeggiator" ? normalizeArpeggiatorState({}, 0) : kind === "controller" ? normalizeControllerSequencerState({}, 0, useAppStore.getInitialState().sequencer.timing) : structuredClone(drummer ? useAppStore.getState().sequencer.drummerTracks[0] : useAppStore.getInitialState().sequencer.tracks[0]);
    t.padLoopPattern = { rootSequence: [], groups: [], superGroups: [] };
    return t;
  });
  current = track;
  return <PerformanceAuditionContext.Provider value={audition}><PerformanceEditorProvider>
    {shown && <PatternWorkspace padHasContent={() => true} track={track} language="english" onSourceChange={() => {}} onPatternChange={padLoopPattern => setTrack({ ...track, padLoopPattern })} />}
  </PerformanceEditorProvider></PerformanceAuditionContext.Provider>;
}
const strip = () => screen.getByRole("list", { name: "Free workspace" });
function transfer(data: Record<string, string> = {}) {
  return { getData: (key: string) => data[key] ?? "", setData: (key: string, value: string) => { data[key] = value; }, effectAllowed: "all" };
}
function dropPad(padIndex: number, target = strip()) {
  fireEvent.drop(target, { dataTransfer: transfer({ "application/x-visualcsound-sequencer-pad": JSON.stringify({ trackId: current.id, padIndex }) }) });
}
function createGroup() {
  dropPad(0); dropPad(1); dropPad(2);
  fireEvent.click(within(strip()).getByRole("button", { name: "#1" }));
  fireEvent.click(within(strip()).getByRole("button", { name: "#3" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Group" }));
}
beforeEach(() => { audition.mockClear(); useAppStore.setState(useAppStore.getInitialState(), true); vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(kinds)("assembles and groups separated selections without changing the authored arrangement (%s)", kind => {
  render(<Editor kind={kind} />); createGroup();
  expect(current.padLoopPattern.rootSequence).toEqual([]);
  expect(current.padLoopPattern.groups).toEqual([{ id: "A", sequence: [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 2 }] }]);
  const children = within(strip()).getAllByRole("listitem");
  expect(children).toHaveLength(2);
  fireEvent.contextMenu(within(children[0]).getByRole("button", { name: "A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Ungroup" }));
  expect(within(strip()).getAllByRole("listitem")).toHaveLength(3);
  expect(current.padLoopPattern.groups).toHaveLength(1);
});

it.each(kinds)("reorders a multi-selection and retains drafts across collapse (%s)", kind => {
  const view = render(<Editor kind={kind} />);
  dropPad(0); dropPad(1); dropPad(2);
  fireEvent.click(within(strip()).getByRole("button", { name: "#1" }));
  fireEvent.click(within(strip()).getByRole("button", { name: "#2" }), { shiftKey: true });
  const dataTransfer = transfer();
  fireEvent.dragStart(within(strip()).getByRole("button", { name: "#1" }), { dataTransfer });
  fireEvent.drop(strip(), { dataTransfer });
  expect(within(strip()).getAllByRole("listitem").map(el => el.textContent)).toEqual(["#3", "#1", "#2"]);
  expect(within(strip()).getByRole("button", { name: "#1" }).getAttribute("aria-pressed")).toBe("true");
  view.rerender(<Editor kind={kind} shown={false} />); view.rerender(<Editor kind={kind} />);
  expect(within(strip()).getAllByRole("listitem").map(el => el.textContent)).toEqual(["#3", "#1", "#2"]);
});

it.each(kinds)("edits shared definitions only on Apply and can save independent copies (%s)", kind => {
  render(<Editor kind={kind} />); createGroup();
  fireEvent.click(screen.getByRole("button", { name: "Group A" }));
  const editor = screen.getByRole("list", { name: "Editing A" });
  dropPad(3, editor);
  expect(current.padLoopPattern.groups[0].sequence).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(current.padLoopPattern.groups[0].sequence).toHaveLength(3);
  dropPad(4, editor);
  fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
  expect(current.padLoopPattern.groups.map(g => g.sequence.length)).toEqual([3, 4]);
  fireEvent.click(screen.getByRole("button", { name: "Free workspace" }));
  expect(within(strip()).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.contextMenu(screen.getByRole("button", { name: "Group A" }));
  expect((screen.getByRole("menuitem", { name: "Delete definition" }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(kinds)("deletes an unused group despite free-workspace references and its own edited draft (%s)", kind => {
  render(<Editor kind={kind} />); createGroup();
  fireEvent.click(screen.getByRole("button", { name: "Group A" }));
  dropPad(3, screen.getByRole("list", { name: "Editing A" }));
  fireEvent.contextMenu(screen.getByRole("button", { name: "Group A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete definition" }));
  expect(current.padLoopPattern.groups).toEqual([]);
  expect(within(strip()).getAllByRole("listitem").map(el => el.textContent)).toEqual(["#1", "#3", "#2"]);
  expect(screen.queryByRole("button", { name: "Group A" })).toBeNull();
  expect(screen.queryByText(/workspace draft/)).toBeNull();
});

it.each(["melodic", "controller", "arpeggiator", "drummer"] as const)("highlights the audible workspace occurrence independently of selection (%s)", device => {
  const drummer = device === "drummer";
  if (drummer) useAppStore.getState().addDrummerSequencerTrack();
  render(<Editor drummer={drummer} kind={drummer ? "melodic" : device} />); createGroup(); dropPad(0);
  fireEvent.change(screen.getByLabelText("Add rest…"), { target: { value: "1" } });
  fireEvent.click(within(strip()).getByRole("button", { name: "#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Play workspace" }));
  const gesture = audition.mock.calls[0][1].gestureId;
  const emit = (position: number | null, preview = false) => act(() => useAppStore.setState({ performanceAuditions: { [current.id]: {
    active: true, queued: null, workspace_gesture: gesture, workspace_active: true, workspace_sequence: [0, 2, 1, 0, -1], workspace_position: position, preview_active: preview
  } } }));
  expect(strip().querySelector("[aria-current]")).toBeNull(); // Preparation is not playback.
  for (const [position, name] of [[0, "A"], [1, "A"], [2, "#2"], [3, "#1"], [4, "Rest 1"], [0, "A"]] as const) {
    emit(position);
    expect(strip().querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(strip().querySelector("[aria-current]")?.textContent).toBe(name);
    expect(strip().querySelector("[aria-current]")?.parentElement?.className).toContain("outline-amber");
    expect(within(strip()).getByRole("button", { name: "#2" }).getAttribute("aria-pressed")).toBe("true");
  }
  emit(null, true); expect(strip().querySelector("[aria-current]")).toBeNull();
  emit(2); expect(strip().querySelector("[aria-current]")?.textContent).toBe("#2");
  dropPad(4); // The old audible sequence cannot highlight a newly edited draft.
  expect(strip().querySelector("[aria-current]")).toBeNull();
  act(() => useAppStore.setState(state => ({ performanceAuditions: { [current.id]: { ...state.performanceAuditions[current.id], workspace_sequence: [0, 2, 1, 0, -1, 4], workspace_position: 5 } } })));
  expect(strip().querySelector("[aria-current]")?.textContent).toBe("#5");
  fireEvent.click(screen.getByRole("button", { name: "Stop workspace" }));
  expect(strip().querySelector("[aria-current]")).toBeNull();
});

it("loops the whole workspace, updates it after edits and restores on collapse", async () => {
  vi.useFakeTimers();
  const view = render(<Editor />); dropPad(0); dropPad(1);
  fireEvent.click(screen.getByRole("button", { name: "Play workspace" }));
  const command = audition.mock.calls[0][1];
  expect(command).toMatchObject({ action: "workspace_start", items: [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 1 }] });
  dropPad(2);
  await act(() => vi.advanceTimersByTimeAsync(80));
  expect(audition.mock.calls[1][1].items).toHaveLength(3);
  view.rerender(<Editor shown={false} />);
  expect(audition).toHaveBeenLastCalledWith(current.id, { action: "workspace_end", gestureId: command.gestureId });
});

it("retains separate definition drafts and scroll positions and discards explicitly", () => {
  render(<Editor />); createGroup();
  strip().scrollLeft = 35; fireEvent.scroll(strip());
  fireEvent.click(screen.getByRole("button", { name: "Group A" }));
  const editor = screen.getByRole("list", { name: "Editing A" });
  dropPad(3, editor);
  editor.scrollLeft = 19; fireEvent.scroll(editor);
  fireEvent.click(screen.getByRole("button", { name: "Free workspace" }));
  expect(strip().scrollLeft).toBe(35);
  fireEvent.click(screen.getByRole("button", { name: "Group A" }));
  const retained = screen.getByRole("list", { name: "Editing A" });
  expect(retained.scrollLeft).toBe(19);
  expect(within(retained).getAllByRole("listitem")).toHaveLength(3);
  expect(current.padLoopPattern.groups[0].sequence).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(within(retained).getAllByRole("listitem")).toHaveLength(2);
});

it.each(kinds)("builds a supergroup from groups and ungroups only one level (%s)", kind => {
  render(<Editor kind={kind} />); createGroup();
  dropPad(3);
  fireEvent.click(within(strip()).getByRole("button", { name: "#2" }));
  fireEvent.click(within(strip()).getByRole("button", { name: "#4" }), { ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Group" }));
  fireEvent.click(within(strip()).getByRole("button", { name: "A" }));
  fireEvent.click(within(strip()).getByRole("button", { name: "B" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Supergroup" }));
  expect(current.padLoopPattern.superGroups).toEqual([{ id: "I", sequence: [{ type: "group", groupId: "A" }, { type: "group", groupId: "B" }] }]);
  fireEvent.contextMenu(within(strip()).getByRole("button", { name: "I" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Ungroup" }));
  expect(within(strip()).getAllByRole("listitem").map(el => el.textContent)).toEqual(["A", "B"]);
  expect(current.padLoopPattern.groups).toHaveLength(2);
  expect(current.padLoopPattern.superGroups).toHaveLength(1);
});

it("cancels workspace UI on transport stop without sending a restoring command", () => {
  render(<Editor />); dropPad(0);
  fireEvent.click(screen.getByRole("button", { name: "Play workspace" }));
  act(() => cancelArrangerPreviewGestures());
  expect(screen.getByRole("button", { name: "Play workspace" })).toBeTruthy();
  expect(audition).toHaveBeenCalledTimes(1);
});

it("rejects cross-track drops and over-limit edits as a whole", () => {
  render(<Editor />);
  fireEvent.drop(strip(), { dataTransfer: transfer({ "application/x-visualcsound-sequencer-pad": JSON.stringify({ trackId: "other", padIndex: 0 }) }) });
  expect(within(strip()).queryAllByRole("listitem")).toHaveLength(0);
  fireEvent.drop(strip(), { dataTransfer: transfer({ "application/x-visualcsound-sequencer-pad": JSON.stringify({ trackId: current.id, padIndex: 10 }) }) });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(within(strip()).queryAllByRole("listitem")).toHaveLength(0);
});


it.each(["controller", "arpeggiator"] as const)("persists %s definitions without drafts or audition state", kind => {
  render(<Editor kind={kind} />); createGroup();
  fireEvent.click(screen.getByRole("button", { name: "Group A" }));
  dropPad(5, screen.getByRole("list", { name: "Editing A" })); // Deliberately unapplied.
  fireEvent.click(screen.getByRole("button", { name: "Play workspace" }));
  const device = current;
  act(() => useAppStore.setState(state => ({
    sequencer: { ...state.sequencer,
      ...("controllerNumber" in device ? { controllerSequencers: [device] } : "playbackMode" in device ? { arpeggiators: [device] } : {}) },
    performanceAuditions: { [device.id]: { active: true, queued: null, workspace_gesture: "session-only", workspace_active: true, workspace_sequence: [0, 2, 5], workspace_position: 2 } }
  })));
  const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();
  const { payload } = buildPerformanceExportPayload({ snapshot, selectedPatches: [], performanceName: "Workspace test", performanceDescription: "" });
  const saved = kind === "controller" ? payload.performance.config.sequencer.controllerSequencers?.[0] : payload.performance.config.sequencer.arpeggiators?.[0];
  expect(saved?.padLoopPattern?.groups[0].sequence).toEqual([{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 2 }]);
  expect(saved?.padLoopPattern?.rootSequence).toEqual([]);
  expect(JSON.stringify(payload)).not.toMatch(/workspaceDrafts|workspace_gesture|session-only|workspace_position/);
  act(() => useAppStore.getState().applySequencerConfigSnapshot(payload.performance.config));
  const restored = kind === "controller" ? useAppStore.getState().sequencer.controllerSequencers[0] : useAppStore.getState().sequencer.arpeggiators[0];
  expect(restored.padLoopPattern.groups).toEqual(device.padLoopPattern.groups);
});
