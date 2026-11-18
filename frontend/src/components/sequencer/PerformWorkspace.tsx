import { useLayoutEffect, type ReactNode } from "react";
import { useStore } from "zustand";
import type { GuiLanguage, SequencerState } from "../../types";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import type { OccurrenceTarget, SourceKind } from "../../lib/clipArranger/model";
import { structureChildren } from "../../lib/clipArranger/structure";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import type { StructureFocus } from "../clipArranger/StructureEditor";
import { definitionAt } from "../../lib/clipArranger/operations";
import { localLoopWindows } from "../../lib/clipArranger/relationships";
import { useAppStore } from "../../store/useAppStore";
import { editorKey, PerformViewContext, RetainedScroll, usePerformanceEditorStore, type PerformanceEditorStore, type PerformView, type PerformViewLayout } from "./PerformanceEditorState";

const copy = {
  english: { arrange: "Arrange", live: "Live", mix: "Mix", views: "Perform views" },
  german: { arrange: "Arrangement", live: "Live", mix: "Mix", views: "Performance-Ansichten" },
  french: { arrange: "Arrangement", live: "Live", mix: "Mixage", views: "Vues de performance" },
  spanish: { arrange: "Arreglo", live: "En vivo", mix: "Mezcla", views: "Vistas de interpretación" }
};
const views: PerformView[] = ["arrange", "live", "mix"];

function laneForPass(sequencer: SequencerState, target: Pick<OccurrenceTarget, "laneId" | "clipId" | "pass">) {
  const lane = sequencer.clipArrangement?.lanes.find(lane => lane.id === target.laneId);
  const clip = lane?.clips.find(clip => clip.id === target.clipId);
  if (!lane || !clip) return null;
  if (clip.mode === "loop" ? !localLoopWindows(lane, clip.id, target.pass, arrangementTimings(sequencer)[lane.id]) : target.pass !== 0) return null;
  return lane;
}

export function survivingClipKey(key: string | null) {
  const { sequencer, clipDrafts } = useAppStore.getState();
  const draft = key ? clipDrafts[key] : undefined;
  if (!draft) return null;
  const lane = laneForPass(sequencer, draft.target);
  if (!lane) return null;
  try { return definitionAt(lane, draft.target).id === draft.definition.id ? key : null; }
  catch { return null; }
}

function survivingStructureFocus(sequencer: SequencerState, focus: StructureFocus) {
  const lane = laneForPass(sequencer, focus);
  if (!lane) return false;
  if (!focus.parent.length) return true;
  const { draft } = useStructureDraft.getState();
  try {
    if (draft && draft.laneId === focus.laneId && draft.clipId === focus.clipId && draft.pass === focus.pass) {
      structureChildren(draft.roots, focus.parent);
      return true;
    }
    return definitionAt(lane, { ...focus, path: focus.parent }).kind !== "pattern";
  } catch { return false; }
}

function pruneViewSelections(store: PerformanceEditorStore, arrangementChanged = true) {
  const state = useAppStore.getState(), { entries } = store.getState();
  const changes: typeof entries = {};
  const value = <T,>(owner: "page" | "arranger" | "mixer", field: string, view: PerformView) =>
    entries[editorKey(owner, field, view)]?.value as T | undefined;
  const clear = (owner: "page" | "arranger" | "mixer", field: string, view: PerformView, value: unknown) => {
    changes[editorKey(owner, field, view)] = { owner, value };
  };
  const device = value<string>("page", "liveDevice", "live");
  if (device && !Object.values(sourceKeys).some(key => state.sequencer[key].some(track => track.id === device))) {
    clear("page", "liveDevice", "live", "");
    const layout = value<PerformViewLayout>("page", "layout", "live");
    if (layout?.dock === "editor") clear("page", "layout", "live", { ...layout, dock: null });
  }
  const legacy = value<{ id: string; kind: SourceKind }>("arranger", "legacyPad", "arrange");
  if (legacy && !state.sequencer[sourceKeys[legacy.kind]].some(t => t.id === legacy.id)) {
    clear("arranger", "legacyPad", "arrange", null);
    const layout = value<PerformViewLayout>("page", "layout", "arrange");
    if (layout?.dock === "editor") clear("page", "layout", "arrange", { ...layout, dock: null });
  }
  const binding = value<string>("mixer", "selected", "mix");
  if (binding && binding !== "$master" && !state.sequencerInstruments.some(row => row.id === binding)) clear("mixer", "selected", "mix", "");
  const lanes = state.sequencer.clipArrangement?.lanes;
  const selected = value<{ laneId: string; clipId?: string }>("arranger", "clipSelection", "arrange");
  if (selected) {
    const lane = lanes?.find(l => l.id === selected.laneId);
    if (!lane || (selected.clipId && !lane.clips.some(c => c.id === selected.clipId))) {
      clear("arranger", "clipSelection", "arrange", lane ? { laneId: lane.id } : null);
    }
  }
  const expanded = value<string>("arranger", "clipExpandedLane", "arrange");
  if (expanded && !lanes?.some(l => l.id === expanded)) clear("arranger", "clipExpandedLane", "arrange", null);
  const focus = value<StructureFocus>("arranger", "structureFocus", "arrange");
  if (arrangementChanged && focus && !survivingStructureFocus(state.sequencer, focus)) {
    clear("arranger", "structureFocus", "arrange", null);
    clear("arranger", "structureSelection", "arrange", null);
  }
  if (Object.keys(changes).length) store.setState({ entries: { ...entries, ...changes } });
}

/** Transfer the write target before the destination editor can receive input. */
function navigate(store: PerformanceEditorStore, next: PerformView) {
  const { view, suspendedClipKey } = store.getState();
  if (view === next) return;
  const active = useAppStore.getState().clipEditingKey;
  const remembered = view === "arrange" ? active : suspendedClipKey;
  const destination = next === "arrange" ? survivingClipKey(remembered) : null;
  if (active !== destination) useAppStore.setState({ clipEditingKey: destination });
  store.setState({ view: next, suspendedClipKey: next === "arrange" ? null : remembered });
}

export type ViewNavigation = (view: PerformView, padTarget?: { id: string; pad: number }) => void;

export function PerformWorkspace({ language, children }: { language: GuiLanguage; children: (view: PerformView, navigate: ViewNavigation) => ReactNode }) {
  const store = usePerformanceEditorStore();
  const view = useStore(store, s => s.view);
  const generation = useAppStore(s => s.performanceWorkspaceGeneration);
  useLayoutEffect(() => {
    const { view, suspendedClipKey } = store.getState();
    if (view === "arrange" && suspendedClipKey) {
      useAppStore.setState({ clipEditingKey: survivingClipKey(suspendedClipKey) });
      store.setState({ suspendedClipKey: null });
    }
    pruneViewSelections(store);
    const unsubscribe = useAppStore.subscribe((s, previous) => {
      if (s.performanceWorkspaceGeneration !== generation) return;
      const arrangementChanged = s.sequencer.clipArrangement !== previous.sequencer.clipArrangement;
      if (s.sequencer !== previous.sequencer || s.sequencerInstruments !== previous.sequencerInstruments) pruneViewSelections(store, arrangementChanged);
      if (!arrangementChanged) return;
      const key = store.getState().suspendedClipKey;
      if (key && !survivingClipKey(key)) store.setState({ suspendedClipKey: null });
      if (s.clipEditingKey && !survivingClipKey(s.clipEditingKey)) useAppStore.setState({ clipEditingKey: null });
    });
    return () => {
      unsubscribe();
      const state = useAppStore.getState();
      if (state.performanceWorkspaceGeneration === generation && store.getState().view === "arrange" && state.clipEditingKey) {
        store.setState({ suspendedClipKey: state.clipEditingKey });
        useAppStore.setState({ clipEditingKey: null });
      }
    };
  }, [generation, store]);
  const change: ViewNavigation = (next, padTarget) => {
    navigate(store, next);
    if (next === "live" && padTarget) {
      useAppStore.getState().selectSequencerEditingPad(padTarget.id, padTarget.pad);
      const layoutKey = editorKey("page", "layout", "live");
      store.setState(s => ({ entries: { ...s.entries,
        [editorKey("page", "liveDevice", "live")]: { owner: "page", value: padTarget.id },
        [layoutKey]: { owner: "page", value: { ...(s.entries[layoutKey]?.value as PerformViewLayout | undefined), dock: "editor" } }
      } }));
    }
  };
  const labels = copy[language];
  return <main className="ws-workspace">
    <nav aria-label={labels.views} className="mb-2 flex gap-1">
      {views.map(item => <button key={item} type="button" aria-pressed={item === view} onClick={() => change(item)}
        className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 aria-pressed:border-cyan-400 aria-pressed:text-cyan-200">{labels[item]}</button>)}
    </nav>
    <PerformViewContext.Provider value={view}>
      <RetainedScroll owner="page" field="viewScroll" role="region" aria-label={labels[view]}
        className="ws-view">{children(view, change)}</RetainedScroll>
    </PerformViewContext.Provider>
  </main>;
}

export type DeviceEditorRenderer = (kind: SourceKind, id: string, sequencer: SequencerState) => ReactNode;
