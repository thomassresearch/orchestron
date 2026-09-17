import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type HTMLAttributes, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { PadLoopPatternState } from "../../types";

export type EditorOwner = "page" | "rack" | "arranger" | "mixer" | `device:${string}` | `binding:${string}` | `route:${string}`;
type Entry = { owner: EditorOwner; value: unknown };
type EditorState = { entries: Record<string, Entry> };
export const createPerformanceEditorStore = () => createStore<EditorState>(() => ({ entries: {} }));
export const OpenArrangerContext = createContext<(() => void) | null>(null);
export const useOpenArranger = () => useContext(OpenArrangerContext);
const EditorContext = createContext<ReturnType<typeof createPerformanceEditorStore> | null>(null);

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
export function PerformanceEditorProvider({ owners, children }: { owners?: EditorOwner[]; children: ReactNode }) {
  const [store] = useState(createPerformanceEditorStore);
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
  const key = JSON.stringify([owner, field]);
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

export function useRetainedScroll(ref: RefObject<HTMLElement>, owner: EditorOwner, field: string) {
  const [position, setPosition] = usePerformanceEditorState(owner, field, { left: 0, top: 0 });
  // Restore once per mount, after layout. Browsers clamp offsets to the current content bounds.
  const initial = useRef(position);
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.scrollLeft = initial.current.left;
      ref.current.scrollTop = initial.current.top;
    }
  }, [ref]);
  return useCallback(() => {
    const node = ref.current;
    if (node) setPosition((previous) => previous.left === node.scrollLeft && previous.top === node.scrollTop
      ? previous : { left: node.scrollLeft, top: node.scrollTop });
  }, [ref, setPosition]);
}

export function RetainedScroll({ owner, field, ...props }: HTMLAttributes<HTMLDivElement> & { owner: EditorOwner; field: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const save = useRetainedScroll(ref, owner, field);
  return <div {...props} ref={ref} onScroll={(event) => { save(); props.onScroll?.(event); }} />;
}

/** Native details semantics, with lazy contents and retained nested expansion state. */
export function EditorDetails({ owner, field, initiallyOpen = false, summary, summaryClassName, children, ...props }:
  Omit<HTMLAttributes<HTMLDetailsElement>, "children"> & { owner: EditorOwner; field: string; initiallyOpen?: boolean; summary: ReactNode; summaryClassName?: string; children: () => ReactNode }) {
  const [open, setOpen] = usePerformanceEditorState(owner, `details:${field}`, initiallyOpen);
  return <details {...props} open={open} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}><summary className={summaryClassName}>{summary}</summary>{open ? children() : null}</details>;
}
