// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { migrateClipArrangement } from "../../lib/clipArranger/migration";
import { QUARTER_TICKS } from "../../lib/clipArranger/model";
import { beginStructure, applyStructure } from "../../lib/clipArranger/structure";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import { useClipResolution } from "../../lib/clipArranger/draftResolution";
import { openClipEditor, saveClipDraftWithIntent } from "../../store/clipActions";
import { useAppStore } from "../../store/useAppStore";
import { api } from "../../api/client";
import { DraftResolutionDialog } from "../clipArranger/DraftResolutionDialog";
import { PerformWorkspace } from "./PerformWorkspace";
import { PerformanceEditorProvider, createPerformanceEditorStore, usePerformanceEditorState, useRetainedScroll, type PerformViewLayout } from "./PerformanceEditorState";

const state = useAppStore.getState;
const button = (name: string) => screen.getByRole("button", { name });
const click = (name: string) => fireEvent.click(button(name));

function fixture() {
  const sequencer = structuredClone(state().sequencer);
  const track = sequencer.tracks[0];
  track.padLoopEnabled = true;
  track.padLoopPattern = { groups: [], superGroups: [], rootSequence: [{ type: "pad", padIndex: 0 }] };
  const model = migrateClipArrangement(sequencer).model!;
  const lane = model.lanes[0], clip = lane.clips[0];
  clip.mode = "loop";
  clip.length = 16 * QUARTER_TICKS;
  lane.cycleTicks = null;
  model.end = clip.length;
  useAppStore.setState({ sequencer: { ...sequencer, clipArrangement: model } });
  return { id: track.id, target: { laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 1 } };
}

function Controls({ id }: { id: string }) {
  const [layout, setLayout] = usePerformanceEditorState<PerformViewLayout>("page", "layout", {});
  return <><button aria-expanded={layout.inspectorOpen ?? false} onClick={() => setLayout(previous => ({ ...previous, inspectorOpen: !previous.inspectorOpen }))}>Details</button>
    <button onClick={() => state().setSequencerTrackStepNote(id, 0, 73)}>Change note</button></>;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useStructureDraft.setState({ draft: null });
  HTMLDialogElement.prototype.showModal = function() { this.open = true; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("restores view-local panels and offsets and edits a Live pad independently of a dirty repeat on the same device", () => {
  const { id, target } = fixture(), store = createPerformanceEditorStore();
  const page = <PerformanceEditorProvider retainedStore={store}><PerformWorkspace language="english">{() => <Controls id={id} />}</PerformWorkspace></PerformanceEditorProvider>;
  const mounted = render(page);
  act(() => { state().selectSequencerEditingPad(id, 3); openClipEditor(target, "local"); });
  click("Change note");
  const before = state(), key = before.clipEditingKey!, draft = before.clipDrafts[key];
  expect(before.sequencerEditingPads[id]).toBe(3);
  const prevPads = before.sequencer.tracks[0].pads;
  const previousDefinition = structuredClone(before.sequencer.clipArrangement!.lanes[0].definitions[0]);
  click("Details");
  fireEvent.scroll(screen.getByRole("region", { name: "Arrange" }), { target: { scrollTop: 142 } });
  click("Live"); click("Live");
  expect(button("Details").getAttribute("aria-expanded")).toBe("false");
  expect(state().clipEditingKey).toBeNull();
  expect(state().sequencer).toBe(before.sequencer);
  expect(state().sequencerEditRevision).toBe(before.sequencerEditRevision);
  expect(state().sequencerRuntime).toBe(before.sequencerRuntime);
  expect(state().clipDrafts).toBe(before.clipDrafts);
  click("Change note");
  expect(state().sequencer.tracks[0].pads[3].steps[0].note).toBe(73);
  expect(state().sequencer.tracks[0].pads[0]).toBe(prevPads[0]);
  expect(state().clipDrafts[key]).toBe(draft);
  click("Mix"); click("Details");
  mounted.rerender(<></>); mounted.rerender(page);
  expect(button("Mix").getAttribute("aria-pressed")).toBe("true");
  expect(button("Details").getAttribute("aria-expanded")).toBe("true");
  click("Arrange");
  expect(screen.getByRole("region", { name: "Arrange" }).scrollTop).toBe(142);
  expect(button("Details").getAttribute("aria-expanded")).toBe("true");
  expect(state().clipEditingKey).toBe(key);
  expect(state().clipDrafts[key]).toBe(draft);
  act(() => saveClipDraftWithIntent());
  const lane = state().sequencer.clipArrangement!.lanes[0];
  expect(lane.definitions.find(d => d.id === previousDefinition.id)).toEqual(previousDefinition);
  expect(lane.definitions).toHaveLength(before.sequencer.clipArrangement!.lanes[0].definitions.length + 1);
  expect(state().sequencer.tracks[0].pads[3].steps[0].note).toBe(73);
});

it("drops a remembered editor when its repeat disappears, even if undo later restores the repeat", () => {
  const { id, target } = fixture();
  render(<PerformanceEditorProvider><PerformWorkspace language="english">{() => <Controls id={id} />}</PerformWorkspace></PerformanceEditorProvider>);
  act(() => openClipEditor(target, "local")); click("Change note"); click("Mix");
  const saved = state().sequencer, model = saved.clipArrangement!, lane = model.lanes[0];
  act(() => useAppStore.setState({ sequencer: { ...saved, clipArrangement: { ...model, lanes: [
    { ...lane, clips: [{ ...lane.clips[0], mode: "once" }] }, ...model.lanes.slice(1)
  ] } } }));
  act(() => useAppStore.setState({ sequencer: saved }));
  click("Arrange");
  expect(state().clipEditingKey).toBeNull();
  expect(Object.keys(state().clipDrafts)).toHaveLength(1);
});

it("keeps structural drafts and the initiating view after cancellation or a failed replacement", async () => {
  const { id, target } = fixture();
  const model = state().sequencer.clipArrangement!;
  const start = beginStructure(model, id, target.clipId, 0);
  const draft = applyStructure(start, { kind: "rest", target: { path: [], index: 1 }, ticks: QUARTER_TICKS }, {}, model);
  useStructureDraft.setState({ draft });
  render(<PerformanceEditorProvider><DraftResolutionDialog language="english" /><PerformWorkspace language="english">{() => <Controls id={id} />}</PerformWorkspace></PerformanceEditorProvider>);
  click("Live");
  let operation: Promise<void>;
  act(() => { operation = state().newPerformanceWorkspace(); });
  click("Cancel"); await act(async () => operation);
  expect(useStructureDraft.getState().draft).toBe(draft);
  vi.spyOn(api, "getPerformance").mockRejectedValue(new Error("offline"));
  act(() => { operation = state().loadPerformance("missing"); });
  click("Discard drafts and continue"); await act(async () => operation);
  expect(state().error).toBe("offline");
  expect(useStructureDraft.getState().draft).toBe(draft);
  expect(useClipResolution.getState().pending).toBeNull();
  expect(button("Live").getAttribute("aria-pressed")).toBe("true");
});

it("restores both axes when a mounted scroll region changes owner and ignores hidden zero offsets", () => {
  function Region({ id }: { id: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const save = useRetainedScroll(ref, `device:${id}`, "grid");
    return <div data-testid="pane" ref={ref} onScroll={save} />;
  }
  const page = (id: string) => <PerformanceEditorProvider><Region id={id} /></PerformanceEditorProvider>;
  const ui = render(page("one")), pane = screen.getByTestId("pane");
  fireEvent.scroll(pane, { target: { scrollLeft: 70, scrollTop: 54 } });
  ui.rerender(page("two")); expect([pane.scrollLeft, pane.scrollTop]).toEqual([0, 0]);
  fireEvent.scroll(pane, { target: { scrollLeft: 15, scrollTop: 9 } });
  ui.rerender(page("one")); expect([pane.scrollLeft, pane.scrollTop]).toEqual([70, 54]);
  fireEvent.scroll(pane, { target: { scrollLeft: 0, scrollTop: 0 } });
  ui.rerender(page("two")); ui.rerender(page("one"));
  expect([pane.scrollLeft, pane.scrollTop]).toEqual([70, 54]);

  // A real hidden scroller can ignore assignments altogether until it participates in layout.
  ui.rerender(page("two"));
  let visible = false, top = 0, resized: (() => void) | undefined;
  Object.defineProperties(pane, {
    clientHeight: { get: () => visible ? 120 : 0 },
    scrollTop: { get: () => top, set: (value: number) => { if (visible) top = value; } }
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
  try {
    ui.rerender(page("one"));
    expect(pane.scrollTop).toBe(0);
    visible = true;
    act(() => resized!());
    expect(pane.scrollTop).toBe(54);
  } finally { vi.unstubAllGlobals(); }
});
