// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScoreEditor } from "./ScoreEditor";
import { ScoreSequencers } from "./ScoreSequencers";
import { createPerformanceEditorStore, PerformanceEditorProvider } from "./PerformanceEditorState";
import { defaultScoreTrack } from "../../lib/scoreSequencer";
import { defaultSequencerState } from "../../store/appStoreModel";
import { useAppStore } from "../../store/useAppStore";
import type { ScoreNoteState, ScorePadState } from "../../types";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  SVGElement.prototype.setPointerCapture = vi.fn();
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const note = (id = "root", pitch = 74): ScoreNoteState => ({ id, pitch, velocity: 90, startTicks: 5040, durationTicks: 20160 });
const editorStore = () => createPerformanceEditorStore();
function Harness({ initial = [], commit = vi.fn(), store = editorStore(), visible = true, length = 16 }: {
  initial?: ScoreNoteState[]; commit?: (pad: ScorePadState) => void; store?: ReturnType<typeof editorStore>; visible?: boolean; length?: number;
}) {
  const [track] = useState(() => defaultScoreTrack(1, defaultSequencerState().timing));
  const [pad, setPad] = useState({ ...track.pads[0], lengthBeats: length, notes: initial });
  return <PerformanceEditorProvider retainedStore={store}>{visible && <ScoreEditor track={track} pad={pad} padIndex={0} language="english" soundingPad={-1}
    onCommit={next => { commit(next); setPad(next); }} />}</PerformanceEditorProvider>;
}
const svg = () => screen.getByRole("application");
const rect = (id = "root", edge?: string) => document.querySelector(`rect[data-note="${id}"]${edge ? `[data-edge="${edge}"]` : ":not([data-edge])"}`)!;
const drag = (target: Element, x: number, y: number, endX: number, endY = y) => {
  fireEvent.pointerDown(target, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerMove(svg(), { clientX: endX, clientY: endY });
  fireEvent.pointerUp(svg());
};

it("draws a snapped duration in one commit and discards cancelled previews", () => {
  const commit = vi.fn(); render(<Harness commit={commit} />);
  fireEvent.pointerDown(svg(), { button: 0, clientX: 80, clientY: 110 });
  fireEvent.pointerMove(svg(), { clientX: 128, clientY: 110 });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(svg());
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0][0].notes[0]).toMatchObject({ pitch: 74, startTicks: 5040, durationTicks: 20160 });
  fireEvent.pointerDown(svg(), { button: 0, clientX: 200, clientY: 160 });
  fireEvent.keyDown(svg(), { key: "Escape" }); fireEvent.pointerUp(svg());
  fireEvent.pointerDown(svg(), { button: 0, clientX: 200, clientY: 160 });
  fireEvent.pointerCancel(svg()); fireEvent.pointerUp(svg());
  expect(commit).toHaveBeenCalledTimes(1);
});

it("moves notes and resizes either edge without changing other voices", () => {
  const commit = vi.fn(); render(<Harness initial={[note(), note("other", 72)]} commit={commit} />);
  drag(rect(), 100, 110, 116, 86);
  expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes).toEqual([{ ...note(), pitch: 75, startTicks: 10080 }, note("other", 72)]);
  drag(rect("root", "end"), 158, 86, 190);
  expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes[0].durationTicks).toBe(30240);
  drag(rect("root", "start"), 97, 86, 113);
  expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes[0]).toMatchObject({ startTicks: 15120, durationTicks: 25200 });
});

it("groups chords by scale, inherits note properties and avoids duplicates", () => {
  const commit = vi.fn(); render(<Harness initial={[note()]} commit={commit} />);
  fireEvent.contextMenu(rect());
  expect(document.querySelector('optgroup[label="In scale"]')).not.toBeNull();
  expect(document.querySelector('optgroup[label="Out of scale"]')).not.toBeNull();
  const select = screen.getByRole("combobox", { name: "Add chord" }) as HTMLSelectElement;
  const choice = select.querySelector("optgroup option") as HTMLOptionElement;
  fireEvent.change(select, { target: { value: choice.value } });
  const notes = commit.mock.calls[commit.mock.calls.length - 1][0].notes;
  expect(notes.length).toBeGreaterThan(1);
  expect(notes.every((n: ScoreNoteState) => n.startTicks === 5040 && n.durationTicks === 20160 && n.velocity === 90)).toBe(true);
  expect(new Set(notes.map((n: ScoreNoteState) => n.id)).size).toBe(notes.length);
  fireEvent.change(select, { target: { value: choice.value } });
  expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes).toHaveLength(notes.length);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Velocity" }), { target: { value: "33" } });
  expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes.find((n: ScoreNoteState) => n.id === "root").velocity).toBe(33);
});

it("retains selection, clipboard and zoom across collapse, and scopes keyboard commands", () => {
  const commit = vi.fn(), store = editorStore();
  const props = { initial: [note()], commit, store };
  const view = render(<Harness {...props} />);
  fireEvent.pointerDown(rect(), { button: 0, clientX: 100, clientY: 110 }); fireEvent.pointerUp(svg());
  fireEvent.keyDown(svg(), { key: "c", ctrlKey: true });
  fireEvent.change(screen.getByRole("slider", { name: "Time zoom" }), { target: { value: "5" } });
  view.rerender(<Harness {...props} visible={false} />); view.rerender(<Harness {...props} />);
  expect((screen.getByRole("slider", { name: "Time zoom" }) as HTMLInputElement).value).toBe("5");
  fireEvent.keyDown(document.body, { key: "Delete" }); expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(svg(), { key: "F10", shiftKey: true }); expect(screen.getByRole("group", { name: "Note properties" })).toBeTruthy();
  fireEvent.keyDown(svg(), { key: "v", ctrlKey: true }); expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes).toHaveLength(2);
  fireEvent.keyDown(svg(), { key: "Delete" }); expect(commit.mock.calls[commit.mock.calls.length - 1][0].notes).toHaveLength(1);
});

it("bounds SVG grid and note work for a 10000-note, 8192-beat score", () => {
  const notes = Array.from({ length: 10000 }, (_, i) => ({ ...note(String(i)), startTicks: (1000 + i / 2) * 20160 }));
  render(<Harness initial={notes} length={8192} />);
  expect(document.querySelectorAll("[data-note]")).toHaveLength(0);
  expect(svg().querySelectorAll("line").length).toBeLessThan(150);
  fireEvent.click(screen.getByRole("button", { name: "Fit score" }));
  expect(svg().querySelectorAll("line").length).toBeLessThan(150);
}, 15000);

it("preserves hidden material, makes Trim undoable, and keeps history through collapse", () => {
  const state = useAppStore.getState(), track = defaultScoreTrack(1, state.sequencer.timing);
  track.pads[0].notes = [{ ...note(), durationTicks: 40320 }, { ...note("late"), startTicks: 20160 * 20 }];
  useAppStore.setState({ sequencer: { ...state.sequencer, scoreTracks: [track] } });
  function Group() {
    const sequencer = useAppStore(s => s.sequencer), [collapsed, setCollapsed] = useState(false);
    return <PerformanceEditorProvider><ScoreSequencers sequencer={sequencer} language="english" collapsed={collapsed} onCollapse={setCollapsed} /></PerformanceEditorProvider>;
  }
  render(<Group />);
  const payload = new Map<string, string>();
  const dataTransfer = { setData: (type: string, value: string) => payload.set(type, value), getData: (type: string) => payload.get(type) ?? "" };
  fireEvent.dragStart(screen.getByRole("button", { name: "#1" }), { dataTransfer });
  fireEvent.drop(screen.getByRole("list", { name: "Free workspace" }), { dataTransfer });
  expect(within(screen.getByRole("list", { name: "Free workspace" })).getByRole("button", { name: "#1" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Scale" }), { target: { value: "C:major" } });
  expect(useAppStore.getState().sequencer.scoreTracks[0].pads[0]).toMatchObject({ mode: "ionian", notes: track.pads[0].notes });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Pattern length" }), { target: { value: "1" } });
  expect(useAppStore.getState().sequencer.scoreTracks[0].pads[0].notes).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Trim hidden notes" }));
  expect(useAppStore.getState().sequencer.scoreTracks[0].pads[0].notes).toEqual([{ ...note(), durationTicks: 15120 }]);
  fireEvent.click(screen.getByRole("button", { name: "Score Sequencers" }));
  fireEvent.click(screen.getByRole("button", { name: "Score Sequencers" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(useAppStore.getState().sequencer.scoreTracks[0].pads[0].notes).toEqual(track.pads[0].notes);
});
