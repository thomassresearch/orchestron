import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { GeneratedPattern } from "../../lib/markovPattern";
import { usePerformanceAudition } from "./PerformanceAudition";
import type { DefinitionDraft } from "../../lib/clipArranger/model";

type Session = {
  gesture: string;
  before: DefinitionDraft | null;
  sending: boolean;
  latest: GeneratedPattern | null;
};

export function useMarkovAudition(
  id: string,
  draftKey: string | null,
  pad: number,
  report: (message: string) => void,
) {
  const audition = usePerformanceAudition();
  const ref = useRef<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  const [prepared, setPrepared] = useState<GeneratedPattern | null>(null);
  const generation = useAppStore.getState().performanceWorkspaceGeneration;

  async function send(pattern: GeneratedPattern) {
    if (!audition) return;
    const state = useAppStore.getState(),
      draft = draftKey ? state.clipDrafts[draftKey] : null;
    let session = ref.current;
    if (!session) {
      session = { gesture: crypto.randomUUID(), sending: false, latest: null, before: state.clipAuditionDraft };
      ref.current = session;
      if (!draftKey) state.selectSequencerEditingPad(id, pad);
    }
    setPrepared(null);
    if (session.sending) {
      session.latest = pattern;
      return;
    }
    session.sending = true;
    let snapshot: DefinitionDraft | undefined;
    if (draft && draft.definition.kind === "pattern") {
      snapshot = { ...draft, definition: { ...draft.definition, ...pattern } };
      useAppStore.setState({ clipAuditionDraft: snapshot });
    } else useAppStore.setState({ padAudition: { deviceId: id, pattern } });
    setPlaying(true);
    try {
      await audition(id, {
        action: "workspace_start",
        gestureId: session.gesture,
        clipDraft: snapshot,
        padPreview: !snapshot,
        temporary: true,
      });
      if (ref.current !== session) return;
      session.sending = false;
      const next = session.latest;
      session.latest = null;
      if (next) await send(next);
      else setPrepared(pattern);
    } catch (error) {
      if (ref.current === session) {
        report(String(error));
        await stop();
      }
    }
  }
  async function stop(restore = true) {
    const session = ref.current;
    if (!session) return;
    ref.current = null;
    setPrepared(null);
    setPlaying(false);
    const state = useAppStore.getState();
    if (generation !== state.performanceWorkspaceGeneration) return;
    const prior = session.before;
    const canRestore = restore && (!draftKey || state.clipEditingKey === draftKey);
    const before = canRestore && prior && draftKey ? (state.clipDrafts[draftKey] ?? prior) : prior;
    useAppStore.setState({
      padAudition: null,
      ...(draftKey ? { clipAuditionDraft: canRestore ? before : null } : {}),
    });
    try {
      await audition?.(id, { action: "workspace_end", gestureId: session.gesture, resumePrevious: canRestore });
    } catch (error) {
      report(String(error));
    }
  }
  const cleanup = useRef(stop);
  cleanup.current = stop;
  useEffect(
    () => () => {
      void cleanup.current(false);
    },
    [],
  );
  return { send, stop, playing, prepared, available: !!audition, gesture: ref.current?.gesture };
}
