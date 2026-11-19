import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { BrowserClockAudioClient } from "../lib/browserClockAudio";
import { sampleManifest } from "../lib/samplePlayer";
import { normalizeSessionInstrumentAssignments } from "../store/appStoreModel";
import { useAppStore } from "../store/useAppStore";
import type { MixerState, SequencerInstrumentBinding } from "../types";

type Preview = {
  assignment: string; note: number; gesture: string; session?: string;
  client?: BrowserClockAudioClient; sent: boolean; canceled: boolean;
  work: Promise<void>; timer?: ReturnType<typeof setTimeout>; stopMixer?: () => void;
};

// A stopped-engine preview owns its audio client. Mirror mixer edits to that
// session while the sample plays, including edits made during compilation.
function followPreviewMixer(client: BrowserClockAudioClient, initial: MixerState, onError: (error: unknown) => void) {
  let last = initial, pending: ReturnType<typeof setTimeout> | undefined;
  let sending = false, closed = false;
  function schedule() {
    if (!closed && !sending && !pending && useAppStore.getState().mixer !== last) {
      pending = setTimeout(() => { pending = undefined; void sync(); }, 34);
    }
  }
  async function sync() {
    const mixer = useAppStore.getState().mixer;
    if (closed || sending || mixer === last) return;
    sending = true;
    last = mixer;
    try { await client.sendMixer(mixer); }
    catch (error) { if (!closed) onError(error); }
    finally { sending = false; schedule(); }
  }
  const unsubscribe = useAppStore.subscribe((s, previous) => { if (s.mixer !== previous.mixer) schedule(); });
  return { sync, stop() { closed = true; clearTimeout(pending); unsubscribe(); } };
}

export function useSamplePreview(binding: SequencerInstrumentBinding, onError: (error: unknown) => void) {
  const [playing, setPlaying] = useState(false);
  const current = useRef<Preview | null>(null);
  const mounted = useRef(false);
  const report = useRef(onError);
  report.current = onError;

  async function cleanup(run: Preview) {
    try {
      if (run.session && run.sent) await api.previewSample(run.session, run.assignment, {
        action: "stop", note: run.note, gesture: run.gesture
      });
    } finally {
      if (run.client) {
        try { await run.client.disconnect(); }
        finally { if (run.session) await api.deleteSession(run.session); }
      }
    }
  }

  async function stop() {
    const run = current.current;
    if (!run || run.canceled) return;
    run.canceled = true;
    clearTimeout(run.timer);
    run.stopMixer?.();
    if (mounted.current) setPlaying(false);
    await run.work;
    try { await cleanup(run); }
    catch (error) { if (mounted.current) report.current(error); }
    finally { if (current.current === run) current.current = null; }
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void stopRef.current(); };
  }, []);

  // A temporary audition is private. Opening the actual performance engine
  // supersedes it, and a stopped/replaced live engine invalidates its gesture.
  useEffect(() => useAppStore.subscribe((state, previous) => {
    const run = current.current;
    if (!run) return;
    if (state.performanceWorkspaceGeneration !== previous.performanceWorkspaceGeneration ||
        state.activeSessionState !== previous.activeSessionState ||
        state.activeSessionId !== previous.activeSessionId) void stopRef.current();
  }), []);

  function start(note: number, seconds: number) {
    if (current.current) return;
    const state = useAppStore.getState();
    const run: Preview = { assignment: binding.id, note, gesture: crypto.randomUUID(),
      work: Promise.resolve(), sent: false, canceled: false };
    current.current = run;
    setPlaying(true);

    let prime: Promise<unknown> = Promise.resolve();
    if (state.activeSessionState === "running" && state.activeSessionId) {
      run.session = state.activeSessionId;
    } else {
      run.client = new BrowserClockAudioClient({
        onStatusChange: () => undefined,
        onErrorChange: message => {
          if (message && current.current === run && !run.canceled) {
            if (mounted.current) report.current(message);
            void stopRef.current();
          }
        },
        onSequencerStatus: () => undefined,
        getLatencySettings: () => useAppStore.getState().browserClockLatencySettings
      });
      // AudioContext creation needs the click's user activation.
      prime = run.client.prime();
    }
    run.work = (async () => {
      try {
        await prime;
        if (run.canceled) return;
        if (run.client) {
          await state.flushMixer();
          await state.flushPerformanceControllers();
          if (run.canceled) return;
          const rack = useAppStore.getState();
          const session = await api.createSession(normalizeSessionInstrumentAssignments(rack.sequencerInstruments),
            rack.audioGraph, rack.mixer, undefined, sampleManifest(rack.sequencerInstruments));
          run.session = session.session_id;
          if (run.canceled) return;
          await api.startSession(run.session);
          if (run.canceled) return;
          await run.client.connect(run.session);
          if (run.canceled) return;
          const mixer = followPreviewMixer(run.client, rack.mixer, error => report.current(error));
          run.stopMixer = mixer.stop;
          await mixer.sync();
        }
        if (!run.session || run.canceled) return;
        await api.previewSample(run.session, run.assignment, { action: "start", note, gesture: run.gesture });
        run.sent = true;
        if (!run.canceled) run.timer = setTimeout(() => void stopRef.current(), seconds * 1000 + 2000);
      } catch (error) {
        if (!run.canceled && mounted.current) report.current(error);
        // Don't await a stop that would wait on this work promise.
        queueMicrotask(() => void stopRef.current());
      }
    })();
  }
  return { playing, start, stop };
}
