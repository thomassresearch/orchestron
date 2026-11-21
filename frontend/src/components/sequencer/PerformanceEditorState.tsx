import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type HTMLAttributes, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { PadLoopPatternItem, PadLoopPatternState } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { arrangementRangeLanes } from "../../lib/arrangementRange";
import type { PatternWorkspaceDraft } from "../../lib/patternWorkspace";

export type EditorOwner = "page" | "rack" | "arranger" | "mixer" | `device:${string}` | `binding:${string}` | `route:${string}`;
type Entry = { owner: EditorOwner; value: unknown };
export type PerformView = "arrange" | "live" | "mix";
/** Geometry and disclosures belong to the view. Omitted preferences use the shell's defaults. */
export type PerformViewLayout = {
  inspectorOpen?: boolean;
  drawerOpen?: boolean;
  compactRackOpen?: boolean;
  dock?: "editor" | "instrument" | "samples" | null;
  dockExpanded?: boolean;
  preferredDockHeight?: number;
};

export const PerformViewContext = createContext<PerformView | null>(null);
export const ClipEditorTargetContext = createContext<string | null>(null);
export type LegacyPhraseDestination = { generation: number; laneId: string; item: Exclude<PadLoopPatternItem, { type: "pause" }> };
type EditorState = { captureScroll: Set<() => void>; entries: Record<string, Entry>; view: PerformView; keyboardOpen: boolean; suspendedClipKey: string | null; legacyReveal: LegacyPhraseDestination | null };
export const createPerformanceEditorStore = () => createStore<EditorState>(() => ({ captureScroll: new Set(), entries: {}, view: "arrange", keyboardOpen: false, suspendedClipKey: null, legacyReveal: null }));
export type PerformanceEditorStore = ReturnType<typeof createPerformanceEditorStore>;
export const OpenArrangerContext = createContext<((destination: LegacyPhraseDestination) => void) | null>(null);
export const useOpenArranger = () => useContext(OpenArrangerContext);
const EditorContext = createContext<ReturnType<typeof createPerformanceEditorStore> | null>(null);

export function usePerformanceEditorStore() {
  const store = useContext(EditorContext);
  if (!store) throw new Error("A Perform workspace needs an editor provider.");
  return store;
}

export function editorKey(owner: EditorOwner, field: string, view: PerformView | null) {
  return JSON.stringify(view ? [owner, field, view] : [owner, field]);
}

export function editorContainerLengths(pattern: PadLoopPatternState, prefix = ""): Record<string, number> {
  return Object.fromEntries([
    [`${prefix}root`, pattern.rootSequence.length],
    ...pattern.groups.map(group => [`${prefix}group:${group.id}`, group.sequence.length]),
    ...pattern.superGroups.map(group => [`${prefix}super:${group.id}`, group.sequence.length])
  ]);
}

/** Remove invalid positions from the store, so later insertions cannot revive stale selections. */
export function pruneEditorSelections(selections: Record<string, number[]>, lengths: Record<string, number>) {
  let changed = false;
  const next: Record<string, number[]> = {};
  for (const [key, indexes] of Object.entries(selections)) {
    const valid = indexes.filter(index => index >= 0 && index < (lengths[key] ?? 0));
    if (valid.length !== indexes.length || valid.length === 0) changed = true;
    if (valid.length) next[key] = valid.length === indexes.length ? indexes : valid;
  }
  return changed ? next : selections;
}

/** UI-only state. The provider is keyed by workspace generation, never persisted or sent to audio. */
export function PerformanceEditorProvider({ owners, children, retainedStore }: { owners?: EditorOwner[]; children: ReactNode; retainedStore?: PerformanceEditorStore }) {
  const [store] = useState(() => retainedStore ?? createPerformanceEditorStore());
  useEffect(() => useAppStore.subscribe((state, previous) => {
    if (state.arrangerHistoryRestoreRevision === previous.arrangerHistoryRestoreRevision) return;
    const before = arrangementRangeLanes(previous.sequencer);
    const after = arrangementRangeLanes(state.sequencer);
    store.setState(editor => ({ entries: Object.fromEntries(Object.entries(editor.entries).map(([key, entry]) => {
      const [owner, field] = JSON.parse(key) as [EditorOwner, string];
      if (field === "arrangerSelection") return [key, { ...entry, value: [] }];
      if (["editRange", "arrangerUngroupOrigin", "arrangerFocusDefinition"].includes(field)) return [key, { ...entry, value: null }];
      if (!owner.startsWith("device:")) return [key, entry];
      const id = owner.slice(7), pattern = after.find(l => l.id === id)?.pattern, old = before.find(l => l.id === id)?.pattern;
      if (!pattern || !old) return [key, entry];
      const exists = (kind: string, id: string) => (kind === "group" ? pattern.groups : pattern.superGroups).some(g => g.id === id);
      if (field === "workspaceDefinition") {
        const ref = entry.value as { kind: string; id: string } | null;
        return [key, ref && !exists(ref.kind, ref.id) ? { ...entry, value: null } : entry];
      }
      if (field !== "workspaceDrafts") return [key, entry];
      const expand = (item: PadLoopPatternItem): PadLoopPatternItem[] => {
        if (item.type === "group" && !exists("group", item.groupId)) return structuredClone(old.groups.find(g => g.id === item.groupId)?.sequence ?? []);
        if (item.type === "super" && !exists("super", item.superGroupId)) return (old.superGroups.find(g => g.id === item.superGroupId)?.sequence ?? []).flatMap(expand);
        return [item];
      };
      const drafts = entry.value as Record<string, PatternWorkspaceDraft>;
      return [key, { ...entry, value: Object.fromEntries(Object.entries(drafts).filter(([name]) => {
        const [kind, id] = name.split(":"); return !["group", "super"].includes(kind) || exists(kind, id);
      }).map(([name, draft]) => [name, { ...draft, items: draft.items.flatMap(expand), selection: [] }])) }];
    })) }));
  }), [store]);
  const ownerSignature = JSON.stringify(owners);
  useEffect(() => {
    if (!ownerSignature) return;
    const valid = new Set<EditorOwner>(JSON.parse(ownerSignature));
    const entries = store.getState().entries;
    const deviceIds = [...valid].filter(owner => owner.startsWith("device:")).map(owner => owner.slice(7));
    let changed = false;
    const retained: EditorState["entries"] = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (!valid.has(entry.owner)) { changed = true; continue; }
      const [, field] = JSON.parse(key) as [EditorOwner, string];
      const deviceMap = ["stepSelectPreview", "arpeggiatorPresetDrafts", "openContainerByTrack", "selectionByContainer"].includes(field);
      if (deviceMap) {
        const values = entry.value as Record<string, unknown>;
        const next = Object.fromEntries(Object.entries(values).filter(([id]) => deviceIds.some(device => id === device || id.startsWith(`${device}:`))));
        if (Object.keys(next).length !== Object.keys(values).length) {
          retained[key] = { ...entry, value: next }; changed = true; continue;
        }
      }
      retained[key] = entry;
    }
    if (changed) store.setState({ entries: retained });
  }, [store, ownerSignature]);
  return <EditorContext.Provider value={store}>{children}</EditorContext.Provider>;
}

export function EditorScope({ children }: { children: ReactNode }) {
  const store = useContext(EditorContext);
  return store ? children : <PerformanceEditorProvider>{children}</PerformanceEditorProvider>;
}

export function usePerformanceEditorState<T>(owner: EditorOwner, field: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(EditorContext);
  // Standalone editors (including Instrument Design consumers) retain their existing local lifetime.
  const [store] = useState(() => context ?? createPerformanceEditorStore());
  const [fallback] = useState(initial);
  const view = useContext(PerformViewContext);
  const target = useContext(ClipEditorTargetContext);
  const key = target ? JSON.stringify([owner, field, view, target]) : editorKey(owner, field, view);
  const value = useStore(store, (state) => key in state.entries ? state.entries[key].value as T : fallback);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    store.setState((state) => {
      const previous = key in state.entries ? state.entries[key].value as T : fallback;
      const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
      return Object.is(next, previous) ? state : { entries: { ...state.entries, [key]: { owner, value: next } } };
    });
  }, [store, key, owner, fallback]);
  return [value, setValue];
}

/** Preserve step properties per preview target while keeping the standard editor's local lifetime. */
export function useStepProperties<T>(owner: EditorOwner, field: string) {
  const view = useContext(PerformViewContext);
  const local = useState<T | null>(null);
  const retained = usePerformanceEditorState<T | null>(owner, field, null);
  return view ? retained : local;
}

/** Clear occurrence highlights without changing any editor's expansion or insertion position. */
export function useClearArrangementSelection() {
  const store = useContext(EditorContext);
  const view = useContext(PerformViewContext);
  return () => store?.setState(state => ({ entries: Object.fromEntries(Object.entries(state.entries).map(([key, entry]) => {
    const [, field, scope] = JSON.parse(key);
    if (view === "arrange" && scope === view && field === "arrangerFocusDefinition") return [key, { ...entry, value: null }];
    return field === "arrangerSelection" && (scope ?? null) === view ? [key, { ...entry, value: [] }] : [key, entry];
  })) }));
}

/** Keep a lane's existing Position field in sync with clicks handled by the range surface. */
export function useSetArrangementPosition() {
  const store = useContext(EditorContext);
  const view = useContext(PerformViewContext);
  return (id: string, value: number) => {
    const owner: EditorOwner = `device:${id}`;
    const key = editorKey(owner, "arrangerPosition", view);
    store?.setState(state => ({ entries: { ...state.entries, [key]: { owner, value } } }));
  };
}

export function useRetainedScroll(ref: RefObject<HTMLElement>, owner: EditorOwner, field: string) {
  const store = useContext(EditorContext), view = useContext(PerformViewContext);
  const [position, setPosition] = usePerformanceEditorState(owner, field, { left: 0, top: 0 });
  const latest = useRef(position);
  latest.current = position;
  const save = useCallback((node: HTMLElement) => {
    // Hidden panes can dispatch a final scroll event with both axes at zero.
    if (!node.clientWidth && !node.clientHeight && !node.scrollLeft && !node.scrollTop) return;
    const left = node.scrollLeft, top = node.scrollTop;
    setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
  }, [setPosition]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { left, top } = latest.current;
    const restore = () => { node.scrollLeft = left; node.scrollTop = top; };
    restore();
    let observer: ResizeObserver | undefined;
    // A mounted display:none pane may reject both assignments until its first layout.
    if (!node.clientWidth && !node.clientHeight && (node.scrollLeft !== left || node.scrollTop !== top) && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (!node.clientWidth && !node.clientHeight) return;
        restore();
        observer?.disconnect();
      });
      observer.observe(node);
    }
    const capture = () => save(node);
    const captures = view ? store?.getState().captureScroll : undefined;
    captures?.add(capture);
    return () => {
      observer?.disconnect();
      captures?.delete(capture);
      if (!view || !store || store.getState().view === view) capture();
    };
  }, [ref, save, store, view]);
  return useCallback(() => { if (ref.current) save(ref.current); }, [ref, save]);
}

export function RetainedScroll({ owner, field, as: Element = "div", ...props }: HTMLAttributes<HTMLDivElement> & { owner: EditorOwner; field: string; as?: "article" | "div" }) {
  const ref = useRef<HTMLDivElement>(null);
  const save = useRetainedScroll(ref, owner, field);
  return <Element {...props} ref={ref} onScroll={(event) => { save(); props.onScroll?.(event); }} />;
}

/** Native details semantics, with lazy contents and retained nested expansion state. */
export function EditorDetails({ owner, field, initiallyOpen = false, summary, summaryClassName, children, ...props }:
  Omit<HTMLAttributes<HTMLDetailsElement>, "children"> & { owner: EditorOwner; field: string; initiallyOpen?: boolean; summary: ReactNode; summaryClassName?: string; children: () => ReactNode }) {
  const [open, setOpen] = usePerformanceEditorState(owner, `details:${field}`, initiallyOpen);
  return <details {...props} open={open} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}><summary className={summaryClassName}>{summary}</summary>{open ? children() : null}</details>;
}
