// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScoreEditor } from "./ScoreEditor";
import { ScoreSequencers } from "./ScoreSequencers";
import { ScoreTransportContext, type PreviewScoreNote } from "./ScoreTransportContext";
import { scoreCopy } from "./scoreCopy";
import { HelpDocumentationModal } from "../HelpDocumentationModal";
import { documentationUiCopy } from "../../lib/documentationUi";
import { ClipEditingContext } from "../clipArranger/context";
import { createPerformanceEditorStore, PerformanceEditorProvider } from "./PerformanceEditorState";
import { defaultScoreTrack } from "../../lib/scoreSequencer";
import { defaultSequencerState } from "../../store/appStoreModel";
import { useAppStore } from "../../store/useAppStore";
import type { GuiLanguage, HelpDocId, ScoreNoteState, ScorePadState, SequencerTimingConfig } from "../../types";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  SVGElement.prototype.setPointerCapture = vi.fn();
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const note = (id = "root", pitch = 74): ScoreNoteState => ({ id, pitch, velocity: 90, startTicks: 5040, durationTicks: 20160 });
const editorStore = () => createPerformanceEditorStore();
function Harness({ initial = [], commit = vi.fn(), store = editorStore(), visible = true, length = 16, timing, previewNote,
  accepted = true, padIndex = 0, channel = 3, language = "english" }: {
  initial?: ScoreNoteState[]; commit?: (pad: ScorePadState) => void; store?: ReturnType<typeof editorStore>; visible?: boolean; length?: number;
  timing?: Partial<SequencerTimingConfig>; previewNote?: PreviewScoreNote; accepted?: boolean; padIndex?: number; channel?: number; language?: GuiLanguage;
}) {
  const [track] = useState(() => defaultScoreTrack(1, defaultSequencerState().timing));
  const [pad, setPad] = useState({ ...track.pads[0], lengthBeats: length, notes: initial });
  return <ScoreTransportContext.Provider value={previewNote ? { previewNote, play: vi.fn(), queue: vi.fn() } : null}>
    <PerformanceEditorProvider retainedStore={store}>{visible && <ScoreEditor track={{ ...track, midiChannel: channel, timing: { ...track.timing, ...timing } }} pad={pad} padIndex={padIndex} language={language} soundingPad={-1}
      onCommit={next => { commit(next); if (accepted) setPad(next); return accepted; }} />}</PerformanceEditorProvider>
  </ScoreTransportContext.Provider>;
}
const svg = () => screen.getByRole("application");
const rect = (id = "root", edge?: string) => document.querySelector(`rect[data-note="${id}"]${edge ? `[data-edge="${edge}"]` : ":not([data-edge])"}`)!;
const drag = (target: Element, x: number, y: number, endX: number, endY = y) => {
  fireEvent.pointerDown(target, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerMove(svg(), { clientX: endX, clientY: endY });
  fireEvent.pointerUp(svg());
};
const pianoKey = (name = "D5") => screen.getByRole("button", { name });
const previewMock = () => vi.fn<PreviewScoreNote>((_note, ended) => vi.fn(ended));

it("auditions keys with pointer and Enter/Space without drawing, selecting or repeating notes", () => {
  const commit = vi.fn(), previewNote = previewMock(); render(<Harness commit={commit} previewNote={previewNote} initial={[note()]} />);
  fireEvent.pointerDown(pianoKey(), { button: 2 }); expect(previewNote).not.toHaveBeenCalled();
  fireEvent.pointerDown(pianoKey(), { button: 0, pointerId: 1 });
  expect(previewNote).toHaveBeenCalledWith(expect.objectContaining({ pitch: 74, midiChannel: 3 }), expect.any(Function));
  expect(pianoKey().getAttribute("aria-pressed")).toBe("true");
  fireEvent.pointerMove(svg(), { clientX: 200, clientY: 110 });
  fireEvent.pointerUp(pianoKey(), { pointerId: 1 });
  expect(previewNote.mock.results[0].value).toHaveBeenCalledOnce();
  expect(pianoKey().getAttribute("aria-pressed")).toBe("false");
  for (const key of ["Enter", " "]) {
    fireEvent.keyDown(pianoKey(), { key }); fireEvent.keyDown(pianoKey(), { key, repeat: true });
    fireEvent.keyUp(pianoKey(), { key });
  }
  expect(previewNote).toHaveBeenCalledTimes(3);
  fireEvent.keyDown(pianoKey(), { key: "a", ctrlKey: true });
  expect(rect().getAttribute("stroke")).toBe("#0f172a");
  expect(commit).not.toHaveBeenCalled();
});

it.each(["cancel", "lostCapture", "blur", "gridFocus", "windowBlur", "pad", "channel", "collapse", "unmount"])("releases keyboard notes on %s", reason => {
  const previewNote = previewMock(), view = render(<Harness previewNote={previewNote} />);
  fireEvent.pointerDown(pianoKey(), { button: 0, pointerId: 1 });
  if (reason === "cancel") fireEvent.pointerCancel(pianoKey(), { pointerId: 1 });
  else if (reason === "lostCapture") fireEvent.lostPointerCapture(pianoKey(), { pointerId: 1 });
  else if (reason === "blur") fireEvent.blur(pianoKey(), { relatedTarget: document.body });
  else if (reason === "gridFocus") fireEvent.blur(pianoKey(), { relatedTarget: svg() });
  else if (reason === "windowBlur") fireEvent.blur(window);
  else if (reason === "pad") view.rerender(<Harness previewNote={previewNote} padIndex={1} />);
  else if (reason === "channel") view.rerender(<Harness previewNote={previewNote} channel={4} />);
  else if (reason === "collapse") view.rerender(<Harness previewNote={previewNote} visible={false} />);
  else view.unmount();
  expect(previewNote.mock.results[0].value).toHaveBeenCalledOnce();
  view.unmount(); expect(previewNote.mock.results[0].value).toHaveBeenCalledOnce();
});

it("tracks independent pointer presses and does not release another held key on keyboard focus movement", () => {
  const previewNote = previewMock(); render(<Harness previewNote={previewNote} />);
  fireEvent.pointerDown(pianoKey(), { button: 0, pointerId: 1 });
  fireEvent.pointerDown(pianoKey("E5"), { button: 0, pointerId: 2 });
  expect(pianoKey().getAttribute("aria-pressed")).toBe("true");
  expect(pianoKey("E5").getAttribute("aria-pressed")).toBe("true");
  fireEvent.pointerUp(pianoKey(), { pointerId: 1 });
  expect(pianoKey().getAttribute("aria-pressed")).toBe("false");
  expect(pianoKey("E5").getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(pianoKey("E5"), { key: "Escape" });
  expect(pianoKey("E5").getAttribute("aria-pressed")).toBe("false");
});

it.each([4, 8] as const)("appends exact quarter notes in /%i with a triplet grid and no preview engine", meterDenominator => {
  const commit = vi.fn(); render(<Harness commit={commit} timing={{ meterDenominator, stepsPerBeat: 3 }} />);
  fireEvent.doubleClick(pianoKey()); fireEvent.doubleClick(pianoKey("E5"));
  expect(commit).toHaveBeenCalledTimes(2);
  const pad = commit.mock.calls[1][0] as ScorePadState;
  expect(pad.lengthBeats).toBe(16);
  expect(pad.notes).toEqual([
    expect.objectContaining({ pitch: 74, startTicks: 0, durationTicks: 20160, velocity: 100 }),
    expect.objectContaining({ pitch: 76, startTicks: 20160, durationTicks: 20160, velocity: 100 })
  ]);
  expect(new Set(pad.notes.map(n => n.id)).size).toBe(2);
  expect(rect(pad.notes[1].id).getAttribute("stroke")).toBe("#fff");
});

it("appends after the latest release in an unsorted polyphonic score without snapping", () => {
  const commit = vi.fn(), initial = [
    { ...note("last-start"), startTicks: 10000, durationTicks: 1000 },
    { ...note("long"), startTicks: 17, durationTicks: 25000 },
    { ...note("earlier"), startTicks: 0, durationTicks: 100 }
  ];
  render(<Harness initial={initial} commit={commit} />); fireEvent.doubleClick(pianoKey());
  expect(commit.mock.calls[0][0].notes).toEqual([...initial, expect.objectContaining({ startTicks: 25017, durationTicks: 20160 })]);
});

it("accepts an exact fit and refuses another insertion without changing selection", () => {
  const commit = vi.fn(); render(<Harness length={1} commit={commit} />);
  fireEvent.doubleClick(pianoKey());
  const id = commit.mock.calls[0][0].notes[0].id;
  fireEvent.doubleClick(pianoKey("E5"));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toBe(scoreCopy("english").appendOverflow);
  expect(rect(id).getAttribute("stroke")).toBe("#fff");
});

it.each(["english", "german", "french", "spanish"] as const)("counts hidden notes at the append boundary and explains overflow in %s", language => {
  const commit = vi.fn(); render(<Harness length={4} language={language} commit={commit} initial={[{ ...note(), startTicks: 20160 * 5 }]} />);
  fireEvent.doubleClick(pianoKey());
  expect(commit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe(scoreCopy(language).appendOverflow);
});

it("retains selection when the store rejects an append", () => {
  const commit = vi.fn(); render(<Harness initial={[note()]} commit={commit} accepted={false} />);
  fireEvent.pointerDown(rect(), { button: 0, clientX: 100, clientY: 110 }); fireEvent.pointerUp(svg());
  fireEvent.doubleClick(pianoKey("E5"));
  expect(commit).toHaveBeenCalledOnce(); expect(rect().getAttribute("stroke")).toBe("#fff");
  expect(document.querySelectorAll("g[data-note]")).toHaveLength(1);
});

it("scrolls to the appended note while keeping the piano keys visible", () => {
  const commit = vi.fn(); render(<Harness initial={[{ ...note(), startTicks: 18 * 20160 }]} length={32} commit={commit} />);
  fireEvent.doubleClick(pianoKey());
  const id = commit.mock.calls[0][0].notes.at(-1).id;
  expect(svg().getAttribute("viewBox")?.startsWith("0 ")).toBe(false);
  expect(rect(id)).toBeTruthy(); expect(pianoKey()).toBeTruthy();
});

function ScoreGroup({ language = "english", clip = false }: { language?: GuiLanguage; clip?: boolean }) {
  const sequencer = useAppStore(s => s.sequencer), [collapsed, setCollapsed] = useState(false);
  const [help, setHelp] = useState<HelpDocId | null>(null);
  return <PerformanceEditorProvider><ClipEditingContext.Provider value={clip}>
    <ScoreSequencers sequencer={sequencer} language={language} collapsed={collapsed} onCollapse={setCollapsed} onHelpRequest={setHelp} />
    {help && <HelpDocumentationModal helpDocId={help} guiLanguage={language} onClose={() => setHelp(null)} />}
  </ClipEditingContext.Provider></PerformanceEditorProvider>;
}

it("appends to the editing pad and keeps insertions atomic through undo, redo and collapse", () => {
  const state = useAppStore.getState(), track = defaultScoreTrack(1, state.sequencer.timing);
  useAppStore.setState({ sequencer: { ...state.sequencer, scoreTracks: [track] }, sequencerEditingPads: { [track.id]: 2 } });
  render(<ScoreGroup />);
  fireEvent.doubleClick(pianoKey()); fireEvent.doubleClick(pianoKey("E5"));
  const current = () => useAppStore.getState().sequencer.scoreTracks[0];
  const notes = current().pads[2].notes;
  expect(current().pads[0].notes).toHaveLength(0); expect(notes).toHaveLength(2);
  expect(current().pads[2].lengthBeats).toBe(16);
  fireEvent.click(screen.getByRole("button", { name: "Score Sequencers" }));
  fireEvent.click(screen.getByRole("button", { name: "Score Sequencers" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().pads[2].notes).toEqual(notes.slice(0, 1));
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(current().pads[2].notes).toEqual(notes);
});

it.each(["pad", "performance"])("rejects appending beyond the %s note limit without changing history", limit => {
  const state = useAppStore.getState(), track = defaultScoreTrack(1, state.sequencer.timing);
  const notes = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), pitch: 0, velocity: 100, startTicks: 0, durationTicks: 1 }));
  for (let i = 0; i < (limit === "pad" ? 1 : 5); i++) track.pads[i].notes = notes;
  const padIndex = limit === "pad" ? 0 : 5;
  useAppStore.setState({ sequencer: { ...state.sequencer, scoreTracks: [track] }, sequencerEditingPads: { [track.id]: padIndex } });
  render(<ScoreGroup />); fireEvent.doubleClick(pianoKey());
  expect(useAppStore.getState().sequencer.scoreTracks[0]).toBe(track);
  expect(screen.getByRole("alert").textContent).toContain(scoreCopy("english").error);
  expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["english", "german", "french", "spanish"] as const)("opens standard Score help in %s in regular and clip views, including collapsed panels", language => {
  const ui = documentationUiCopy(language), c = scoreCopy(language);
  for (const clip of [false, true]) {
    const view = render(<ScoreGroup language={language} clip={clip} />);
    expect(document.querySelector("details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ui.showDocumentation }));
    const dialog = screen.getByRole("dialog", { name: ui.help });
    expect(within(dialog).getByRole("heading", { name: c.name })).toBeTruthy();
    expect(dialog.textContent).toContain("100");
    expect(dialog.textContent).not.toContain("undefined");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: c.title }));
    fireEvent.click(screen.getByRole("button", { name: ui.showDocumentation }));
    expect(screen.getByRole("dialog", { name: ui.help })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ui.close }));
    expect(screen.queryByRole("dialog")).toBeNull(); view.unmount();
  }
});

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
