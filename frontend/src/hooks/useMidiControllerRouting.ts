import { useCallback, useEffect, useRef } from "react";
import { normalizeControllerTargetChannels } from "../lib/midiControllerChannels";
import { useAppStore } from "../store/useAppStore";
import type { ManualMidiActivity, MidiControllerState, SessionMidiEventRequest } from "../types";
import type { LiveInputAction } from "../audio/browserPlaybackPolicy";

export function useMidiControllerRouting({ activeSessionId, activeSessionState, sendDirectMidiEvent, setLiveInput, setSequencerError, errors }: {
  activeSessionId: string | null;
  activeSessionState: string;
  sendDirectMidiEvent: (event: SessionMidiEventRequest, sessionId?: string, activity?: ManualMidiActivity) => Promise<void>;
  setLiveInput?: (source: string, action: LiveInputAction) => void;
  setSequencerError: (error: string | null) => void;
  errors: { failedToSendMidiControllerValue: string; failedToInitializeMidiControllers: string };
}) {
  const initializedSession = useRef<string | null>(null);
  const sendValue = useCallback(async (controller: MidiControllerState, sessionId: string, activity = true) => {
    await Promise.all(normalizeControllerTargetChannels(controller.targetChannels).map(channel =>
      sendDirectMidiEvent({ type: "control_change", channel, controller: controller.controllerNumber, value: controller.value }, sessionId,
        { source: `controller:${controller.id}`, activity })
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
    setLiveInput?.(`controller:${id}`, enabled ? "start" : "stop");
    useAppStore.getState().setMidiControllerEnabled(id, enabled);
    sendCurrentValue(id);
  }, [sendCurrentValue, setLiveInput]);
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
    void Promise.all(controllers.map(controller => sendValue(controller, activeSessionId, false))).catch(error => {
      setSequencerError(error instanceof Error ? error.message : errors.failedToInitializeMidiControllers);
    });
  }, [activeSessionId, activeSessionState, errors.failedToInitializeMidiControllers, sendValue, setSequencerError]);

  const onMidiControllerGestureChange = useCallback((id: string, active: boolean) => {
    if (activeSessionState === "running" && useAppStore.getState().sequencer.midiControllers.some(c => c.id === id && c.enabled)) {
      setLiveInput?.(`controller:${id}`, active ? "gesture_start" : "gesture_end");
    }
  }, [activeSessionState, setLiveInput]);

  return { onMidiControllerEnabledChange, onMidiControllerNumberChange, onMidiControllerValueChange, onMidiControllerTargetChannelsChange, onMidiControllerGestureChange };
}
