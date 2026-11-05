import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { PreviewScoreNote } from "../components/sequencer/ScoreTransportContext";
import { scoreCopy } from "../components/sequencer/scoreCopy";
import type { BrowserClockAudioClient } from "../lib/browserClockAudio";
import { useAppStore } from "../store/useAppStore";
import { api } from "../api/client";

type Voice = {
  holders: Set<() => void>;
  generation: number;
  session: string | null;
  end: () => void;
};

/** Manual MIDI only: starting the engine never starts a score or the arranger. */
export function useScoreKeyboardPreview(
  client: MutableRefObject<Pick<BrowserClockAudioClient, "prime" | "sendManualMidi">>,
  setError: (error: string | null) => void
): PreviewScoreNote {
  const voices = useRef(new Map<string, Voice>());
  const deliveries = useRef(new Map<string, Promise<void>>());
  const reportError = useRef(setError);
  reportError.current = setError;

  useEffect(() => {
    const held = voices.current;
    const unsubscribe = useAppStore.subscribe(state => {
      for (const voice of held.values()) {
        if (voice.generation !== state.performanceWorkspaceGeneration ||
            voice.session && (voice.session !== state.activeSessionId || state.activeSessionState !== "running")) {
          for (const release of [...voice.holders]) release();
        }
      }
    });
    return () => {
      unsubscribe();
      for (const voice of held.values()) for (const release of [...voice.holders]) release();
    };
  }, []);

  return useCallback<PreviewScoreNote>((note, onRelease) => {
    const source = `score-keyboard:${note.trackId}`;
    const key = `${source}:${note.midiChannel}:${note.pitch}`;
    const existing = voices.current.get(key);
    const state = useAppStore.getState();
    let end!: () => void;
    const released = new Promise<void>(resolve => { end = resolve; });
    const voice: Voice = existing ?? {
      holders: new Set(), generation: state.performanceWorkspaceGeneration,
      session: state.activeSessionState === "running" ? state.activeSessionId : null, end
    };
    const release = () => {
      if (!voice.holders.delete(release)) return;
      onRelease();
      if (!voice.holders.size) {
        if (voices.current.get(key) === voice) voices.current.delete(key);
        voice.end();
      }
    };
    voice.holders.add(release);
    if (existing) return release;
    voices.current.set(key, voice);
    reportError.current(null);
    // Call prime synchronously inside the browser's user-activation gesture.
    const primed = client.current.prime();
    // Observe a priming failure immediately even while a previous release is pending.
    void primed.catch(() => undefined);
    const previous = deliveries.current.get(key);
    const delivery = (async () => {
      try {
        await primed;
        await previous;
        if (!voice.holders.size) return;
        if (useAppStore.getState().activeSessionState !== "running") await useAppStore.getState().startSession();
        if (!voice.holders.size) return;
        const current = useAppStore.getState();
        if (current.activeSessionState !== "running" || !current.activeSessionId) {
          throw new Error(current.error ?? scoreCopy(current.guiLanguage).previewError);
        }
        voice.session = current.activeSessionId;
        const midi = { channel: note.midiChannel, note: note.pitch, source_id: source };
        try {
          await client.current.sendManualMidi(voice.session, {
            ...midi, type: "note_on", velocity: 100,
            source_scale_root: note.scaleRoot, source_scale_type: note.scaleType, source_mode: note.mode
          }, { source });
          await released;
        } finally {
          // Pair releases with the original session, after any in-flight note-on.
          const off = { ...midi, type: "note_off" as const };
          const current = useAppStore.getState();
          if (current.activeSessionId === voice.session && current.activeSessionState === "running") {
            await client.current.sendManualMidi(voice.session, off, { source }).catch(() => undefined);
          } else {
            // Releasing an old session must not reconnect the browser audio client to it.
            await api.sendSessionMidiEvent(voice.session, off).catch(() => undefined);
          }
        }
      } catch (error) {
        if (voice.holders.size) reportError.current(error instanceof Error ? error.message : scoreCopy(useAppStore.getState().guiLanguage).previewError);
      } finally {
        for (const stop of [...voice.holders]) stop();
      }
    })();
    deliveries.current.set(key, delivery);
    void delivery.then(() => { if (deliveries.current.get(key) === delivery) deliveries.current.delete(key); });
    return release;
  }, [client]);
}
