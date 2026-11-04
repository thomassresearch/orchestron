// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../backend/tests/fixtures/sequencers/instrument_automation.json";
import { useAppStore } from "../../store/useAppStore";
import { generateAutomation } from "../../store/automationActions";
import { openClipEditor, clipHistoryStep } from "../../store/clipActions";
import { migrateClipArrangement } from "../../lib/clipArranger/migration";
import { ClipPerformance } from "./ClipPerformance";
import { audioTemplate } from "../../lib/audioTemplates";
import { toPatchListItem } from "../../lib/patchCatalog";
import type { PerformanceControllerDefinition } from "../../types";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useStructureDraft.setState({ draft: null });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.setPointerCapture = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 72, width: 960, height: 72, toJSON() {} });
  const seq = structuredClone(useAppStore.getState().sequencer);
  seq.tracks = [seq.tracks[0]];
  seq.tracks[0].padLoopEnabled = true;
  seq.tracks[0].padLoopPattern.rootSequence = [{ type: "pad", padIndex: 0 }];
  seq.clipArrangement = migrateClipArrangement(seq).model!;
  const source = seq.clipArrangement.lanes[0];
  source.cycleTicks = null;
  useAppStore.setState({ sequencer: seq, patches: [{ ...toPatchListItem(audioTemplate("empty")), id: "synth", performance_controllers: fixture.controls as PerformanceControllerDefinition[] }],
    sequencerInstruments: [{ id: "rack", patchId: "synth", midiChannel: seq.tracks[0].midiChannel, level: 1, effectRoutes: [], effectSourceIds: [], performanceControllerMidiCCs: fixture.mappings }] });
  generateAutomation(source.id, source.clips[0].id, "rack");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["local", "all"] as const)("edits points inside the clip, saves %s scope and supports Undo/Redo and discard", async scope => {
  const seq = structuredClone(useAppStore.getState().sequencer), model = seq.clipArrangement!, lane = model.lanes[1], clip = lane.clips[0];
  lane.clips.push({ ...structuredClone(clip), id: "linked", start: clip.length, children: clip.children.map(c => ({ ...c, id: "linked-child" })) });
  model.end = clip.length * 2;
  useAppStore.setState({ sequencer: seq });
  const target = { laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 };
  openClipEditor(target);
  const view = render(<ClipPerformance language="english" renderEditor={() => null} />);
  const svg = view.container.querySelector('[data-expanded="true"] svg')!;
  expect(svg).toBeTruthy();
  fireEvent.pointerDown(svg.querySelector("rect")!, { button: 0, clientX: 480, clientY: 15 });
  expect(screen.getByText("Curve points: 3/10")).toBeTruthy();
  expect(useAppStore.getState().sequencer.clipArrangement).toBe(model);
  fireEvent.click(within(screen.getByRole("region", { name: "Editing" })).getByRole("button", { name: "Save" }));
  const dialog = screen.getByRole("dialog");
  if (scope === "all") fireEvent.click(within(dialog).getByRole("radio", { name: /All linked/ }));
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
  const saved = useAppStore.getState().sequencer.clipArrangement!;
  const savedLane = saved.lanes[1];
  const firstId = "definitionId" in savedLane.clips[0].children[0] && savedLane.clips[0].children[0].definitionId;
  const secondId = "definitionId" in savedLane.clips[1].children[0] && savedLane.clips[1].children[0].definitionId;
  expect(firstId === secondId).toBe(scope === "all");
  act(() => clipHistoryStep(false));
  expect(useAppStore.getState().sequencer.clipArrangement!.lanes).toEqual(model.lanes);
  act(() => clipHistoryStep(true));
  expect(useAppStore.getState().sequencer.clipArrangement!.lanes).toEqual(saved.lanes);
  const currentClip = savedLane.clips[0];
  act(() => openClipEditor({ ...target, path: [currentClip.children[0].id] }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Curve duration · master beats" }), { target: { value: "128" } });
  const committed = useAppStore.getState().sequencer;
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard curve edits" })));
  expect(useAppStore.getState().sequencer).toBe(committed);
  expect(useAppStore.getState().clipEditingKey).toBeNull();
  expect(Object.keys(useAppStore.getState().clipDrafts)).toHaveLength(0);
});

it("rescales point coordinates inside the clip while a longer duration is still a draft", () => {
  const seq = useAppStore.getState().sequencer, lane = seq.clipArrangement!.lanes[1], clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
  const view = render(<ClipPerformance language="english" renderEditor={() => null} />);
  const length = clip.length / 20160;
  fireEvent.change(screen.getByRole("spinbutton", { name: "Curve duration · master beats" }), { target: { value: String(length * 2) } });
  const svg = view.container.querySelector('[data-expanded="true"] svg')!;
  fireEvent.pointerDown(svg.querySelector("rect")!, { button: 0, clientX: 480, clientY: 15 });
  const s = useAppStore.getState(), def = s.clipDrafts[s.clipEditingKey!].definition;
  if (def.kind !== "pattern" || def.source !== "controller") throw Error("Expected controller");
  expect(def.payload.keypoints[1].position).toBe(.25);
  expect(s.sequencer).toEqual(seq);
});
