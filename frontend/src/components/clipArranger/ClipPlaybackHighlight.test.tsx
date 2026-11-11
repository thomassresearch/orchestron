// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../backend/tests/fixtures/performances/device_names.json";
import { useAppStore } from "../../store/useAppStore";
import { openClipEditor } from "../../store/clipActions";
import { migrateClipArrangement, sourceKeys } from "../../lib/clipArranger/migration";
import { mergedSequencerState } from "../../lib/mergedSequencerState";
import { sequencerTransportSubunitsPerLocalStep } from "../../lib/sequencer";
import { SequencerPage } from "../SequencerPage";
import { INITIAL_PANEL_COLLAPSE_STATE } from "../CollapsiblePanel";
import { PerformanceAuditionContext } from "../sequencer/PerformanceAudition";
import type { SequencerState } from "../../types";
import { ClipPerformance } from "./ClipPerformance";
import { clipAuditionState, clipRuntimeView, runtimeSchedule } from "../../lib/clipArranger/runtime";
import type { SourceKind } from "../../lib/clipArranger/model";
import type { AuditionDevice } from "../sequencer/PerformanceAudition";
import { updateScoreTrack } from "../../store/scoreActions";

const readPosition = () => useAppStore.getState().sequencerRuntime.transportSubunit;

function actions<T>(): T { return new Proxy({}, { get: () => () => {} }) as T; }
function Page() {
  const store = useAppStore();
  return <SequencerPage collapsedPanels={INITIAL_PANEL_COLLAPSE_STATE} onPanelCollapsedChange={() => {}}
    instrumentActions={actions()} transportActions={actions()} melodicTrackActions={actions()} drummerTrackActions={actions()}
    controllerSequencerActions={actions()} pianoRollActions={actions()} arpeggiatorActions={actions()} performanceActions={actions()} midiControllerActions={actions()}
    data={{ guiLanguage: "english", patches: [], performances: [], instrumentBindings: [],
      sequencer: mergedSequencerState(store.sequencer, store.sequencerRuntime),
      sequencerTransportSubunit: store.sequencerRuntime.transportSubunit,
      readPlaybackTransportSubunit: readPosition,
      currentPerformanceId: null, performanceName: "Clip highlighting", performanceDescription: "",
      instrumentsRunning: true, sessionState: "running", midiInputName: null, transportError: null }} />;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().applySequencerConfigSnapshot(fixture.config);
  const sequencer = structuredClone(useAppStore.getState().sequencer);
  for (const key of Object.values(sourceKeys)) for (const track of sequencer[key]) {
    track.enabled = false;
    track.padLoopEnabled = true;
    track.padLoopPattern = { groups: [], superGroups: [], rootSequence: [{ type: "pad", padIndex: 0 }] };
    if ("playbackMode" in track) track.playbackMode = "arranger";
    if ("controllerMode" in track) track.controllerMode = "step";
  }
  sequencer.clipArrangement = migrateClipArrangement(sequencer).model!;
  useAppStore.setState({ sequencer });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["sequencer", "drummer", "controller"] as const)("animates the %s clip editor on Play edit and clears it on Stop edit", async source => {
  const lane = useAppStore.getState().sequencer.clipArrangement!.lanes.find(l => l.source === source)!;
  const clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 }, "all");
  const authored = useAppStore.getState().sequencer;
  const revision = useAppStore.getState().sequencerEditRevision;
  const track = authored[sourceKeys[source]][0];
  const runtimeKey = source === "sequencer" ? "trackStateById" : source === "drummer" ? "drummerStateById" : "controllerStateById";
  const origin = 20160 * 12;
  const tick = (step: number, playing = true) => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime,
    isPlaying: playing, arrangerActive: false, arrangerTransportSubunit: 0,
    transportSubunit: origin + step * sequencerTransportSubunitsPerLocalStep(track.timing),
    [runtimeKey]: { [lane.id]: { enabled: playing, activePad: 0, runtimePadStartSubunit: playing ? origin : null } },
    controllerRuntimePadStartSubunitById: { [lane.id]: playing ? origin : null }
  } }));
  const audition = vi.fn(async (_id, request) => { tick(0, request.action === "workspace_start"); });
  const { container } = render(<PerformanceAuditionContext.Provider value={audition}><Page /></PerformanceAuditionContext.Provider>);
  const highlighted = () => {
    const article = container.querySelector(`#sequencer-${lane.id}`)!;
    if (source === "sequencer") return article.querySelector('[class*="shadow-[0_0_0_1px"]');
    if (source === "drummer") return article.querySelector('div.font-mono.border-emerald-400\\/80');
    return article.querySelector('[aria-current="step"]');
  };
  expect(highlighted()).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play edit" })));
  const first = highlighted();
  expect(first).not.toBeNull();
  act(() => tick(3));
  expect(highlighted()).not.toBeNull();
  expect(highlighted()).not.toBe(first);
  expect(useAppStore.getState().sequencerRuntime.arrangerTransportSubunit).toBe(0);
  expect(audition).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().sequencer).toBe(authored);
  expect(useAppStore.getState().sequencerEditRevision).toBe(revision);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop edit" })));
  expect(highlighted()).toBeNull();
});

it.each(["score", "arpeggiator"] as const)("passes live %s status through without replacing the draft", source => {
  const lane = useAppStore.getState().sequencer.clipArrangement!.lanes.find(l => l.source === source)!;
  const clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 }, "all");
  let view!: SequencerState;
  render(<ClipPerformance language="english" renderEditor={(_kind, _id, state) => { view = state; return null; }} />);
  act(() => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime, isPlaying: true,
    trackStateById: { [lane.id]: { enabled: true, activePad: 2, runtimePadStartSubunit: 12345 } },
    arpeggiatorStatusById: { [lane.id]: { heldNotes: [60, 64], activeNote: 64, stepIndex: 3, lastVelocity: 90 } }
  } })));
  expect(view.isPlaying).toBe(true);
  expect(view[sourceKeys[source]][0].activePad).toBe(0);
  if (source === "score") expect(view.scoreTracks[0]).toMatchObject({ enabled: true, runtimePadStartSubunit: 12345 });
  else expect(view.arpeggiators[0]).toMatchObject({ activeNote: 64, stepIndex: 3, heldNotes: [60, 64] });
});

const editorCases: { source: SourceKind; mode?: "step" | "curve" }[] = [
  { source: "sequencer" }, { source: "drummer" }, { source: "score" },
  { source: "controller", mode: "step" }, { source: "controller", mode: "curve" }, { source: "arpeggiator" }
];
it.each(editorCases.flatMap(editor => (["local", "all"] as const).map(scope => ({ ...editor, scope }))))(
  "plays and animates $source $mode before and after $scope save and reload", async ({ source, mode, scope }) => {
    // Drive animation frames explicitly, including score's imperative SVG playhead.
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(performance.now())); };
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    const initial = structuredClone(useAppStore.getState().sequencer);
    const lane = initial.clipArrangement!.lanes.find(l => l.source === source)!;
    lane.cycleTicks = null;
    const clip = lane.clips[0];
    lane.clips.push({ ...structuredClone(clip), id: "linked", start: clip.start + clip.length,
      children: clip.children.map(c => ({ ...c, id: `linked-${c.id}` })) });
    initial.clipArrangement!.end = Math.max(initial.clipArrangement!.end, clip.length * 2);
    if (mode) initial.controllerSequencers[0].controllerMode = mode;
    useAppStore.setState({ sequencer: initial });
    const open = () => {
      const cl = useAppStore.getState().sequencer.clipArrangement!.lanes.find(l => l.id === lane.id)!.clips[0];
      openClipEditor({ laneId: lane.id, clipId: cl.id, path: [cl.children[0].id], pass: 0 }, scope);
    };
    open();
    const original = structuredClone(useAppStore.getState().clipDrafts[useAppStore.getState().clipEditingKey!].definition);
    const actions = useAppStore.getState();
    if (source === "sequencer") actions.setSequencerTrackStepNote(lane.id, 0, 77);
    if (source === "drummer") actions.setDrummerSequencerCellVelocity(lane.id, initial.drummerTracks[0].rows[0].id, 0, 83);
    if (source === "score") updateScoreTrack(lane.id, t => ({ ...t, pads: t.pads.map((p, i) => i ? p : { ...p,
      notes: [{ id: "edited", pitch: 67, velocity: 93, startTicks: 0, durationTicks: 20160 }] }) }));
    if (source === "controller") {
      if (mode === "step") actions.setControllerSequencerStep(lane.id, 0, 87);
      else actions.setControllerSequencerKeypoint(lane.id, initial.controllerSequencers[0].pads[0].keypoints[0].id, 0, 87);
    }
    if (source === "arpeggiator") actions.updateArpeggiator(lane.id, { pattern: "down", octaves: 3 });
    const edited = structuredClone(useAppStore.getState().clipDrafts[useAppStore.getState().clipEditingKey!].definition);
    expect(edited).not.toEqual(original);
    let slot = 0;
    const origin = 20160 * 12;
    const tick = (step: number, running = true) => useAppStore.setState(s => ({
      performanceAuditions: { [lane.id]: { active: running, queued: null, workspace_active: running } },
      sequencerRuntime: { ...s.sequencerRuntime, isPlaying: running, arrangerActive: false, arrangerTransportSubunit: 0,
        transportSubunit: origin + step * 5040,
        trackStateById: { [lane.id]: { enabled: running, activePad: slot, runtimePadStartSubunit: running ? origin : null } },
        drummerStateById: { [lane.id]: { enabled: running, activePad: slot, runtimePadStartSubunit: running ? origin : null } },
        controllerStateById: { [lane.id]: { enabled: running, activePad: slot } },
        controllerRuntimePadStartSubunitById: { [lane.id]: running ? origin : null },
        arpeggiatorStatusById: { [lane.id]: { heldNotes: running ? [60, 64, 67] : [], activeNote: running ? 60 + step : null,
          stepIndex: step, lastVelocity: running ? 100 : null,
          status: { arpeggiator_id: lane.id, enabled: false, active_pad: slot, input_channel: 6, target_channel: 1,
            held_notes: running ? [60, 64, 67] : [], active_note: running ? 60 + step : null, step_index: step,
            last_velocity: running ? 100 : null, state: running ? "playing" : "stopped",
            preview_notes: Array.from({ length: 16 }, (_, i) => [60 + i % 3]) } } }
      }
    }));
    const audition = vi.fn<AuditionDevice>(async (_id, request) => {
      if (typeof request === "string" || !("action" in request)) throw Error("Expected workspace command");
      if (request.action === "workspace_start" && request.clipDraft) {
        const compiled = clipAuditionState(useAppStore.getState().sequencer, request.clipDraft);
        slot = compiled.sequence[0];
        expect(slot).toBeGreaterThan(0); // Runtime definitions are not the editor's synthetic pad zero.
        expect(clipRuntimeView(compiled.state)[sourceKeys[source]][0].pads[slot]).toEqual(
          edited.kind === "pattern" ? edited.payload : null);
        tick(0);
      } else tick(0, false);
    });
    const mounted = render(<PerformanceAuditionContext.Provider value={audition}><Page /></PerformanceAuditionContext.Provider>);
    const indicator = () => {
      const editor = screen.getByRole("region", { name: "Editing" });
      if (source === "score") {
        const x = editor.querySelector('line[stroke="#f8fafc"]')?.getAttribute("x1");
        return x && Number(x) >= 64 ? x : null;
      }
      if (source === "controller" && mode === "curve") return editor.querySelector('line[stroke-dasharray="5 4"]')?.getAttribute("x1") ?? null;
      if (source === "controller") return editor.querySelector('[aria-current="step"]')?.getAttribute("aria-label") ?? null;
      if (source === "arpeggiator") return editor.querySelector('[class*="bg-cyan-900/70"] button')?.getAttribute("aria-label") ?? null;
      if (source === "drummer") return editor.querySelector('div.font-mono.border-emerald-400\\/80')?.textContent ?? null;
      return editor.querySelector('[class*="shadow-[0_0_0_1px"]')?.textContent ?? null;
    };
    const checkPlayback = async () => {
      const before = useAppStore.getState().sequencer;
      const revision = useAppStore.getState().sequencerEditRevision;
      expect(indicator()).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play edit" })));
      expect(screen.queryAllByRole("alert").map(e => e.textContent)).toEqual([]);
      act(frame);
      const first = indicator(); expect(first).not.toBeNull();
      act(() => { tick(2); frame(); });
      expect(indicator()).not.toBeNull(); expect(indicator()).not.toBe(first);
      if (source === "arpeggiator") {
        const status = useAppStore.getState().sequencerRuntime.arpeggiatorStatusById[lane.id];
        const report = (change: Partial<NonNullable<typeof status.status>>) => useAppStore.setState(s => ({
          sequencerRuntime: { ...s.sequencerRuntime, arpeggiatorStatusById: {
            [lane.id]: { ...status, status: { ...status.status!, ...change } }
          } }
        }));
        act(() => report({ state: "waiting_notes", held_notes: [] }));
        expect(indicator()).toBeNull();
        act(() => report({ active_pad: 1 })); // A different definition must not light this editor.
        expect(indicator()).toBeNull();
        act(() => tick(2));
        expect(indicator()).not.toBeNull();
      }
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop edit" })));
      act(frame);
      expect(indicator()).toBeNull();
      expect(useAppStore.getState().sequencer).toBe(before);
      expect(useAppStore.getState().sequencerEditRevision).toBe(revision);
    };
    await checkPlayback();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: scope === 'local' ? 'Save variation here' : /^Save to linked/ })));
    act(open);
    await checkPlayback();
    const snapshot = useAppStore.getState().buildSequencerConfigSnapshot();
    mounted.unmount();
    act(() => useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(snapshot))));
    act(open);
    render(<PerformanceAuditionContext.Provider value={audition}><Page /></PerformanceAuditionContext.Provider>);
    await checkPlayback();
    const restored = useAppStore.getState().sequencer;
    const restoredLane = restored.clipArrangement!.lanes.find(l => l.id === lane.id)!;
    const schedule = runtimeSchedule(restored, restoredLane);
    const pads = clipRuntimeView(restored)[sourceKeys[source]][0].pads;
    expect(pads[schedule.clips[1].content[0].pad!]).toEqual(scope === "local"
      ? original.kind === "pattern" ? original.payload : null : edited.kind === "pattern" ? edited.payload : null);
    expect(audition.mock.calls.filter(([, r]) => typeof r !== "string" && "action" in r && r.action === "workspace_start")).toHaveLength(3);
  });
