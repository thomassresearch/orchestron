// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { migrateClipArrangement } from "../../lib/clipArranger/migration";
import { ClipPerformance } from "./ClipPerformance";
import { openClipEditor } from "../../store/clipActions";
import { PerformanceAuditionContext } from "../sequencer/PerformanceAudition";
import { ClipTransport } from "./ClipTransport";
import { buildSequencerConfigSnapshot, parseSequencerConfigSnapshot } from "../../store/appStoreModel";
import { buildSequencerPlaybackRange } from "../../appOrchestration";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import { clipHistoryStep } from "../../store/clipActions";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useStructureDraft.setState({draft:null});
  const s = structuredClone(useAppStore.getState().sequencer), track = s.tracks[0];
  track.padLoopEnabled = true;
  track.padLoopPattern = { groups: [{ id: "G", sequence: [{ type: "pad", padIndex: 0 }, { type: "pad", padIndex: 0 }] }], superGroups: [{ id: "S", sequence: [{ type: "group", groupId: "G" }] }], rootSequence: [{ type: "super", superGroupId: "S" }] };
  s.clipArrangement = migrateClipArrangement(s).model!;
  useAppStore.setState({ sequencer: s });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

it("uses the looping song cursor instead of the advancing shared clock and toggles a visible clip loop", () => {
  const lane = useAppStore.getState().sequencer.clipArrangement!.lanes[0], clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
  useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime, arrangerTransportSubunit: 20160 } }));
  render(<ClipPerformance language="english" position={20160 * 80} renderEditor={() => null}
    onLoopChange={range => useAppStore.getState().setSequencerArrangerLoopSelection(range)} onSeek={() => {}} />);
  expect((screen.getByRole("spinbutton", { name: "Position" }) as HTMLInputElement).value).toBe("1");
  const loop = screen.getByRole("button", { name: "Loop" });
  expect((loop as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(loop);
  expect(loop.getAttribute("aria-pressed")).toBe("true");
  expect(loop.className).toContain("!bg-amber-300");
  expect(useAppStore.getState().sequencer.arrangerLoopSelection).toEqual({ startStep: clip.start / 2520, endStep: (clip.start + clip.length) / 2520 });
  fireEvent.click(loop);
  expect(loop.getAttribute("aria-pressed")).toBe("false");
  expect(loop.className).not.toContain("!bg-amber-300");
});

it("dispatches tape transport actions and shows song playback independently from audition", () => {
  const onPlay = vi.fn(), onPause = vi.fn(), onStop = vi.fn(), onRewind = vi.fn(), onForward = vi.fn();
  render(<ClipTransport language="english" copy={{ transportPlay: "Play", transportStop: "Stop", transportRewind: "Rewind", transportFastForward: "Forward" }}
    {...{ onPlay, onPause, onStop, onRewind, onForward }} />);
  for (const [name, action] of [["Play", onPlay], ["Pause", onPause], ["Stop", onStop], ["Rewind", onRewind], ["Forward", onForward]] as const) {
    fireEvent.click(screen.getByRole("button", { name })); expect(action).toHaveBeenCalledOnce();
  }
  act(() => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime, isPlaying: true, arrangerActive: false } })));
  expect(screen.getByRole("button", { name: "Play" }).getAttribute("aria-pressed")).toBe("false");
  act(() => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime, arrangerActive: true } })));
  expect(screen.getByRole("button", { name: "Play" }).getAttribute("aria-pressed")).toBe("true");
});

it("selects a loop target when loading with looping off, without expanding or editing", () => {
  render(<ClipPerformance language="english" renderEditor={() => null}
    onLoopChange={value => useAppStore.getState().setSequencerArrangerLoopSelection(value)} />);
  const loop = screen.getByRole("button", { name: "Loop" }) as HTMLButtonElement;
  expect(loop.disabled).toBe(false);
  expect(screen.queryByRole("region", { name: "Editing" })).toBeNull();
  expect(document.querySelector('[data-expanded="true"]')).toBeNull();
  fireEvent.click(loop);
  expect(loop.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(loop);
  expect(loop.getAttribute("aria-pressed")).toBe("false");
  expect(loop.disabled).toBe(false);
});

it("keeps empty-space deselection through transport changes and loops the whole song, including trailing silence", () => {
  const model = useAppStore.getState().sequencer.clipArrangement!;
  model.end += 20160 * 4;
  const lane = model.lanes[0], clip = lane.clips[0];
  clip.start = 20160;
  render(<ClipPerformance language="english" renderEditor={() => null} onSeek={() => {}}
    onLoopChange={value => useAppStore.getState().setSequencerArrangerLoopSelection(value)} />);
  const loop = screen.getByRole("button", { name: "Loop" });
  expect(loop.title).toBe("Loop selected clip");
  fireEvent.click(document.querySelector("[data-clip-timeline]")!);
  expect(screen.queryByRole("button", { name: "Remove clip" })).toBeNull();
  expect(loop.title).toBe("Loop whole song");
  for (const [playing, position] of [[true, 20160], [false, 20160], [false, 0]] as const) {
    act(() => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime,
      isPlaying: playing, arrangerActive: playing, arrangerTransportSubunit: position } })));
    expect(loop.title).toBe("Loop whole song");
  }
  fireEvent.click(loop);
  expect(useAppStore.getState().sequencer.arrangerLoopSelection).toEqual({ startStep: 0, endStep: model.end / 2520 });
  expect(loop.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(loop);
  expect(useAppStore.getState().sequencer.arrangerLoopSelection).toBeNull();
  // Clicking the clip body, not just its header, restores a clip loop target.
  fireEvent.click(document.querySelector(`[data-arranger-clip="${clip.id}"]`)!);
  expect(loop.title).toBe("Loop selected clip");
  fireEvent.click(loop);
  expect(useAppStore.getState().sequencer.arrangerLoopSelection).toEqual({
    startStep: clip.start / 2520, endStep: (clip.start + clip.length) / 2520
  });
});

it("deselects nested content on ruler clicks without discarding its open editor", () => {
  const lane = useAppStore.getState().sequencer.clipArrangement!.lanes[0], clip = lane.clips[0];
  openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id], pass: 0 });
  const seek = vi.fn();
  render(<ClipPerformance language="english" renderEditor={() => null} onSeek={seek}
    onLoopChange={value => useAppStore.getState().setSequencerArrangerLoopSelection(value)} />);
  fireEvent.click(screen.getByRole("button", { name: "▤ S" }));
  fireEvent.click(document.querySelector("[data-arranger-viewport] [aria-hidden]")!);
  expect(seek).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Remove clip" })).toBeNull();
  expect(screen.getByRole("region", { name: "Editing" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Loop" }).title).toBe("Loop whole song");
  expect(document.querySelector('[data-structure-node][style*="outline: 2px"]')).toBeNull();
});

it("exposes retained trailing silence and fits the finite song end explicitly with undo and reload", () => {
  useAppStore.setState(s => ({ sequencer: { ...s.sequencer,
    clipArrangement: { ...s.sequencer.clipArrangement!, end: 20160 * 19.25,
      lanes: s.sequencer.clipArrangement!.lanes.map(l => ({ ...l, cycleTicks: null,
        clips: l.clips.map(cl => ({ ...cl, start: 0, length: 20160 * 16 })) })) } } }));
  render(<ClipPerformance language="english" renderEditor={() => null} />);
  expect((screen.getByRole("spinbutton", { name: "Song end" }) as HTMLInputElement).value).toBe("19.25");
  fireEvent.click(screen.getByRole("button", { name: "Fit song to clips" }));
  const state = useAppStore.getState().sequencer;
  expect(state.clipArrangement!.end).toBe(20160 * 16);
  expect(buildSequencerPlaybackRange(state, "runtime", true).playback_end_step).toBe(128);
  const restored = parseSequencerConfigSnapshot(buildSequencerConfigSnapshot(state, []), [], null).sequencer;
  expect(restored.clipArrangement!.end).toBe(20160 * 16);
  act(() => clipHistoryStep(false));
  expect(useAppStore.getState().sequencer.clipArrangement!.end).toBe(20160 * 19.25);
  fireEvent.blur(screen.getByRole("spinbutton", { name: "Song end" }), { target: { value: "15" } });
  expect(useAppStore.getState().sequencer.clipArrangement!.end).toBe(20160 * 19.25);
  expect(screen.getByRole("alert").textContent).toContain("boundary");
});

it("can re-enable a loaded clip loop after off, play, stop and rewind without opening an editor", () => {
  const lane = useAppStore.getState().sequencer.clipArrangement!.lanes[0], clip = lane.clips[0];
  const range = { startStep: clip.start / 2520, endStep: (clip.start + clip.length) / 2520 };
  useAppStore.getState().setSequencerArrangerLoopSelection(range);
  render(<ClipPerformance language="english" renderEditor={() => null}
    onLoopChange={value => useAppStore.getState().setSequencerArrangerLoopSelection(value)} />);
  const loop = screen.getByRole("button", { name: "Loop" }) as HTMLButtonElement;
  expect(loop.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(loop);
  expect(loop.disabled).toBe(false);
  expect(loop.getAttribute("aria-pressed")).toBe("false");
  for (const [playing, position] of [[true, 20160], [false, 20160], [false, 0]] as const) {
    act(() => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime,
      isPlaying: playing, arrangerActive: playing, arrangerTransportSubunit: position } })));
  }
  fireEvent.click(loop);
  expect(useAppStore.getState().sequencer.arrangerLoopSelection).toEqual(range);
  fireEvent.click(loop);
  fireEvent.click(loop);
  expect(loop.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("region", { name: "Editing" })).toBeNull();
});

it("does not restart an audition on transport ticks and coalesces musical draft changes", async () => {
  vi.useFakeTimers();
  try {
    const lane = useAppStore.getState().sequencer.clipArrangement!.lanes[0], clip = lane.clips[0];
    const supergroup = lane.definitions.find(d => d.kind === "supergroup")!;
    const group = lane.definitions.find(d => d.kind === "group")!;
    if (supergroup.kind === "pattern" || group.kind === "pattern") throw Error("Expected containers");
    openClipEditor({ laneId: lane.id, clipId: clip.id, path: [clip.children[0].id, supergroup.children[0].id, group.children[0].id], pass: 0 });
    const audition = vi.fn().mockResolvedValue(undefined);
    render(<PerformanceAuditionContext.Provider value={audition}><ClipPerformance language="english" renderEditor={() => null} /></PerformanceAuditionContext.Provider>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Play edit" })));
    for (let tick = 0; tick < 12; tick++) {
      act(() => useAppStore.setState(s => ({ sequencerRuntime: { ...s.sequencerRuntime, playhead: tick }, performanceAuditions: {} })));
      await act(() => vi.advanceTimersByTimeAsync(100));
    }
    expect(audition).toHaveBeenCalledTimes(1);
    act(() => {
      useAppStore.getState().setSequencerTrackStepNote(lane.id, 0, 65);
      useAppStore.getState().setSequencerTrackStepNote(lane.id, 0, 72);
    });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(audition).toHaveBeenCalledTimes(2);
    expect(audition.mock.calls[1][1].gestureId).toBe(audition.mock.calls[0][1].gestureId);
    expect(audition.mock.calls[1][1].clipDraft.definition.payload.steps[0].note).toBe(72);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop edit" })));
    expect(audition.mock.calls[2][1].action).toBe("workspace_end");
  } finally { vi.useRealTimers(); }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("expands the nested boxes, opens a container, defaults to local save and preserves a cancelled draft", async () => {
  useAppStore.getState().sequencer.clipArrangement!.lanes[0].cycleTicks=null;
  const track = useAppStore.getState().sequencer.tracks[0];
  render(<ClipPerformance language="english" renderEditor={() => null} />);
  const toggle = screen.getByRole("button", { name: `▸ ${track.name}` });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  fireEvent.keyDown(screen.getByRole("button", { name: "▤ S" }), { key: "Enter" });
  expect(screen.getByRole("region", { name: "Editing" })).toBeTruthy();
  fireEvent.click(within(screen.getByRole("region", { name: "Editing" })).getByRole("button", { name: "Rest +1" }));
  fireEvent.click(within(screen.getByRole("region", {name:"Editing"})).getByRole("button", { name: "Save structure" }));
  let dialog = screen.getByRole("dialog", { name: "Save structure" });
  expect((within(dialog).getByRole("radio", { name: "Only this occurrence" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", {name:"Save structure"})).toBeNull();
  expect(within(screen.getByRole("region", {name:"Editing"})).getByText("Unsaved draft")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("region", {name:"Editing"})).getByRole("button", { name: "Save structure" }));
  dialog = screen.getByRole("dialog");
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
  expect(useAppStore.getState().clipEditingKey).toBeNull();
  expect(useAppStore.getState().sequencer.clipHistory?.cursor).toBe(1);
});

it('creates a silent four-beat clip immediately and opens its inline content picker',()=>{
 render(<ClipPerformance language="english" renderEditor={()=>null}/>);
 const old=useAppStore.getState().sequencer.clipArrangement!.lanes[0];
 fireEvent.click(screen.getAllByRole('button',{name:/Add clip:/})[0]);
 const lane=useAppStore.getState().sequencer.clipArrangement!.lanes[0],clip=lane.clips[lane.clips.length-1];
 expect(clip).toMatchObject({start:Math.max(...old.clips.map(c=>c.start+c.length)),length:4*20160,mode:'once'});
 expect(clip.children[0]).toMatchObject({restTicks:4*20160});
 expect(screen.queryByRole('dialog',{name:'Add clip'})).toBeNull();
 const box=document.querySelector(`[data-arranger-clip="${clip.id}"]`)!;
 fireEvent.click(within(box as HTMLElement).getByRole('button',{name:'Add content'}));
 expect(screen.getByRole('dialog',{name:'Add content'})).toBeTruthy();
});
