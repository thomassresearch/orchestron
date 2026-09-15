import { useCallback, useEffect, useRef } from "react";
import { normalizeControllerTargetChannels } from "../lib/midiControllerChannels";
import { useAppStore } from "../store/useAppStore";
import type { MidiControllerState, SessionMidiEventRequest } from "../types";

export function useMidiControllerRouting({ activeSessionId, activeSessionState, sendDirectMidiEvent, setSequencerError, errors }: {
  activeSessionId: string | null;
  activeSessionState: string;
  sendDirectMidiEvent: (event: SessionMidiEventRequest, sessionId?: string) => Promise<void>;
  setSequencerError: (error: string | null) => void;
  errors: { failedToSendMidiControllerValue: string; failedToInitializeMidiControllers: string };
}) {
  const initializedSession = useRef<string | null>(null);
  const sendValue = useCallback(async (controller: MidiControllerState, sessionId: string) => {
    await Promise.all(normalizeControllerTargetChannels(controller.targetChannels).map(channel =>
      sendDirectMidiEvent({ type: "control_change", channel, controller: controller.controllerNumber, value: controller.value }, sessionId)
    ));
  }, [sendDirectMidiEvent]);

  const sendCurrentValue = useCallback((id: string) => {
    const controller = useAppStore.getState().sequencer.midiControllers.find(entry => entry.id === id);
    if (!controller?.enabled || activeSessionState !== "running" || !activeSessionId) return;
    void sendValue(controller, activeSessionId).catch(error => {
      setSequencerError(error instanceof Error ? error.message : errors.failedToSendMidiControllerValue);
    });
  }, [activeSessionId, activeSessionState, errors.failedToSendMidiControllerValue, sendValue, setSequencerError]);

  const onMidiControllerEnabledChange = useCallback((id: string, enabled: boolean) => {
    useAppStore.getState().setMidiControllerEnabled(id, enabled);
    sendCurrentValue(id);
  }, [sendCurrentValue]);
  const onMidiControllerNumberChange = useCallback((id: string, number: number) => {
    useAppStore.getState().setMidiControllerNumber(id, number);
    sendCurrentValue(id);
  }, [sendCurrentValue]);
  const onMidiControllerValueChange = useCallback((id: string, value: number) => {
    useAppStore.getState().setMidiControllerValue(id, value);
    sendCurrentValue(id);
  }, [sendCurrentValue]);
  const onMidiControllerTargetChannelsChange = useCallback((id: string, channels: number[]) => {
    if (channels.length === 0) return;
    useAppStore.getState().setMidiControllerTargetChannels(id, channels);
    sendCurrentValue(id);
  }, [sendCurrentValue]);

  useEffect(() => {
    if (activeSessionState !== "running" || !activeSessionId) {
      initializedSession.current = null;
      return;
    }
    if (initializedSession.current === activeSessionId) return;
    initializedSession.current = activeSessionId;
    const controllers = useAppStore.getState().sequencer.midiControllers.filter(controller => controller.enabled);
    void Promise.all(controllers.map(controller => sendValue(controller, activeSessionId))).catch(error => {
      setSequencerError(error instanceof Error ? error.message : errors.failedToInitializeMidiControllers);
    });
  }, [activeSessionId, activeSessionState, errors.failedToInitializeMidiControllers, sendValue, setSequencerError]);

  return { onMidiControllerEnabledChange, onMidiControllerNumberChange, onMidiControllerValueChange, onMidiControllerTargetChannelsChange };
}
