import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";

import { api, wsBaseUrl } from "../api/client";
import {
  absoluteTransportStep as sequencerAbsoluteTransportStep,
  arrangerPlaybackBounds,
  clampArrangerSeekStep
} from "../lib/arrangerTransport";
import { sequencerTransportStepsPerBeat } from "../lib/sequencer";
import {
  aggregateDrummerRuntimeTrackLocalSteps,
  aggregateDrummerRuntimeTrackStatuses,
  type BrowserClockQueuedTransportEvent,
  isSessionNotFoundApiError,
  parseDrummerRowRuntimeTrackId,
  parseSequencerPadSwitchEventPayload,
  parseSequencerStepEventPayload,
  shouldLogSessionEvent,
  type SequencerPadSwitchEventPayload,
  type SequencerStepEventPayload
} from "../lib/sequencerRuntime";
import { useAppStore } from "../store/useAppStore";
import type {
  BrowserClockLatencySettings,
  DrummerSequencerTrackState,
  SessionAudioOutputMode,
  SessionEvent,
  SessionMidiEventRequest,
  SessionSequencerConfigRequest,
  SessionSequencerStartRequest,
  SessionSequencerStatus,
  SessionState,
  SequencerRuntimeState,
  SequencerState
} from "../types";

import { useBrowserClockAudioController } from "./useBrowserClockAudioController";

type AppStoreState = ReturnType<typeof useAppStore.getState>;

type SequencerRuntimeControllerErrors = {
  noActiveRuntimeSession: string;
  startInstrumentsFirstForSequencer: string;
  noActiveInstrumentSessionForSequencer: string;
  failedToStartSequencer: string;
  failedToSyncSequencerStatus: string;
  failedToUpdateSequencerConfig: string;
  sessionNotRunningSequencerStopped: string;
};

interface UseSequencerRuntimeControllerParams {
  activeSessionId: string | null;
  activeSessionState: SessionState;
  browserClockLatencySettings: BrowserClockLatencySettings;
  buildBackendSequencerConfig: (
    state?: SequencerState,
    mode?: "runtime" | "export"
  ) => SessionSequencerConfigRequest;
  disableAllPianoRolls: () => void;
  errors: SequencerRuntimeControllerErrors;
  events: SessionEvent[];
  pushEvent: AppStoreState["pushEvent"];
  sequencer: SequencerState;
  sequencerConfig: SequencerState;
  sequencerRuntime: SequencerRuntimeState;
  setBrowserClockLatencySettings: AppStoreState["setBrowserClockLatencySettings"];
  setSequencerError: (error: string | null) => void;
  setSequencerPlayhead: AppStoreState["setSequencerPlayhead"];
  setSequencerTransportAbsoluteStep: AppStoreState["setSequencerTransportAbsoluteStep"];
  syncControllerSequencerRuntime: AppStoreState["syncControllerSequencerRuntime"];
  syncSequencerRuntime: AppStoreState["syncSequencerRuntime"];
  syncSequencerTransportRuntime: AppStoreState["syncSequencerTransportRuntime"];
}

interface UseSequencerRuntimeControllerResult {
  browserAudioError: string | null;
  browserAudioStatus: "off" | "connecting" | "live" | "error";
  browserAudioTransport: "browser_clock" | "off";
  displayedSequencer: SequencerState;
  displayedSequencerTransportSubunit: number;
  onApplyBrowserClockLatencySettings: (settings: BrowserClockLatencySettings) => void;
  primeBrowserClockAudio: () => void;
  queueSequencerPadRuntime: (sessionId: string, trackId: string, padIndex: number | null) => Promise<SessionSequencerStatus>;
  resolveSequencerSessionId: () => string | null;
  runtimeAudioOutputMode: SessionAudioOutputMode | null;
  sendAllNotesOff: (channel: number) => void;
  sendDirectMidiEvent: (payload: SessionMidiEventRequest, sessionIdOverride?: string) => Promise<void>;
  sequencerRef: MutableRefObject<SequencerState>;
  startSequencerTransport: () => Promise<void>;
  stopSequencerTransport: (resetPlayhead: boolean) => Promise<void>;
  moveSequencerTransport: (deltaSteps: number) => Promise<void>;
}

export function useSequencerRuntimeController({
  activeSessionId,
  activeSessionState,
  browserClockLatencySettings,
  buildBackendSequencerConfig,
  disableAllPianoRolls,
  errors,
  events,
  pushEvent,
  sequencer,
  sequencerConfig,
  sequencerRuntime,
  setBrowserClockLatencySettings,
  setSequencerError,
  setSequencerPlayhead,
  setSequencerTransportAbsoluteStep,
  syncControllerSequencerRuntime,
  syncSequencerRuntime,
  syncSequencerTransportRuntime
}: UseSequencerRuntimeControllerParams): UseSequencerRuntimeControllerResult {
  const sequencerRef = useRef(sequencer);
  const sequencerSessionIdRef = useRef<string | null>(null);
  const sequencerStatusPollRef = useRef<number | null>(null);
  const sequencerPollInFlightRef = useRef(false);
  const sequencerConfigSyncPendingRef = useRef(false);
  const applySequencerStatusRef = useRef<(status: SessionSequencerStatus) => void>(() => undefined);
  const browserClockTransportEventQueueRef = useRef<BrowserClockQueuedTransportEvent[]>([]);

  const {
    browserClockClientRef,
    browserAudioError,
    browserAudioStatus,
    browserAudioTransport,
    disconnectBrowserAudio,
    disconnectBrowserClockAudio,
    displayedSequencer,
    displayedSequencerTransportSubunit,
    effectiveAudioOutputMode,
    effectiveAudioOutputModeRef,
    onApplyBrowserClockLatencySettings,
    reportBrowserAudioConnectionError,
    resetBrowserAudioState,
    runtimeAudioOutputMode
  } = useBrowserClockAudioController({
    applySequencerStatusRef,
    browserClockLatencySettings,
    events,
    sequencer,
    sequencerRuntime,
    setBrowserClockLatencySettings
  });

  useEffect(() => {
    sequencerRef.current = sequencer;
  }, [sequencer]);

  const resolveSequencerSessionId = useCallback((): string | null => {
    return sequencerSessionIdRef.current ?? activeSessionId;
  }, [activeSessionId]);

  const invalidateMissingRuntimeSession = useCallback(
    (sessionId: string, error: unknown): boolean => {
      if (!isSessionNotFoundApiError(error)) {
        return false;
      }

      const currentActiveSessionId = useAppStore.getState().activeSessionId;
      const currentSequencerSessionId = sequencerSessionIdRef.current;
      if (currentActiveSessionId !== sessionId && currentSequencerSessionId !== sessionId) {
        return false;
      }

      if (sequencerStatusPollRef.current !== null) {
        window.clearInterval(sequencerStatusPollRef.current);
        sequencerStatusPollRef.current = null;
      }
      sequencerConfigSyncPendingRef.current = false;
      sequencerSessionIdRef.current = null;

      disconnectBrowserAudio();
      syncSequencerRuntime({ isPlaying: false });
      setSequencerPlayhead(0);
      setSequencerError(`${errors.noActiveRuntimeSession} Start instruments again.`);

      useAppStore.setState({
        activeSessionId: null,
        activeSessionState: "idle",
        activeSessionInstruments: [],
        compileOutput: null,
        events: []
      });
      return true;
    },
    [disconnectBrowserAudio, errors.noActiveRuntimeSession, setSequencerError, setSequencerPlayhead, syncSequencerRuntime]
  );

  const ensureBrowserClockConnection = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await browserClockClientRef.current.connect(sessionId);
      } catch (error) {
        if (invalidateMissingRuntimeSession(sessionId, error)) {
          return;
        }
        reportBrowserAudioConnectionError(error);
      }
    },
    [browserClockClientRef, invalidateMissingRuntimeSession, reportBrowserAudioConnectionError]
  );

  useEffect(() => {
    if (!activeSessionId || activeSessionState !== "running") {
      disconnectBrowserAudio();
      resetBrowserAudioState();
      return;
    }

    if (effectiveAudioOutputMode === null) {
      return;
    }

    if (effectiveAudioOutputMode === "browser_clock") {
      void ensureBrowserClockConnection(activeSessionId);
      return;
    }

    disconnectBrowserClockAudio();
    resetBrowserAudioState();
  }, [
    activeSessionId,
    activeSessionState,
    disconnectBrowserClockAudio,
    disconnectBrowserAudio,
    effectiveAudioOutputMode,
    ensureBrowserClockConnection,
    resetBrowserAudioState
  ]);

  const applySequencerStatus = useCallback(
    (status: SessionSequencerStatus) => {
      if (effectiveAudioOutputModeRef.current === "browser_clock") {
        browserClockTransportEventQueueRef.current = [];
      }
      const melodicTrackStatuses = status.tracks.filter((track) => parseDrummerRowRuntimeTrackId(track.track_id) === null);
      const drummerTrackStatuses = aggregateDrummerRuntimeTrackStatuses(
        status.tracks,
        sequencerRef.current.drummerTracks as DrummerSequencerTrackState[]
      );
      syncSequencerRuntime({
        isPlaying: status.running,
        transportStepCount: status.step_count,
        playhead: status.current_step,
        cycle: status.cycle,
        transportSubunit: status.transport_subunit,
        tracks: melodicTrackStatuses.map((track) => ({
          trackId: track.track_id,
          stepCount: track.step_count,
          localStep: track.local_step,
          runtimePadStartSubunit: track.runtime_pad_start_subunit,
          activePad: track.active_pad,
          queuedPad: track.queued_pad,
          padLoopPosition: track.pad_loop_position,
          enabled: track.enabled,
          queuedEnabled: track.queued_enabled
        })),
        drummerTracks: drummerTrackStatuses
      });
      syncControllerSequencerRuntime(
        status.controller_tracks.map((track) => ({
          controllerSequencerId: track.track_id,
          activePad: track.active_pad,
          queuedPad: track.queued_pad,
          padLoopPosition: track.pad_loop_position,
          runtimePadStartSubunit: track.runtime_pad_start_subunit,
          enabled: track.enabled
        }))
      );
    },
    [effectiveAudioOutputModeRef, syncControllerSequencerRuntime, syncSequencerRuntime]
  );
  applySequencerStatusRef.current = applySequencerStatus;

  const applyBrowserClockSequencerStepEvent = useCallback(
    (payload: SequencerStepEventPayload) => {
      const melodicTrackSteps = payload.tracks
        .filter((track) => parseDrummerRowRuntimeTrackId(track.track_id) === null)
        .map((track) => ({
          trackId: track.track_id,
          localStep: track.local_step
        }));
      const drummerTrackSteps = aggregateDrummerRuntimeTrackLocalSteps(
        payload.tracks,
        sequencerRef.current.drummerTracks as DrummerSequencerTrackState[]
      );
      syncSequencerTransportRuntime({
        isPlaying: payload.running,
        transportStepCount: payload.step_count,
        playhead: payload.current_step,
        cycle: payload.cycle,
        transportSubunit: payload.transport_subunit,
        tracks: melodicTrackSteps,
        drummerTracks: drummerTrackSteps,
        controllerTracks: payload.controller_tracks.map((track) => ({
          controllerSequencerId: track.track_id,
          runtimePadStartSubunit: track.runtime_pad_start_subunit
        }))
      });
    },
    [syncSequencerTransportRuntime]
  );

  const applyBrowserClockPadSwitchEvent = useCallback(
    (payload: SequencerPadSwitchEventPayload) => {
      applyBrowserClockSequencerStepEvent({
        previous_step: payload.current_step,
        current_step: payload.current_step,
        cycle: payload.cycle,
        running: payload.running,
        step_count: payload.step_count,
        transport_subunit: payload.transport_subunit,
        tracks: payload.tracks,
        controller_tracks: payload.controller_tracks
      });

      if (payload.track_kind === "controller") {
        syncControllerSequencerRuntime([
          {
            controllerSequencerId: payload.track_id,
            activePad: payload.active_pad,
            queuedPad: payload.queued_pad,
            padLoopPosition: payload.pad_loop_position,
            runtimePadStartSubunit: payload.runtime_pad_start_subunit,
            enabled: payload.enabled
          }
        ]);
        return;
      }

      const drummerTrack = parseDrummerRowRuntimeTrackId(payload.track_id);
      if (drummerTrack) {
        syncSequencerRuntime({
          isPlaying: payload.running,
          transportStepCount: payload.step_count,
          playhead: payload.current_step,
          cycle: payload.cycle,
          transportSubunit: payload.transport_subunit,
          drummerTracks: [
            {
              trackId: drummerTrack.drummerTrackId,
              localStep: payload.local_step ?? undefined,
              activePad: payload.active_pad,
              queuedPad: payload.queued_pad,
              padLoopPosition: payload.pad_loop_position,
              runtimePadStartSubunit: payload.runtime_pad_start_subunit,
              enabled: payload.enabled,
              queuedEnabled: payload.queued_enabled
            }
          ]
        });
        return;
      }

      syncSequencerRuntime({
        isPlaying: payload.running,
        transportStepCount: payload.step_count,
        playhead: payload.current_step,
        cycle: payload.cycle,
        transportSubunit: payload.transport_subunit,
        tracks: [
          {
            trackId: payload.track_id,
            localStep: payload.local_step ?? undefined,
            activePad: payload.active_pad,
            queuedPad: payload.queued_pad,
            padLoopPosition: payload.pad_loop_position,
            runtimePadStartSubunit: payload.runtime_pad_start_subunit,
            enabled: payload.enabled,
            queuedEnabled: payload.queued_enabled
          }
        ]
      });
    },
    [applyBrowserClockSequencerStepEvent, syncControllerSequencerRuntime, syncSequencerRuntime]
  );

  useEffect(() => {
    if (effectiveAudioOutputMode !== "browser_clock" || !sequencer.isPlaying) {
      browserClockTransportEventQueueRef.current = [];
      return;
    }

    let frameId = 0;
    let cancelled = false;
    function drainTransportQueue(): void {
      if (cancelled) {
        return;
      }

      const playbackTransportSubunit = browserClockClientRef.current.getPlaybackTransportSubunit();
      if (playbackTransportSubunit !== null && playbackTransportSubunit !== undefined) {
        const queue = browserClockTransportEventQueueRef.current;
        while (queue.length > 0 && queue[0].transportSubunit <= playbackTransportSubunit + 1) {
          const event = queue.shift();
          if (!event) {
            break;
          }
          if (event.kind === "step") {
            applyBrowserClockSequencerStepEvent(event.payload);
            continue;
          }
          applyBrowserClockPadSwitchEvent(event.payload);
        }
      }

      frameId = window.requestAnimationFrame(drainTransportQueue);
    }

    frameId = window.requestAnimationFrame(drainTransportQueue);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [
    applyBrowserClockPadSwitchEvent,
    applyBrowserClockSequencerStepEvent,
    browserClockClientRef,
    effectiveAudioOutputMode,
    sequencer.isPlaying
  ]);

  const syncSequencerStatusFromServer = useCallback(
    async (sessionId: string, options?: { silentError?: boolean }): Promise<void> => {
      if (sequencerPollInFlightRef.current || sequencerConfigSyncPendingRef.current) {
        return;
      }

      sequencerPollInFlightRef.current = true;
      try {
        const status = await api.getSessionSequencerStatus(sessionId);
        applySequencerStatusRef.current(status);
      } catch (pollError) {
        if (invalidateMissingRuntimeSession(sessionId, pollError)) {
          return;
        }
        if (options?.silentError === true) {
          return;
        }
        setSequencerError(
          pollError instanceof Error
            ? `${errors.failedToSyncSequencerStatus}: ${pollError.message}`
            : errors.failedToSyncSequencerStatus
        );
      } finally {
        sequencerPollInFlightRef.current = false;
      }
    },
    [errors.failedToSyncSequencerStatus, invalidateMissingRuntimeSession, setSequencerError]
  );
  const syncSequencerStatusFromServerRef = useRef(syncSequencerStatusFromServer);

  useEffect(() => {
    syncSequencerStatusFromServerRef.current = syncSequencerStatusFromServer;
  }, [syncSequencerStatusFromServer]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const sessionId = activeSessionId;
    const url = `${wsBaseUrl()}/ws/sessions/${sessionId}`;
    let socket: WebSocket | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;
    let disposed = false;

    function clearHeartbeatTimer(): void {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function clearReconnectTimer(): void {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function closeSocket(): void {
      clearHeartbeatTimer();
      if (!socket) {
        return;
      }
      socket.onopen = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Ignore browser-side cleanup failures.
      }
      socket = null;
    }

    function sendHeartbeat(): void {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.send(JSON.stringify({ type: "heartbeat", timestamp_ms: Date.now() }));
      } catch {
        // Ignore heartbeat send failures during shutdown/reconnect races.
      }
    }

    function scheduleReconnect(): void {
      if (disposed || reconnectTimer !== null) {
        return;
      }
      const delayMs = Math.min(4_000, 500 * 2 ** Math.min(reconnectAttempts, 3));
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, delayMs);
    }

    function connectSocket(): void {
      if (disposed) {
        return;
      }

      closeSocket();
      const nextSocket = new WebSocket(url);
      socket = nextSocket;

      nextSocket.onopen = () => {
        reconnectAttempts = 0;
        sendHeartbeat();
        heartbeatTimer = window.setInterval(sendHeartbeat, 2000);
        if (effectiveAudioOutputModeRef.current !== "browser_clock" && sequencerRef.current.isPlaying) {
          void syncSequencerStatusFromServerRef.current(sessionId, { silentError: true });
        }
      };

      nextSocket.onclose = () => {
        clearHeartbeatTimer();
        if (socket === nextSocket) {
          socket = null;
        }
        scheduleReconnect();
      };

      nextSocket.onmessage = (message) => {
        try {
          const parsed = JSON.parse(message.data) as SessionEvent;
          if (shouldLogSessionEvent(parsed.type)) {
            pushEvent(parsed);
          }
          if (effectiveAudioOutputModeRef.current !== "browser_clock") {
            return;
          }
          const stepPayload = parseSequencerStepEventPayload(parsed);
          if (stepPayload) {
            browserClockTransportEventQueueRef.current.push({
              kind: "step",
              transportSubunit: stepPayload.transport_subunit,
              payload: stepPayload
            });
            return;
          }
          const padSwitchPayload = parseSequencerPadSwitchEventPayload(parsed);
          if (padSwitchPayload) {
            browserClockTransportEventQueueRef.current.push({
              kind: "pad_switch",
              transportSubunit: padSwitchPayload.transport_subunit,
              payload: padSwitchPayload
            });
          }
        } catch {
          // Ignore malformed websocket payloads.
        }
      };
    }

    connectSocket();

    return () => {
      disposed = true;
      clearReconnectTimer();
      closeSocket();
    };
  }, [activeSessionId, effectiveAudioOutputModeRef, pushEvent]);

  const stopSequencerTransport = useCallback(
    async (resetPlayhead: boolean): Promise<void> => {
      const sessionId = resolveSequencerSessionId();
      sequencerConfigSyncPendingRef.current = false;
      if (sessionId) {
        try {
          const status =
            effectiveAudioOutputMode === "browser_clock"
              ? await browserClockClientRef.current.stopSequencer(sessionId)
              : await api.stopSessionSequencer(sessionId);
          applySequencerStatus(status);
        } catch {
          syncSequencerRuntime({ isPlaying: false });
        }
      } else {
        syncSequencerRuntime({ isPlaying: false });
      }

      sequencerSessionIdRef.current = null;
      if (resetPlayhead) {
        setSequencerPlayhead(0);
      }
    },
    [
      applySequencerStatus,
      browserClockClientRef,
      effectiveAudioOutputMode,
      resolveSequencerSessionId,
      setSequencerPlayhead,
      syncSequencerRuntime
    ]
  );

  const startSequencerTransport = useCallback(async (): Promise<void> => {
    setSequencerError(null);
    if (activeSessionState !== "running") {
      setSequencerError(errors.startInstrumentsFirstForSequencer);
      return;
    }

    const sessionId = activeSessionId;
    if (!sessionId) {
      setSequencerError(errors.noActiveInstrumentSessionForSequencer);
      return;
    }

    try {
      const currentSequencerState = sequencerRef.current;
      const payload: SessionSequencerStartRequest = {
        config: buildBackendSequencerConfig(currentSequencerState),
        position_step: sequencerAbsoluteTransportStep(
          currentSequencerState.playhead,
          currentSequencerState.cycle,
          currentSequencerState.stepCount
        )
      };
      const status =
        effectiveAudioOutputMode === "browser_clock"
          ? await browserClockClientRef.current.startSequencer(sessionId, {
              config: payload.config,
              positionStep: payload.position_step
            })
          : await api.startSessionSequencer(sessionId, payload);
      sequencerSessionIdRef.current = sessionId;
      applySequencerStatus(status);
    } catch (transportError) {
      if (invalidateMissingRuntimeSession(sessionId, transportError)) {
        return;
      }
      syncSequencerRuntime({ isPlaying: false });
      setSequencerError(
        transportError instanceof Error ? transportError.message : errors.failedToStartSequencer
      );
    }
  }, [
    activeSessionId,
    activeSessionState,
    applySequencerStatus,
    browserClockClientRef,
    buildBackendSequencerConfig,
    effectiveAudioOutputMode,
    errors.failedToStartSequencer,
    errors.noActiveInstrumentSessionForSequencer,
    errors.startInstrumentsFirstForSequencer,
    invalidateMissingRuntimeSession,
    setSequencerError,
    syncSequencerRuntime
  ]);

  const moveSequencerTransport = useCallback(
    async (deltaSteps: number): Promise<void> => {
      const currentState = sequencerRef.current;
      const { arrangementEndStep, selection } = arrangerPlaybackBounds(currentState);
      const currentAbsoluteStep = sequencerAbsoluteTransportStep(
        currentState.playhead,
        currentState.cycle,
        currentState.stepCount
      );
      const targetAbsoluteStep = clampArrangerSeekStep(
        currentAbsoluteStep + deltaSteps,
        selection,
        arrangementEndStep,
        sequencerTransportStepsPerBeat(currentState.timing)
      );

      if (!currentState.isPlaying) {
        setSequencerTransportAbsoluteStep(targetAbsoluteStep);
        return;
      }

      const sessionId = resolveSequencerSessionId();
      if (!sessionId) {
        setSequencerError(errors.noActiveInstrumentSessionForSequencer);
        return;
      }

      setSequencerError(null);

      try {
        const status =
          effectiveAudioOutputMode === "browser_clock"
            ? deltaSteps < 0
              ? await browserClockClientRef.current.rewindSequencer(sessionId)
              : await browserClockClientRef.current.forwardSequencer(sessionId)
            : deltaSteps < 0
              ? await api.rewindSessionSequencerCycle(sessionId)
              : await api.forwardSessionSequencerCycle(sessionId);
        applySequencerStatus(status);
      } catch (error) {
        if (invalidateMissingRuntimeSession(sessionId, error)) {
          return;
        }
        setSequencerError(error instanceof Error ? error.message : "Failed to move sequencer transport.");
      }
    },
    [
      applySequencerStatus,
      browserClockClientRef,
      effectiveAudioOutputMode,
      errors.noActiveInstrumentSessionForSequencer,
      invalidateMissingRuntimeSession,
      resolveSequencerSessionId,
      setSequencerError,
      setSequencerTransportAbsoluteStep
    ]
  );

  const queueSequencerPadRuntime = useCallback(
    async (sessionId: string, trackId: string, padIndex: number | null): Promise<SessionSequencerStatus> => {
      const status =
        effectiveAudioOutputMode === "browser_clock"
          ? await browserClockClientRef.current.queuePad(sessionId, trackId, padIndex)
          : await api.queueSessionSequencerPad(sessionId, trackId, { pad_index: padIndex });
      applySequencerStatus(status);
      return status;
    },
    [applySequencerStatus, browserClockClientRef, effectiveAudioOutputMode]
  );

  const sendDirectMidiEvent = useCallback(
    async (payload: SessionMidiEventRequest, sessionIdOverride?: string): Promise<void> => {
      const sessionId = sessionIdOverride ?? activeSessionId;
      if (!sessionId) {
        throw new Error(errors.noActiveRuntimeSession);
      }
      try {
        if (effectiveAudioOutputMode === "browser_clock") {
          await browserClockClientRef.current.sendManualMidi(sessionId, payload);
          return;
        }
        await api.sendSessionMidiEvent(sessionId, payload);
      } catch (error) {
        if (invalidateMissingRuntimeSession(sessionId, error)) {
          throw new Error(errors.noActiveRuntimeSession);
        }
        throw error;
      }
    },
    [
      activeSessionId,
      browserClockClientRef,
      effectiveAudioOutputMode,
      errors.noActiveRuntimeSession,
      invalidateMissingRuntimeSession
    ]
  );

  const sendAllNotesOff = useCallback(
    (channel: number): void => {
      void sendDirectMidiEvent({ type: "all_notes_off", channel }).catch(() => {
        // Ignore best-effort all-notes-off failures during panic.
      });
    },
    [sendDirectMidiEvent]
  );

  const sequencerConfigSyncSignature = useMemo(() => {
    if (!sequencer.isPlaying) {
      return null;
    }
    return JSON.stringify(buildBackendSequencerConfig(sequencerConfig));
  }, [buildBackendSequencerConfig, sequencer.isPlaying, sequencerConfig]);

  const primeBrowserClockAudio = useCallback((): void => {
    if (runtimeAudioOutputMode !== "browser_clock") {
      return;
    }
    void browserClockClientRef.current.prime().catch(() => {
      // Connection setup will surface the actionable error if priming fails.
    });
  }, [browserClockClientRef, runtimeAudioOutputMode]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }

    const sessionId = resolveSequencerSessionId();
    if (!sessionId) {
      return;
    }

    const resolvedSessionId = sessionId;
    function syncStatus(options?: { silentError?: boolean }): void {
      void syncSequencerStatusFromServerRef.current(resolvedSessionId, options);
    }

    if (effectiveAudioOutputMode === "browser_clock") {
      return;
    }

    syncStatus();
    sequencerStatusPollRef.current = window.setInterval(() => {
      syncStatus();
    }, 80);

    return () => {
      if (sequencerStatusPollRef.current !== null) {
        window.clearInterval(sequencerStatusPollRef.current);
        sequencerStatusPollRef.current = null;
      }
    };
  }, [effectiveAudioOutputMode, resolveSequencerSessionId, sequencer.isPlaying]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      sequencerConfigSyncPendingRef.current = false;
      return;
    }

    const sessionId = resolveSequencerSessionId();
    if (!sessionId || !sequencerConfigSyncSignature) {
      sequencerConfigSyncPendingRef.current = false;
      return;
    }

    const payload = JSON.parse(sequencerConfigSyncSignature) as SessionSequencerConfigRequest;
    sequencerConfigSyncPendingRef.current = true;

    const syncTimer = window.setTimeout(() => {
      void api
        .configureSessionSequencer(sessionId, payload)
        .then((status) => {
          applySequencerStatus(status);
        })
        .catch((syncError) => {
          if (invalidateMissingRuntimeSession(sessionId, syncError)) {
            return;
          }
          setSequencerError(
            syncError instanceof Error
              ? `${errors.failedToUpdateSequencerConfig}: ${syncError.message}`
              : errors.failedToUpdateSequencerConfig
          );
        })
        .finally(() => {
          sequencerConfigSyncPendingRef.current = false;
          if (
            sequencerRef.current.isPlaying &&
            !sequencerRef.current.tracks.some((track) => track.enabled || track.queuedEnabled === true) &&
            !sequencerRef.current.drummerTracks.some((track) => track.enabled || track.queuedEnabled === true) &&
            !sequencerRef.current.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
          ) {
            void stopSequencerTransport(false);
          }
        });
    }, 80);

    return () => {
      window.clearTimeout(syncTimer);
    };
  }, [
    applySequencerStatus,
    errors.failedToUpdateSequencerConfig,
    invalidateMissingRuntimeSession,
    resolveSequencerSessionId,
    sequencer.isPlaying,
    sequencerConfigSyncSignature,
    setSequencerError,
    stopSequencerTransport
  ]);

  useEffect(() => {
    if (activeSessionState !== "running" || sequencer.isPlaying) {
      return;
    }
    if (
      !sequencer.tracks.some((track) => track.enabled) &&
      !sequencer.drummerTracks.some((track) => track.enabled) &&
      !sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
    ) {
      return;
    }
    void startSequencerTransport();
  }, [
    activeSessionState,
    sequencer.controllerSequencers,
    sequencer.drummerTracks,
    sequencer.isPlaying,
    sequencer.tracks,
    startSequencerTransport
  ]);

  useEffect(() => {
    if (!sequencer.isPlaying || sequencerConfigSyncPendingRef.current) {
      return;
    }
    if (
      sequencer.tracks.some((track) => track.enabled || track.queuedEnabled === true) ||
      sequencer.drummerTracks.some((track) => track.enabled || track.queuedEnabled === true) ||
      sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled)
    ) {
      return;
    }
    void stopSequencerTransport(false);
  }, [
    sequencer.controllerSequencers,
    sequencer.drummerTracks,
    sequencer.isPlaying,
    sequencer.tracks,
    stopSequencerTransport
  ]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      if (activeSessionState !== "running") {
        disableAllPianoRolls();
      }
      return;
    }

    if (activeSessionState !== "running") {
      disableAllPianoRolls();
      void stopSequencerTransport(false);
      setSequencerError(errors.sessionNotRunningSequencerStopped);
    }
  }, [
    activeSessionState,
    disableAllPianoRolls,
    errors.sessionNotRunningSequencerStopped,
    sequencer.isPlaying,
    setSequencerError,
    stopSequencerTransport
  ]);

  useEffect(() => {
    return () => {
      void stopSequencerTransport(false);
    };
  }, [stopSequencerTransport]);

  return {
    browserAudioError,
    browserAudioStatus,
    browserAudioTransport,
    displayedSequencer,
    displayedSequencerTransportSubunit,
    onApplyBrowserClockLatencySettings,
    primeBrowserClockAudio,
    queueSequencerPadRuntime,
    resolveSequencerSessionId,
    runtimeAudioOutputMode,
    sendAllNotesOff,
    sendDirectMidiEvent,
    sequencerRef,
    startSequencerTransport,
    stopSequencerTransport,
    moveSequencerTransport
  };
}
