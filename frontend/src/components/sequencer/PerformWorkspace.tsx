import { workingSequencer } from "../../lib/clipArranger/editSession";
import type { StructureFocus } from "../../lib/clipArranger/structure";
import { useLayoutEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import type { GuiLanguage, HelpDocId, SequencerState } from "../../types";
import { HelpIconButton } from "../HelpIconButton";
import { arrangementTimings, sourceKeys } from "../../lib/clipArranger/migration";
import type { OccurrenceTarget, SourceKind } from "../../lib/clipArranger/model";
import { duplicatePattern, structureChildren } from "../../lib/clipArranger/structure";
import { useStructureDraft } from "../../lib/clipArranger/structureStore";
import { definitionAt } from "../../lib/clipArranger/operations";
import { localLoopWindows } from "../../lib/clipArranger/relationships";
import { useAppStore } from "../../store/useAppStore";
import { audioCopy } from "../../lib/audioCopy";
import { mixCopy } from "./mixCopy";
import type { PanelCollapseState } from "../CollapsiblePanel";
import { editorKey, PerformViewContext, RetainedScroll, usePerformanceEditorState, usePerformanceEditorStore, type LegacyPhraseDestination, type PerformanceEditorStore, type PerformView, type PerformViewLayout } from "./PerformanceEditorState";

function hasLegacyLane(sequencer: SequencerState, id: string) {
  return !sequencer.clipArrangement && Object.values(sourceKeys).some(key => sequencer[key].some(track =>
    track.id === id && (!("playbackMode" in track) || track.playbackMode === "arranger")));
}

const copy = {
  english: { arrange: "Arrange", live: "Live", mix: "Mix", views: "Perform views", mixPages: "Mix pages" },
  german: { arrange: "Arrangement", live: "Live", mix: "Mix", views: "Performance-Ansichten", mixPages: "Mix-Seiten" },
  french: { arrange: "Arrangement", live: "Live", mix: "Mixage", views: "Vues de performance", mixPages: "Pages de mixage" },
  spanish: { arrange: "Arreglo", live: "En vivo", mix: "Mezcla", views: "Vistas de interpretación", mixPages: "Páginas de mezcla" }
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
  if (draft.provisionalDuplicate) return duplicatePattern(useStructureDraft.getState().draft, draft.target) ? key : null;
  const lane = laneForPass(workingSequencer(sequencer), draft.target);
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
  const reveal = store.getState().legacyReveal;
  if (reveal && !hasLegacyLane(state.sequencer, reveal.laneId)) store.setState({ legacyReveal: null });
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
  for (const view of views) {
    const selection = value<string[]>("mixer", "selection", view);
    if (!selection?.length) continue;
    const remaining = selection.filter(id => id === "$master" || state.sequencerInstruments.some(row => row.id === id));
    if (remaining.length === selection.length) continue;
    clear("mixer", "selection", view, remaining);
    if (remaining.length) continue;
    const layout = value<PerformViewLayout>("page", "layout", view);
    if (view === "mix" && layout?.dock) clear("page", "layout", view, { ...layout, dock: null, dockExpanded: false });
  }
  const working = workingSequencer(state.sequencer);
  const lanes = working.clipArrangement?.lanes;
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
  if (arrangementChanged && focus && !survivingStructureFocus(working, focus)) {
    clear("arranger", "structureFocus", "arrange", null);
    clear("arranger", "structureSelection", "arrange", null);
  }
  if (Object.keys(changes).length) store.setState({ entries: { ...entries, ...changes } });
}

/** Transfer the write target before the destination editor can receive input. */
function navigate(store: PerformanceEditorStore, next: PerformView) {
  const { view, suspendedClipKey } = store.getState();
  if (view === next) return;
  // Capture the outgoing geometry before removing its rack or Inspector can clamp a scroll area.
  store.getState().captureScroll.forEach(capture => capture());
  const active = useAppStore.getState().clipEditingKey;
  const remembered = view === "arrange" ? active : suspendedClipKey;
  const destination = next === "arrange" ? survivingClipKey(remembered) : null;
  if (active !== destination) useAppStore.setState({ clipEditingKey: destination });
  store.setState({ view: next, suspendedClipKey: next === "arrange" ? null : remembered, legacyReveal: null });
}

export type MixSurface = "mixer" | "rack" | "routing";
export type MixDestination = { surface: MixSurface; bindingIds?: string[]; dock?: "instrument" | "samples" };
export type ViewNavigation = (view: PerformView, target?: { id: string; pad: number } | MixDestination | LegacyPhraseDestination) => void;

// Touch browsers can omit click for a second finger while a piano key owns the first.
function useKeyboardCompanionTap(keyboardOpen: boolean) {
  const tap = useRef<{ id: number; button: HTMLButtonElement; x: number; y: number } | null>(null);
  const handled = useRef<HTMLButtonElement | null>(null);
  const commands = "[data-perform-view], [data-mix-page], .ws-help, [data-rack-choice], [data-lane-controllers], [data-mix-detail], [data-mix-toggle], .ws-rack-links button, .ws-mix-tools button, .ws-commandbar button, .ws-project-controls button";
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      handled.current = null;
      if (!keyboardOpen || event.pointerType !== "touch" || event.isPrimary) return;
      const button = (event.target as Element).closest<HTMLButtonElement>(commands);
      if (button && !button.disabled) tap.current = { id: event.pointerId, button, x: event.clientX, y: event.clientY };
    },
    onPointerCancelCapture(event: PointerEvent<HTMLElement>) {
      if (tap.current?.id === event.pointerId) tap.current = null;
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      const start = tap.current;
      if (start?.id !== event.pointerId) return;
      tap.current = null;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12 ||
          !start.button.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
      handled.current = start.button;
      start.button.click();
    },
    onClickCapture(event: React.MouseEvent<HTMLElement>) {
      const previous = handled.current;
      if (previous && event.detail && previous.contains(event.target as Node)) {
        event.preventDefault(); event.stopPropagation();
      }
    }
  };
}

export function PerformNavigation({ view, language, navigate, onHelpRequest }: {
  view: PerformView; language: GuiLanguage; navigate: ViewNavigation; onHelpRequest?: (id: HelpDocId) => void;
}) {
  const labels = copy[language];
  const [surface] = usePerformanceEditorState<MixSurface>("mixer", "surface", "mixer");
  const surfaceLabel = (item: MixSurface) => item === "mixer" ? audioCopy(language)("mixer") : mixCopy(language)(item);
  return <>
    <nav aria-label={labels.views} className="ws-views">
      {views.map(item => <button key={item} type="button" data-perform-view={item} aria-pressed={item === view}
        onClick={() => navigate(item)}>{labels[item]}</button>)}
      {onHelpRequest && <HelpIconButton guiLanguage={language} topic={labels[view]} className="ws-help"
        onClick={() => onHelpRequest(`perform_${view}`)} />}
    </nav>
    {view === "mix" && <nav aria-label={labels.mixPages} className="ws-mix-pages">
      {(["mixer", "rack", "routing"] as const).map(item => <button key={item} type="button" data-mix-page={item}
        aria-pressed={item === surface} onClick={() => { if (item !== surface) navigate("mix", { surface: item }); }}>
        {surfaceLabel(item)}
      </button>)}
      {onHelpRequest && <HelpIconButton guiLanguage={language} topic={surfaceLabel(surface)} className="ws-help"
        onClick={() => onHelpRequest(`perform_${surface}`)} />}
    </nav>}
  </>;
}

export function PerformWorkspace({ language, children }: { language: GuiLanguage; children: (view: PerformView, navigate: ViewNavigation) => ReactNode }) {
  const store = usePerformanceEditorStore();
  const view = useStore(store, s => s.view);
  const keyboardOpen = useStore(store, s => s.keyboardOpen);
  const companionTap = useKeyboardCompanionTap(keyboardOpen);
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
      if (store.getState().legacyReveal) store.setState({ legacyReveal: null });
      const state = useAppStore.getState();
      if (state.performanceWorkspaceGeneration === generation && store.getState().view === "arrange" && state.clipEditingKey) {
        store.setState({ suspendedClipKey: state.clipEditingKey });
        useAppStore.setState({ clipEditingKey: null });
      }
    };
  }, [generation, store]);
  const change: ViewNavigation = (next, target) => {
    if (next === "arrange" && target && "item" in target) {
      const current = useAppStore.getState();
      if (current.performanceWorkspaceGeneration !== target.generation || !hasLegacyLane(current.sequencer, target.laneId)) return;
      navigate(store, next);
      const layout = editorKey("page", "layout", next), panels = editorKey("page", "collapsedPanels", next);
      const owner = `device:${target.laneId}` as const;
      store.setState(s => ({ legacyReveal: target, entries: { ...s.entries,
        [editorKey("arranger", "controlsTarget", next)]: { owner: "arranger", value: null },
        [layout]: { owner: "page", value: { ...(s.entries[layout]?.value as PerformViewLayout), dock: null, dockExpanded: false, drawerOpen: false } },
        [panels]: { owner: "page", value: { ...(s.entries[panels]?.value as Partial<PanelCollapseState>), arranger: false } },
        [editorKey("arranger", "selectedLane", next)]: { owner: "arranger", value: target.laneId },
        [editorKey(owner, "arrangerExpanded", next)]: { owner, value: true },
        [editorKey(owner, "arrangerSelection", next)]: { owner, value: [] },
        [editorKey(owner, "arrangerFocusDefinition", next)]: { owner, value: target.item }
      } }));
      return;
    }
    navigate(store, next);
    if (next === "live" && target && "pad" in target) {
      useAppStore.getState().selectSequencerEditingPad(target.id, target.pad);
      const layoutKey = editorKey("page", "layout", "live");
      store.setState(s => ({ entries: { ...s.entries,
        [editorKey("page", "liveDevice", "live")]: { owner: "page", value: target.id },
        [layoutKey]: { owner: "page", value: { ...(s.entries[layoutKey]?.value as PerformViewLayout | undefined), dock: "editor" } }
      } }));
    }
    if (next === "mix" && target && "surface" in target) {
      const layoutKey = editorKey("page", "layout", "mix");
      store.setState(s => ({ entries: { ...s.entries,
        [editorKey("mixer", "surface", "mix")]: { owner: "mixer", value: target.surface },
        ...(target.bindingIds ? { [editorKey("mixer", "selection", "mix")]: { owner: "mixer", value: target.bindingIds } } : {}),
        [layoutKey]: { owner: "page", value: { ...(s.entries[layoutKey]?.value as PerformViewLayout | undefined),
          dock: target.dock ?? null, dockExpanded: false, drawerOpen: false } }
      } }));
    }
  };
  const labels = copy[language];
  return <main className="ws-workspace" {...companionTap}>
    <PerformViewContext.Provider value={view}>
      <RetainedScroll owner="page" field="viewScroll" role="region" aria-label={labels[view]}
        className="ws-view">{children(view, change)}</RetainedScroll>
    </PerformViewContext.Provider>
  </main>;
}

export type DeviceEditorRenderer = (kind: SourceKind, id: string, sequencer: SequencerState) => ReactNode;
