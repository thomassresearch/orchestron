// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../backend/tests/fixtures/performances/rack_ordering.json";
import type { GuiLanguage, PatchListItem } from "../types";
import { useAppStore } from "../store/useAppStore";
import { SequencerPage } from "./SequencerPage";
import { INITIAL_PANEL_COLLAPSE_STATE } from "./CollapsiblePanel";
import type { SequencerPageProps } from "./sequencer/sequencerPageContracts";
import { SEQUENCER_UI_COPY } from "./sequencer/sequencerUiCopy";

const mime = "application/x-orchestron-rack-instrument";
const noop = () => {};
function actions<T>(overrides: object = {}): T {
  return new Proxy(overrides, { get: (target, key) => Reflect.get(target, key) ?? noop }) as T;
}
function Page({ language = "english" }: { language?: GuiLanguage }) {
  const state = useAppStore();
  const [collapsed, setCollapsed] = useState(INITIAL_PANEL_COLLAPSE_STATE);
  const props: SequencerPageProps = {
    collapsedPanels: collapsed, onPanelCollapsedChange: (panel, value) => setCollapsed(previous => ({ ...previous, [panel]: value })),
    instrumentActions: actions({ onInstrumentReorder: state.moveSequencerInstrument }), performanceActions: actions(), transportActions: actions(),
    melodicTrackActions: actions(), drummerTrackActions: actions(), pianoRollActions: actions(), midiControllerActions: actions(), controllerSequencerActions: actions(), arpeggiatorActions: actions(),
    data: { guiLanguage: language, patches: state.patches, performances: [], instrumentBindings: state.sequencerInstruments,
      sequencer: state.sequencer, sequencerTransportSubunit: 0, currentPerformanceId: null, performanceName: "Rack", performanceDescription: "",
      instrumentsRunning: state.activeSessionState === "running", sessionState: state.activeSessionState, midiInputName: null, transportError: null }
  };
  return <SequencerPage {...props} />;
}
const card = (id: string) => document.querySelector<HTMLElement>(`[data-rack-binding-id="${id}"]`)!;
const handle = (id: string) => within(card(id)).getByRole("button", { name: /Reorder instrument/ });
const visibleOrder = () => [...document.querySelectorAll<HTMLElement>("[data-rack-binding-id]")].map(node => node.dataset.rackBindingId);
const indicator = () => document.querySelector("[data-rack-drop-position]");
const toggleRack = () => fireEvent.click(screen.getByRole("button", { name: "Instrument Rack" }));
function transfer() {
  const data: Record<string, string> = {};
  return { get types() { return Object.keys(data); }, effectAllowed: "none", dropEffect: "none", setData: (type: string, value: string) => { data[type] = value; }, getData: (type: string) => data[type] ?? "" };
}
function start(id: string) {
  const dataTransfer = transfer();
  fireEvent.dragStart(handle(id), { dataTransfer });
  return dataTransfer;
}
function drop(dataTransfer: ReturnType<typeof transfer>, target: string, after = false) {
  const event = { dataTransfer, clientY: after ? 175 : 125 };
  fireEvent.dragOver(card(target), event);
  fireEvent.drop(card(target), event);
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // jsdom has no native DragEvent; use mouse coordinates for the drop midpoint.
  vi.stubGlobal("DragEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 100, top: 100, bottom: 200, left: 0, right: 400, width: 400, height: 100, toJSON: noop });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ patches: fixture.patches as PatchListItem[] });
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("shows a divider and reorders duplicate instances with before/after feedback in each group", () => {
  render(<Page />);
  expect(visibleOrder()).toEqual(["note-1", "note-2", "note-3", "continuous-1", "continuous-2", "continuous-3"]);
  expect(screen.getAllByRole("separator")).toHaveLength(1);
  const dataTransfer = start("note-2");
  fireEvent.dragOver(card("note-1"), { dataTransfer, clientY: 125 });
  expect(indicator()?.getAttribute("data-rack-drop-position")).toBe("before");
  drop(dataTransfer, "note-1");
  expect(indicator()).toBeNull();
  expect(visibleOrder().slice(0, 3)).toEqual(["note-2", "note-1", "note-3"]);
  const second = start("continuous-1");
  fireEvent.dragOver(card("continuous-2"), { dataTransfer: second, clientY: 175 });
  expect(indicator()?.getAttribute("data-rack-drop-position")).toBe("after");
  drop(second, "continuous-2", true);
  expect(visibleOrder().slice(3)).toEqual(["continuous-2", "continuous-1", "continuous-3"]);
  expect(card("note-1").getAttribute("draggable")).toBeNull();
});

it("keeps mixer strips and the collapsed summary in rack order, excluding inserts and pinning Master", () => {
  const { container } = render(<Page />);
  drop(start("note-3"), "note-1");
  drop(start("continuous-2"), "continuous-1");
  const strips = [...container.querySelectorAll("article")];
  expect(strips.map(strip => strip.querySelector("button")?.textContent)).toEqual(["Bass", "Lead", "Lead", "Effect", "Effect", "Master"]);
  expect(strips.map(strip => (within(strip).getAllByRole("spinbutton", { name: "Gain dB" })[0] as HTMLInputElement).value)).toEqual(["-4", "0", "-2", "-3", "-1", "0"]);
  toggleRack();
  const summary = screen.getByRole("region", { name: "Instrument Rack" });
  expect([...summary.querySelectorAll("span[title]")].map(node => node.textContent)).toEqual(["Channel 3·Bass", "Channel 1·Lead", "Channel 2·Lead", "Continuous·Effect", "Continuous·Effect", "Continuous·Effect"]);
  expect(within(summary).getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");
  expect(summary.querySelector("[draggable]" )).toBeNull();
  toggleRack();
  expect(visibleOrder()[0]).toBe("note-3");
});

it.each(["cross-group", "self", "malformed", "unrelated", "stale"])("ignores %s drops", kind => {
  render(<Page />);
  const before = useAppStore.getState().sequencerInstruments;
  let dataTransfer = start("note-2");
  if (kind === "malformed") dataTransfer.setData(mime, "{");
  if (kind === "stale") dataTransfer.setData(mime, JSON.stringify({ bindingId: "deleted" }));
  if (kind === "unrelated") { dataTransfer = transfer(); dataTransfer.setData("text/plain", "note-2"); }
  drop(dataTransfer, kind === "cross-group" ? "continuous-1" : kind === "self" ? "note-2" : "note-1");
  expect(useAppStore.getState().sequencerInstruments).toBe(before);
  expect(indicator()).toBeNull();
});

it.each(["escape", "dragend", "collapse", "engine-start", "binding-change"])("cancels the drag on %s", kind => {
  render(<Page />);
  const dataTransfer = start("note-2");
  fireEvent.dragOver(card("note-1"), { dataTransfer, clientY: 125 });
  expect(indicator()).not.toBeNull();
  if (kind === "escape") fireEvent.keyDown(window, { key: "Escape" });
  if (kind === "dragend") fireEvent.dragEnd(handle("note-2"));
  if (kind === "collapse") { toggleRack(); toggleRack(); }
  if (kind === "engine-start") act(() => useAppStore.setState({ activeSessionState: "running" }));
  if (kind === "binding-change") act(() => useAppStore.getState().removeSequencerInstrument("note-2"));
  expect(indicator()).toBeNull();
  const before = useAppStore.getState().sequencerInstruments;
  drop(dataTransfer, "note-1");
  expect(useAppStore.getState().sequencerInstruments).toBe(before);
});

it("supports keyboard moves and disables all handles when instruments run", () => {
  render(<Page />);
  fireEvent.keyDown(handle("note-2"), { key: "ArrowUp" });
  expect(visibleOrder()[0]).toBe("note-2");
  fireEvent.keyDown(handle("note-2"), { key: "ArrowDown" });
  expect(visibleOrder()[0]).toBe("note-1");
  act(() => useAppStore.setState({ activeSessionState: "running" }));
  for (const button of screen.getAllByRole("button", { name: /Reorder instrument/ })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("draggable")).toBe("false");
  }
  const before = useAppStore.getState().sequencerInstruments;
  fireEvent.keyDown(handle("note-2"), { key: "ArrowUp" });
  drop(start("note-2"), "note-1");
  expect(useAppStore.getState().sequencerInstruments).toBe(before);
});

it.each(["standard", "continuous", "empty"])("omits the divider for a %s rack", kind => {
  act(() => useAppStore.setState({ sequencerInstruments: useAppStore.getState().sequencerInstruments.filter(b => kind === "standard" ? b.midiChannel > 0 : kind === "continuous" ? b.midiChannel === 0 : false) }));
  render(<Page />);
  expect(screen.queryAllByRole("separator")).toHaveLength(0);
  toggleRack();
  expect(screen.queryAllByRole("separator")).toHaveLength(0);
});

it.each(["english", "german", "french", "spanish"] as const)("localizes handles and their help in %s", language => {
  render(<Page language={language} />);
  const copy = SEQUENCER_UI_COPY[language];
  const buttons = screen.getAllByRole("button", { name: `Lead: ${copy.reorderInstrument}` });
  expect(buttons).toHaveLength(2);
  expect(buttons[0].title).toBe(copy.reorderInstrumentHint);
});
