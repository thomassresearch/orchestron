import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Fm6Audition, type Fm6PreviewValues } from "../lib/fm6Audition";
import { BrowserClockAudioClient } from "../lib/browserClockAudio";
import { auditionSignature, isolatedAudition } from "../lib/instrumentAudition";
import { normalizeControllerValue, performanceControllersForGraph } from "../lib/performanceControllers";
import { useAppStore } from "../store/useAppStore";
import type { EditablePatch } from "../store/appStoreTypes";
import type { PerformanceControllerDefinition, SequencerRuntimeState } from "../types";

type Phase = "off" | "preparing" | "running" | "stopping";
type Run = {
  client: BrowserClockAudioClient; cancelled: boolean; id?: string; connected: boolean;
  startup: Promise<void>; cleanup?: Promise<void>; midiWork: Promise<void>; controlWork?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>; pendingValues?: Record<string, number>;
  fm6?: Fm6Audition; signature?: string;
  midi: number[]; notes: Map<number, { count: number; release: () => void }>;
  original?: { runtime: SequencerRuntimeState; generation: number; session: string | null };
};

export function useInstrumentAudition(draft: EditablePatch, stopPerformance: () => Promise<void>, messages: { mapping: string; stale: string; stopFailed: string }) {
  const [phase, setPhase] = useState<Phase>("off");
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [snapshot, setSnapshot] = useState<{ signature: string; fm6?: Fm6PreviewValues; definitions: PerformanceControllerDefinition[]; midi: number[]; alwaysOn: boolean } | null>(null);
  const overrides = useRef<Record<string, number>>({});
  const active = useRef<Run | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ draft, stopPerformance, messages });
  latest.current = { draft, stopPerformance, messages };
  const report = (e: unknown) => { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); };

  async function cleanup(run: Run) {
    if (run.cleanup) return run.cleanup;
    run.cleanup = (async () => {
      clearTimeout(run.timer);
      run.pendingValues = undefined;
      for (const voice of run.notes.values()) voice.release();
      run.notes.clear();
      try {
        await run.midiWork;
        await run.fm6?.flush().catch(() => undefined);
        await run.controlWork?.catch(() => undefined);
      } finally {
        try { await run.client.disconnect(); }
        finally {
          try {
            if (run.id) { try { await api.stopSession(run.id); } finally { await api.deleteSession(run.id); } }
          } finally {
            const state = useAppStore.getState();
            if (run.original && state.performanceWorkspaceGeneration === run.original.generation &&
                state.activeSessionId === run.original.session && state.activeSessionState !== "running") {
              // Audition never edits authored sequencer content. Only restore its transport snapshot.
              useAppStore.setState({ sequencer: { ...state.sequencer, isPlaying: false },
                sequencerRuntime: { ...run.original.runtime, isPlaying: false } });
            }
          }
        }
      }
    })();
    return run.cleanup;
  }

  async function stop() {
    const run = active.current;
    if (!run) return;
    run.cancelled = true;
    if (mounted.current) setPhase("stopping");
    await run.startup;
    try { await cleanup(run); } catch (e) { report(e); }
    finally {
      if (active.current === run) {
        active.current = null;
        if (mounted.current) { setPhase("off"); setSnapshot(null); }
      }
    }
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void stopRef.current(); };
  }, []);

  function start() {
    if (active.current) return;
    const current = latest.current;
    const definitions = performanceControllersForGraph(current.draft.graph);
    const reconciled = Object.fromEntries(definitions.filter(d => !d.error && overrides.current[d.node_id] !== undefined)
      .map(d => [d.node_id, normalizeControllerValue(overrides.current[d.node_id], d)]));
    overrides.current = reconciled; setValues(reconciled); setError(null); setPhase("preparing");
    const run: Run = {
      client: new BrowserClockAudioClient({ onStatusChange: () => undefined,
        onErrorChange: message => {
          if (message && active.current === run && !run.cancelled) { report(message); void stopRef.current(); }
        }, onSequencerStatus: () => undefined,
        getLatencySettings: () => useAppStore.getState().browserClockLatencySettings }),
      cancelled: false, connected: false, startup: Promise.resolve(), midiWork: Promise.resolve(), midi: [], notes: new Map()
    };
    active.current = run;
    // Prime synchronously in the click gesture, before compilation awaits lose user activation.
    const primed = run.client.prime();
    void primed.catch(() => undefined);
    run.startup = (async () => {
      try {
        const built = isolatedAudition(current.draft, reconciled, current.messages.mapping);
        run.midi = built.midi;
        await primed;
        if (run.cancelled) return;
        const response = await api.createPreview({ ...built.payload, session: { ...built.payload.session, engine_config: useAppStore.getState().engineConfig } });
        run.id = response.session_id;
        if (run.cancelled) return;
        const compiled = await api.compileSession(run.id);
        if (run.cancelled) return;
        const fm6 = (compiled.manifest?.fm6Preview as Record<string, Fm6PreviewValues> | undefined)?.preview;
        const signature = auditionSignature(current.draft, fm6);
        if (signature !== auditionSignature(latest.current.draft, fm6)) throw new Error(current.messages.stale);
        const state = useAppStore.getState();
        const original = { runtime: structuredClone(state.sequencerRuntime), generation: state.performanceWorkspaceGeneration, session: state.activeSessionId };
        await current.stopPerformance();
        if (useAppStore.getState().activeSessionState === "running" || useAppStore.getState().activeSessionState === "error") throw new Error(current.messages.stopFailed);
        run.original = original;
        if (run.cancelled) return;
        await api.startSession(run.id);
        if (run.cancelled) return;
        await run.client.connect(run.id);
        if (run.cancelled) return;
        run.connected = true;
        const controllers = compiled.manifest?.performanceControllers as Record<string, Record<string, PerformanceControllerDefinition>> | undefined;
        if (fm6) {
          run.fm6 = new Fm6Audition(run.id, fm6);
          run.signature = signature;
        }
        setSnapshot({ signature, fm6, midi: run.midi, alwaysOn: current.draft.always_on,
          definitions: definitions.map(d => ({ ...d, update_mode: controllers?.preview?.[d.node_id]?.update_mode })) });
        setPhase("running");
      } catch (e) {
        if (!run.cancelled) report(e);
        run.cancelled = true;
      } finally {
        if (run.cancelled) {
          try { await cleanup(run); } catch (e) { report(e); }
          if (active.current === run) {
            active.current = null;
            if (mounted.current) { setPhase("off"); setSnapshot(null); }
          }
        }
      }
    })();
  }

  async function flush(run: Run): Promise<void> {
    clearTimeout(run.timer);
    if (run.controlWork) { await run.controlWork; return flush(run); }
    if (!run.pendingValues || run.cancelled || !run.id) return;
    const next = run.pendingValues;
    run.pendingValues = undefined;
    run.controlWork = api.updatePerformanceControllers(run.id, "preview", next).then(() => undefined);
    try { await run.controlWork; }
    catch (e) { run.pendingValues ??= next; report(e); throw e; }
    finally { run.controlWork = undefined; }
    if (run.pendingValues) await flush(run);
  }

  function changeValue(definition: PerformanceControllerDefinition, value: number) {
    const run = active.current;
    if (!run || run.cancelled || !run.connected || definition.error) return;
    overrides.current = { ...overrides.current, [definition.node_id]: normalizeControllerValue(value, definition) };
    setValues(overrides.current);
    run.pendingValues = { ...overrides.current };
    clearTimeout(run.timer);
    run.timer = setTimeout(() => { void flush(run).catch(() => undefined); }, 40);
  }

  function pressNote(note: number): () => void {
    const run = active.current;
    if (!run?.connected || run.cancelled || !run.id || !run.midi.length) return () => undefined;
    let voice = run.notes.get(note);
    if (!voice) {
      const id = run.id;
      const midi = (type: "note_on" | "note_off") => {
        run.midiWork = run.midiWork.then(async () => {
          if (type === "note_on") {
            const draft = latest.current.draft;
            if (run.fm6 && run.signature === auditionSignature(draft, run.fm6.initial)) run.fm6.read(draft.graph);
            await Promise.all([flush(run), run.fm6?.flush()]);
            if (run.cancelled) return;
          }
          for (const channel of run.midi) await run.client.sendManualMidi(id,
            { type, channel, note, ...(type === "note_on" ? { velocity: 96 } : {}), source_id: "instrument-audition" },
            { source: "instrument-audition" });
        }).catch(report);
      };
      voice = { count: 0, release: () => midi("note_off") };
      run.notes.set(note, voice);
      midi("note_on");
    }
    voice.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--voice.count === 0 && run.notes.get(note) === voice) { run.notes.delete(note); voice.release(); }
    };
  }

  const stale = !!snapshot && snapshot.signature !== auditionSignature(draft, snapshot.fm6);
  useEffect(() => {
    const run = active.current;
    if (!run?.fm6 || !run.connected || run.cancelled || stale) return;
    run.fm6.read(draft.graph);
    void run.fm6.flush().catch(reason => { if (active.current === run && !run.cancelled) report(reason); });
  }, [draft.graph, snapshot, stale]);

  return { phase, error, values, snapshot, stale,
    toggle: () => { if (active.current) void stop(); else start(); }, changeValue, pressNote };
}
