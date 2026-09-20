import { acknowledgeLaneOutput, setLaneOutputSender } from "../lib/laneOutput";
import { compilePadLoopPattern } from "../lib/padLoopPattern";
import { compileDefinition } from "../lib/arrangementEditing";
import { cancelArrangerPreviewGestures } from "../lib/arrangerPreviewGesture";
import type { AuditionDevice, PreviewCommand } from "../components/sequencer/PerformanceAudition";
import { SequencerConfigSync } from "../lib/sequencerConfigSync";
import { consumeSequencerEnablementCommands } from "../store/sequencerEdits";
import { mergedSequencerState } from "../lib/mergedSequencerState";
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";

import { api, wsBaseUrl } from "../api/client";
import {
  absoluteTransportStep as sequencerAbsoluteTransportStep,
  arrangerPlaybackBounds,
  clampArrangerSeekStep
} from "../lib/arrangerTransport";
import { sequencerTransportStepsPerBeat, sequencerTransportSubunitsPerStep } from "../lib/sequencer";
import {
  drummerRowRuntimeTrackId,
  aggregateDrummerRuntimeTrackLocalSteps,
  aggregateDrummerRuntimeTrackStatuses,
  isSessionNotFoundApiError,
  parseDrummerRowRuntimeTrackId,
  parseSequencerPadSwitchesEventPayload,
  parseSequencerStepEventPayload,
  sourceTransportSync,
  shouldLogSessionEvent,
  type SequencerPadSwitchesEventPayload,
  type SequencerStepEventPayload
} from "../lib/sequencerRuntime";
import { useAppStore } from "../store/useAppStore";
import type {
  SessionAuditionRequest,
  SessionDeviceTransportRequest,
  PadLoopPatternItem,
  PerformanceAuditionStatus,
  BrowserClockLatencySettings,
  AppPage,
  DrummerSequencerTrackState,
  SessionArpeggiatorConfigRequest,
  SessionArpeggiatorStatus,
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
import type { AudibleBrowserClockTransportEvent } from "../audio/browserClockWorkerProtocol";

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
  melodicVisualsVisible?: boolean;
  drummerVisualsVisible?: boolean;
  activePage: AppPage;
  activeSessionId: string | null;
  activeSessionState: SessionState;
  browserClockLatencySettings: BrowserClockLatencySettings;
  buildBackendArpeggiatorConfig: (state?: SequencerState) => SessionArpeggiatorConfigRequest;
  buildBackendSequencerConfig: (
    state?: SequencerState,
    mode?: "runtime" | "export",
    arrangerActive?: boolean
  ) => SessionSequencerConfigRequest;
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
  syncArpeggiatorRuntime: AppStoreState["syncArpeggiatorRuntime"];
  syncControllerSequencerRuntime: AppStoreState["syncControllerSequencerRuntime"];
  syncSequencerRuntime: AppStoreState["syncSequencerRuntime"];
  syncSequencerTransportRuntime: AppStoreState["syncSequencerTransportRuntime"];
}

interface UseSequencerRuntimeControllerResult {
  transportDevice: (deviceId: string | null, playing: boolean) => Promise<void>;
  auditionDevice: AuditionDevice;
  cancelPendingArpeggiatorEdits: () => void;
  browserAudioError: string | null;
  browserAudioDiagnostics: import("../audio/browserClockWorkerProtocol").BrowserClockWorkerDiagnostics | null;
  browserAudioStatus: "off" | "connecting" | "live" | "error";
  browserAudioTransport: "browser_clock" | "off";
  displayedSequencer: SequencerState;
  displayedSequencerTransportSubunit: number;
  readPlaybackTransportSubunit: () => number | null;
  onApplyBrowserClockLatencySettings: (settings: BrowserClockLatencySettings) => void;
  primeBrowserClockAudio: () => void;
  queueSequencerPadRuntime: (sessionId: string, trackId: string, padIndex: number | null) => Promise<SessionSequencerStatus>;
  resolveSequencerSessionId: () => string | null;
  runtimeAudioOutputMode: SessionAudioOutputMode | null;
  sendAllNotesOff: (channel: number) => void;
  sendDirectMidiEvent: (payload: SessionMidiEventRequest, sessionIdOverride?: string) => Promise<void>;
  sequencerRef: MutableRefObject<SequencerState>;
  startSequencerTransport: (arrangerActive?: boolean) => Promise<void>;
  stopSequencerTransport: (resetPlayhead: boolean) => Promise<void>;
  moveSequencerTransport: (deltaSteps: number) => Promise<void>;
  seekSequencerTransport: (positionStep: number) => Promise<void>;
  markSequencerConfigSyncPending: () => void;
}

type ApplySequencerStatusOptions = {
  preserveLocalEnablement?: boolean;
};

// Routing/mode changes invalidate prepared auditions without discarding another device's preview.
function auditionContext(id: string) {
  const sequencer = useAppStore.getState().sequencer;
  const arp = sequencer.arpeggiators.find(device => device.id === id);
  return arp ? JSON.stringify([arp.inputChannel, arp.targetChannel, arp.playbackMode, arp.processingMode, arp.enabled])
    : [...sequencer.tracks, ...sequencer.drummerTracks, ...sequencer.controllerSequencers].some(device => device.id === id) ? id : null;
}

export function useSequencerRuntimeController({
  activePage,
  melodicVisualsVisible,
  drummerVisualsVisible,
  activeSessionId,
  activeSessionState,
  browserClockLatencySettings,
  buildBackendArpeggiatorConfig,
  buildBackendSequencerConfig,
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
  syncArpeggiatorRuntime,
  syncControllerSequencerRuntime,
  syncSequencerRuntime,
  syncSequencerTransportRuntime
}: UseSequencerRuntimeControllerParams): UseSequencerRuntimeControllerResult {
  type AuditionDefinition = { item: PadLoopPatternItem; sequence: string; request: SessionAuditionRequest; previous?: AuditionDefinition; replacing?: boolean };
  const auditionDefinitions = useRef(new Map<string, AuditionDefinition>());
  const auditionCommandVersion = useRef(new Map<string, number>());
  const deviceCommandVersions = useRef(new Map<string, number>());
  const deviceCommandQueue = useRef(Promise.resolve());
  const previewGestures = useRef(new Map<string, { gesture: string; generation: number; session?: string; definition?: AuditionDefinition }>());
  const workspaceGestures = useRef(new Map<string, { gesture: string; generation: number; session?: string }>());
  const refreshAuditions = useRef<(sessionId: string) => Promise<void>>(async () => {});
  const workspaceGeneration = useAppStore(state => state.performanceWorkspaceGeneration);
  const previewLifecycle = useRef({ id: activeSessionId, state: activeSessionState, generation: workspaceGeneration });
  useEffect(() => {
    const previous = previewLifecycle.current;
    previewLifecycle.current = { id: activeSessionId, state: activeSessionState, generation: workspaceGeneration };
    if (previous.generation !== workspaceGeneration || previous.id && previous.id !== activeSessionId || previous.state === "running" && activeSessionState !== "running") {
      // Starting a stopped engine may replace its compiled rack/session.
      if (previous.generation !== workspaceGeneration || previous.state === "running") {
        for (const [id, version] of deviceCommandVersions.current) deviceCommandVersions.current.set(id, version + 1);
      }
      for (const id of auditionCommandVersion.current.keys()) auditionCommandVersion.current.set(id, auditionCommandVersion.current.get(id)! + 1);
      previewGestures.current.clear();
      workspaceGestures.current.clear();
      cancelArrangerPreviewGestures();
    }
  }, [activeSessionId, activeSessionState, workspaceGeneration]);
  useEffect(() => {
    auditionDefinitions.current.clear();
    for (const [id, entry] of previewGestures.current) {
      if (entry.generation !== workspaceGeneration || entry.session && entry.session !== activeSessionId) {
        previewGestures.current.delete(id);
        auditionCommandVersion.current.set(id, (auditionCommandVersion.current.get(id) ?? 0) + 1);
      }
    }

    useAppStore.setState({ performanceAuditions: {} });
  }, [activeSessionId, workspaceGeneration]);
  const authoredRevision = useAppStore(state => state.sequencerEditRevision);
  const sequencerSeekPendingRef = useRef(false);
  const configSyncRef = useRef<SequencerConfigSync<SessionSequencerConfigRequest, SessionSequencerStatus> | null>(null);
  const sequencerRef = useRef(sequencer);
  const sequencerSessionIdRef = useRef<string | null>(null);
  const sequencerStatusPollRef = useRef<number | null>(null);
  const sequencerPollInFlightRef = useRef(false);
  const sequencerConfigSyncPendingRef = useRef(false);
  const transportRequestVersionRef = useRef(0);
  const applySequencerStatusRef = useRef<
    (status: SessionSequencerStatus, options?: ApplySequencerStatusOptions) => void
  >(() => undefined);
  const applyBrowserClockTransportEventsRef = useRef<(events: AudibleBrowserClockTransportEvent[]) => void>(
    () => undefined
  );

  const {
    browserClockClientRef,
    browserAudioError,
    browserAudioDiagnostics,
    browserAudioStatus,
    browserAudioTransport,
    disconnectBrowserAudio,
    disconnectBrowserClockAudio,
    displayedSequencer,
    displayedSequencerTransportSubunit,
    readPlaybackTransportSubunit,
    effectiveAudioOutputMode,
    effectiveAudioOutputModeRef,
    onApplyBrowserClockLatencySettings,
    reportBrowserAudioConnectionError,
    resetBrowserAudioState,
    runtimeAudioOutputMode
  } = useBrowserClockAudioController({
    applyBrowserClockTransportEventsRef,
    applySequencerStatusRef,
    browserClockLatencySettings,
    events,
    sequencer,
    sequencerRuntime,
    setBrowserClockLatencySettings,
    melodicVisualsVisible,
    drummerVisualsVisible,
    visualUpdatesEnabled: activePage === "sequencer"
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

  useEffect(() => {
    if (!activeSessionId || activeSessionState !== "running") return setLaneOutputSender(null);
    return setLaneOutputSender(request => effectiveAudioOutputMode === "browser_clock"
      ? browserClockClientRef.current.setLaneOutput(activeSessionId, request)
      : api.setLaneOutput(activeSessionId, request));
  }, [activeSessionId, activeSessionState, effectiveAudioOutputMode, browserClockClientRef, workspaceGeneration]);

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

  const applyArpeggiatorStatus = useCallback(
    (arpeggiators: SessionArpeggiatorStatus[]) => {
      syncArpeggiatorRuntime(
        arpeggiators.map((arpeggiator) => ({
          arpeggiatorId: arpeggiator.arpeggiator_id,
          status: arpeggiator,
          heldNotes: arpeggiator.held_notes,
          activeNote: arpeggiator.active_note,
          stepIndex: arpeggiator.step_index,
          lastVelocity: arpeggiator.last_velocity
        }))
      );
    },
    [syncArpeggiatorRuntime]
  );

  const applySequencerStatus = useCallback(
    (status: SessionSequencerStatus, options?: ApplySequencerStatusOptions) => {
      acknowledgeLaneOutput(status);
      if (status.auditions) {
        const audible = useAppStore.getState().performanceAuditions;
        useAppStore.setState({ performanceAuditions: Object.fromEntries(Object.entries(status.auditions).map(([runtimeId, value]) => {
          const id = parseDrummerRowRuntimeTrackId(runtimeId)?.drummerTrackId ?? runtimeId;
          if (!value.workspace_gesture || effectiveAudioOutputModeRef.current !== "browser_clock") return [id, value];
          const previous = audible[id]?.workspace_gesture === value.workspace_gesture ? audible[id] : undefined;
          // Command acknowledgments describe render-ahead state. Only audible PCM
          // markers advance the workspace highlight in browser-clock mode.
          return [id, { ...value, workspace_sequence: previous?.workspace_sequence ?? [], workspace_position: previous?.workspace_position ?? null }];
        })) });
      }
      const preserveLocalEnablement =
        status.running && (options?.preserveLocalEnablement ?? sequencerConfigSyncPendingRef.current);
      const melodicTrackStatuses = status.tracks.filter((track) => parseDrummerRowRuntimeTrackId(track.track_id) === null);
      const drummerTrackStatuses = aggregateDrummerRuntimeTrackStatuses(
        status.tracks,
        sequencerRef.current.drummerTracks as DrummerSequencerTrackState[]
      );
      syncSequencerRuntime({
        isPlaying: status.running,
        ...sourceTransportSync(status),
        arrangerActive: status.arranger_active,
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
          ...(preserveLocalEnablement
            ? {}
            : {
                enabled: status.running && track.enabled,
                queuedEnabled: status.running ? track.queued_enabled : null
              })
        })),
        drummerTracks: drummerTrackStatuses.map((track) => ({
          trackId: track.trackId,
          stepCount: track.stepCount,
          localStep: track.localStep,
          runtimePadStartSubunit: track.runtimePadStartSubunit,
          activePad: track.activePad,
          queuedPad: track.queuedPad,
          padLoopPosition: track.padLoopPosition,
          ...(preserveLocalEnablement
            ? {}
            : {
                enabled: status.running && track.enabled === true,
                queuedEnabled: status.running ? track.queuedEnabled : null
              })
        }))
      });
      syncControllerSequencerRuntime(
        status.controller_tracks.map((track) => ({
          controllerSequencerId: track.track_id,
          activePad: track.active_pad,
          queuedPad: track.queued_pad,
          padLoopPosition: track.pad_loop_position,
          runtimePadStartSubunit: track.runtime_pad_start_subunit,
          ...(preserveLocalEnablement ? {} : { enabled: status.running && track.enabled })
        }))
      );
      applyArpeggiatorStatus(status.arpeggiators ?? []);
    },
    [applyArpeggiatorStatus, effectiveAudioOutputModeRef, syncControllerSequencerRuntime, syncSequencerRuntime]
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
        ...sourceTransportSync(payload),
        arrangerActive: payload.arranger_active,
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

  const applyBrowserClockPadSwitchesEvent = useCallback(
    (payload: SequencerPadSwitchesEventPayload) => {
      const preserveLocalEnablement = payload.running && sequencerConfigSyncPendingRef.current;
      applyBrowserClockSequencerStepEvent({
        ...payload,
        previous_step: payload.current_step,
        current_step: payload.current_step,
        cycle: payload.cycle,
        running: payload.running,
        step_count: payload.step_count,
        transport_subunit: payload.transport_subunit,
        tracks: payload.tracks,
        controller_tracks: payload.controller_tracks
      });

      const controllerUpdates: Array<{
        controllerSequencerId: string;
        activePad?: number;
        queuedPad?: number | null;
        padLoopPosition?: number | null;
        runtimePadStartSubunit?: number | null;
        enabled?: boolean;
      }> = [];
      const melodicUpdates: Array<{
        trackId: string;
        localStep?: number;
        runtimePadStartSubunit?: number | null;
        activePad?: number;
        queuedPad?: number | null;
        padLoopPosition?: number | null;
        enabled?: boolean;
        queuedEnabled?: boolean | null;
      }> = [];
      const drummerUpdates: typeof melodicUpdates = [];

      for (const switched of payload.switches) {
        if (switched.track_kind === "controller") {
          controllerUpdates.push({
            controllerSequencerId: switched.track_id,
            activePad: switched.active_pad,
            queuedPad: switched.queued_pad,
            padLoopPosition: switched.pad_loop_position,
            runtimePadStartSubunit: switched.runtime_pad_start_subunit,
            ...(preserveLocalEnablement ? {} : { enabled: payload.running && switched.enabled === true })
          });
          continue;
        }

        const update = {
          trackId: switched.track_id,
          localStep: switched.local_step ?? undefined,
          activePad: switched.active_pad,
          queuedPad: switched.queued_pad,
          padLoopPosition: switched.pad_loop_position,
          runtimePadStartSubunit: switched.runtime_pad_start_subunit,
          ...(preserveLocalEnablement
            ? {}
            : {
                enabled: payload.running && switched.enabled === true,
                queuedEnabled: payload.running ? switched.queued_enabled : null
              })
        };
        const drummerTrack = parseDrummerRowRuntimeTrackId(switched.track_id);
        if (drummerTrack) {
          drummerUpdates.push({ ...update, trackId: drummerTrack.drummerTrackId });
        } else {
          melodicUpdates.push(update);
        }
      }

      if (controllerUpdates.length > 0) {
        syncControllerSequencerRuntime(controllerUpdates);
      }
      if (melodicUpdates.length > 0 || drummerUpdates.length > 0) {
        syncSequencerRuntime({
          isPlaying: payload.running,
          ...sourceTransportSync(payload),
          arrangerActive: payload.arranger_active,
          transportStepCount: payload.step_count,
          playhead: payload.current_step,
          cycle: payload.cycle,
          transportSubunit: payload.transport_subunit,
          tracks: melodicUpdates,
          drummerTracks: drummerUpdates
        });
      }
    },
    [applyBrowserClockSequencerStepEvent, syncControllerSequencerRuntime, syncSequencerRuntime]
  );

  applyBrowserClockTransportEventsRef.current = (transportEvents) => {
    const visualTrackingEnabled = activePage === "sequencer" && document.visibilityState === "visible";
    for (const transportEvent of transportEvents) {
      const auditionStates = (transportEvent.payload as { auditions?: PerformanceAuditionStatus }).auditions;
      if (auditionStates) {
        const arpIds = new Set(useAppStore.getState().sequencer.arpeggiators.map(a => a.id));
        const retained = Object.fromEntries(Object.entries(useAppStore.getState().performanceAuditions).filter(([id]) => transportEvent.kind === "arpeggiators" ? !arpIds.has(id) : arpIds.has(id)));
        useAppStore.setState({ performanceAuditions: { ...retained, ...Object.fromEntries(Object.entries(auditionStates).map(([id,value]) => [parseDrummerRowRuntimeTrackId(id)?.drummerTrackId ?? id, value])) } });
      }

      if (transportEvent.kind === "arpeggiators") {
        applyArpeggiatorStatus(transportEvent.payload.arpeggiators as SessionArpeggiatorStatus[]);
        continue;
      }
      if (transportEvent.kind === "stopped") {
        useAppStore.setState({ performanceAuditions: {} });
        auditionDefinitions.current.clear();
        previewGestures.current.clear();
      workspaceGestures.current.clear();
        cancelArrangerPreviewGestures();
        syncSequencerTransportRuntime({ isPlaying: false,
          ...sourceTransportSync(transportEvent.payload) });
        continue;
      }
      if (transportEvent.kind === "loop") {
        continue;
      }
      if (transportEvent.kind === "step" && !visualTrackingEnabled) {
        continue;
      }
      const event: SessionEvent = {
        session_id: resolveSequencerSessionId() ?? "browser-clock",
        ts: new Date().toISOString(),
        type: transportEvent.kind === "step" ? "sequencer_step" : "sequencer_pad_switches",
        payload: transportEvent.payload as SessionEvent["payload"]
      };
      if (transportEvent.kind === "step") {
        const parsed = parseSequencerStepEventPayload(event);
        if (parsed) {
          applyBrowserClockSequencerStepEvent(parsed);
        }
        continue;
      }
      const parsed = parseSequencerPadSwitchesEventPayload(event);
      if (parsed) {
        applyBrowserClockPadSwitchesEvent(parsed);
      }
    }
  };

  const configSyncErrorRef = useRef((error: unknown) => {
    setSequencerError(`${errors.failedToUpdateSequencerConfig}: ${error instanceof Error ? error.message : String(error)}`);
  });
  configSyncErrorRef.current = (error: unknown) => {
    setSequencerError(`${errors.failedToUpdateSequencerConfig}: ${error instanceof Error ? error.message : String(error)}`);
  };
  if (configSyncRef.current === null) {
    configSyncRef.current = new SequencerConfigSync(
      (sessionId, payload) => {
        const response = api.configureSessionSequencer(sessionId, payload);
        consumeSequencerEnablementCommands(useAppStore.setState, useAppStore.getState, payload);
        return response.then(async status => { await refreshAuditions.current(sessionId); return status; });
      },
      status => applySequencerStatusRef.current(status, { preserveLocalEnablement: false }),
      error => configSyncErrorRef.current(error),
      pending => { sequencerConfigSyncPendingRef.current = pending; }
    );
  }

  const syncSequencerStatusFromServer = useCallback(
    async (sessionId: string, options?: { silentError?: boolean }): Promise<void> => {
      if (sequencerPollInFlightRef.current || sequencerConfigSyncPendingRef.current || sequencerSeekPendingRef.current) {
        return;
      }

      sequencerPollInFlightRef.current = true;
      const version = transportRequestVersionRef.current;
      try {
        const status = await api.getSessionSequencerStatus(sessionId);
        if (sequencerConfigSyncPendingRef.current || sequencerSeekPendingRef.current || version !== transportRequestVersionRef.current) {
          return;
        }
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
          // Browser-clock transport deltas arrive with PCM and are released by
          // the audio worker only when their target frame becomes audible.
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

  const arpeggiatorSyncCancelRef = useRef<() => void>(() => {});
  const cancelPendingArpeggiatorEdits = useCallback(() => arpeggiatorSyncCancelRef.current(), []);

  const stopSequencerTransport = useCallback(
    async (resetPlayhead: boolean): Promise<void> => {
      for (const [id, version] of deviceCommandVersions.current) deviceCommandVersions.current.set(id, version + 1);
      for (const id of auditionCommandVersion.current.keys()) auditionCommandVersion.current.set(id, auditionCommandVersion.current.get(id)! + 1);
      previewGestures.current.clear();
      workspaceGestures.current.clear();
      cancelArrangerPreviewGestures();
      const version = ++transportRequestVersionRef.current;
      sequencerSeekPendingRef.current = false;
      configSyncRef.current?.stop();
      arpeggiatorSyncCancelRef.current();
      const sessionId = resolveSequencerSessionId();
      sequencerConfigSyncPendingRef.current = false;
      if (sessionId) {
        try {
          const status =
            effectiveAudioOutputMode === "browser_clock"
              ? await browserClockClientRef.current.stopSequencer(sessionId)
              : await api.stopSessionSequencer(sessionId);
          if (version !== transportRequestVersionRef.current) return;
          applySequencerStatus(status);
        } catch {
          if (version !== transportRequestVersionRef.current) return;
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

  const transportDevice = useCallback((deviceId: string | null, playing: boolean): Promise<void> => {
    const key = deviceId ?? "$arranger";
    if (!deviceId) {
      for (const [id, version] of deviceCommandVersions.current) deviceCommandVersions.current.set(id, version + 1);
      cancelArrangerPreviewGestures();
    } else if (!playing) {
      deviceCommandVersions.current.set("$arranger", (deviceCommandVersions.current.get("$arranger") ?? 0) + 1);
    }
    const version = (deviceCommandVersions.current.get(key) ?? 0) + 1;
    deviceCommandVersions.current.set(key, version);
    const generation = useAppStore.getState().performanceWorkspaceGeneration;
    const initialSession = useAppStore.getState().activeSessionState === "running" ? useAppStore.getState().activeSessionId : null;
    const current = () => deviceCommandVersions.current.get(key) === version &&
      useAppStore.getState().performanceWorkspaceGeneration === generation &&
      (!initialSession || useAppStore.getState().activeSessionId === initialSession);
    const affected = deviceId ? [deviceId] : [...new Set([...auditionDefinitions.current.keys(), ...previewGestures.current.keys(), ...workspaceGestures.current.keys()])];
    for (const id of affected) {
      for (const commandKey of [id, `workspace:${id}`]) auditionCommandVersion.current.set(commandKey, (auditionCommandVersion.current.get(commandKey) ?? 0) + 1);
      auditionDefinitions.current.delete(id);
      previewGestures.current.delete(id);
      workspaceGestures.current.delete(id);
    }
    const run = async () => {
      if (!current()) return;
      setSequencerError(null);
      try {
        if (playing && useAppStore.getState().activeSessionState !== "running") {
          browserClockClientRef.current.prime();
          await useAppStore.getState().startSession();
        }
        if (!current()) return;
        const store = useAppStore.getState();
        const session = store.activeSessionId;
        if (!session || store.activeSessionState !== "running") return;
        const device = [...store.sequencer.tracks, ...store.sequencer.drummerTracks,
          ...store.sequencer.controllerSequencers, ...store.sequencer.arpeggiators].find(d => d.id === deviceId);
        if (deviceId && !device) return;
        const config = playing ? buildBackendSequencerConfig(store.sequencer, "runtime", true) : undefined;
        const request: SessionDeviceTransportRequest = {
          action: playing ? "play" : "stop", config,
          ...(device ? "playbackMode" in device ? { arpeggiator_id: device.id } :
            { track_ids: "rows" in device ? device.rows.map(row => drummerRowRuntimeTrackId(device.id, row.id)) : [device.id] }
            : { arranger: true }),
          ...(device && !device.padLoopEnabled ? { pad_index: store.sequencerEditingPads[device.id] ?? device.activePad } : {}),
          position_step: Math.floor((store.sequencerRuntime.arrangerTransportSubunit ?? store.sequencerRuntime.transportSubunit) / sequencerTransportSubunitsPerStep())
        };
        if (playing) configSyncRef.current?.baseline(session, store.sequencerEditRevision);
        const result = effectiveAudioOutputModeRef.current === "browser_clock"
          ? await browserClockClientRef.current.deviceTransport(session, request)
          : await api.deviceTransport(session, request);
        if (!current() || useAppStore.getState().activeSessionId !== session) return;
        sequencerSessionIdRef.current = session;
        applySequencerStatus(result, { preserveLocalEnablement: false });
      } catch (error) {
        if (current()) setSequencerError(error instanceof Error ? error.message : String(error));
      }
    };
    // Starts prepare serially, so starting several backing devices retains every
    // command. Stop bypasses this queue to cancel preparation already in flight.
    if (!playing) return run();
    const task = deviceCommandQueue.current.then(run);
    deviceCommandQueue.current = task;
    return task;
  }, [applySequencerStatus, browserClockClientRef, buildBackendSequencerConfig, effectiveAudioOutputModeRef, setSequencerError]);

  const startSequencerTransport = useCallback(async (arrangerActive = false): Promise<void> => {
    if (arrangerActive) {
      for (const id of auditionCommandVersion.current.keys()) auditionCommandVersion.current.set(id, auditionCommandVersion.current.get(id)! + 1);
      previewGestures.current.clear();
      workspaceGestures.current.clear();
      cancelArrangerPreviewGestures();
    }
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

    const version = ++transportRequestVersionRef.current;
    sequencerSeekPendingRef.current = false;
    try {
      const store = useAppStore.getState();
      const currentSequencerState = mergedSequencerState(store.sequencer, store.sequencerRuntime);
      sequencerRef.current = currentSequencerState;
      configSyncRef.current?.baseline(sessionId, store.sequencerEditRevision);
      if (arrangerActive) auditionDefinitions.current.clear();
      const payload: SessionSequencerStartRequest = {
        arranger_active: arrangerActive,
        config: buildBackendSequencerConfig(store.sequencer, "runtime", arrangerActive),
        position_step: arrangerActive && store.sequencerRuntime.arrangerTransportSubunit !== undefined
          ? Math.floor(store.sequencerRuntime.arrangerTransportSubunit / sequencerTransportSubunitsPerStep()) : sequencerAbsoluteTransportStep(
          currentSequencerState.playhead,
          currentSequencerState.cycle,
          currentSequencerState.stepCount
        )
      };
      const status =
        effectiveAudioOutputMode === "browser_clock"
          ? await browserClockClientRef.current.startSequencer(sessionId, {
              config: payload.config,
              arrangerActive: payload.arranger_active,
              positionStep: payload.position_step
            })
          : await api.startSessionSequencer(sessionId, payload);
      if (version !== transportRequestVersionRef.current || useAppStore.getState().activeSessionId !== sessionId) return;
      sequencerSessionIdRef.current = sessionId;
      applySequencerStatus(status);
    } catch (transportError) {
      if (version !== transportRequestVersionRef.current || useAppStore.getState().activeSessionId !== sessionId) return;
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

  const seekSequencerTransport = useCallback(
    async (positionStep: number): Promise<void> => {
      const store = useAppStore.getState();
      const currentState = mergedSequencerState(store.sequencer, store.sequencerRuntime);
      const { arrangementEndStep, selection } = arrangerPlaybackBounds(currentState);
      const targetStep = clampArrangerSeekStep(
        positionStep, selection, arrangementEndStep, sequencerTransportStepsPerBeat(currentState.timing)
      );
      const moveCursor = () => {
        if (store.sequencerRuntime.independentSources) {
          useAppStore.setState(state => ({ sequencerRuntime: { ...state.sequencerRuntime,
            arrangerTransportSubunit: targetStep * sequencerTransportSubunitsPerStep() } }));
        } else setSequencerTransportAbsoluteStep(targetStep);
      };
      if (!currentState.isPlaying) {
        moveCursor();
        return;
      }
      const sessionId = resolveSequencerSessionId();
      if (!sessionId) {
        setSequencerError(errors.noActiveInstrumentSessionForSequencer);
        return;
      }
      const version = ++transportRequestVersionRef.current;
      setSequencerError(null);
      // This request includes the current authored revision, including the loop
      // change. Cancel its debounced config update so bounds and seek stay atomic.
      configSyncRef.current?.baseline(sessionId, store.sequencerEditRevision);
      sequencerSeekPendingRef.current = true;
      moveCursor();
      try {
        // Both audio modes use the same backend render-driven transport.
        const config = buildBackendSequencerConfig(store.sequencer);
        const response = api.seekSessionSequencer(sessionId, { config, position_step: targetStep });
        consumeSequencerEnablementCommands(useAppStore.setState, useAppStore.getState, config);
        const status = await response;
        if (version !== transportRequestVersionRef.current || useAppStore.getState().activeSessionId !== sessionId) return;
        applySequencerStatus(status);
      } catch (error) {
        if (version !== transportRequestVersionRef.current || useAppStore.getState().activeSessionId !== sessionId) return;
        if (!invalidateMissingRuntimeSession(sessionId, error)) {
          setSequencerError(error instanceof Error ? error.message : "Failed to move sequencer transport.");
        }
      } finally {
        if (version === transportRequestVersionRef.current) sequencerSeekPendingRef.current = false;
      }
    },
    [applySequencerStatus, buildBackendSequencerConfig, errors.noActiveInstrumentSessionForSequencer,
      invalidateMissingRuntimeSession, resolveSequencerSessionId, setSequencerError, setSequencerTransportAbsoluteStep]
  );

  const moveSequencerTransport = useCallback(
    async (deltaSteps: number): Promise<void> => {
      const currentState = sequencerRef.current;
      const { arrangementEndStep, selection } = arrangerPlaybackBounds(currentState);
      const runtime = useAppStore.getState().sequencerRuntime;
      if ((runtime.independentSources || runtime.arrangerActive === false) && runtime.arrangerTransportSubunit !== undefined) {
        await seekSequencerTransport(Math.floor(runtime.arrangerTransportSubunit / sequencerTransportSubunitsPerStep()) + deltaSteps);
        return;
      }
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
      seekSequencerTransport,
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

  const auditionDevice = useCallback<AuditionDevice>(async (deviceId, itemOrAction) => {
    if (typeof itemOrAction === "object" && "action" in itemOrAction && (itemOrAction.action === "workspace_start" || itemOrAction.action === "workspace_end")) {
      const command = itemOrAction;
      const context = auditionContext(deviceId);
      const generation = useAppStore.getState().performanceWorkspaceGeneration;
      const previous = workspaceGestures.current.get(deviceId);
      if (command.action === "workspace_end" && previous?.gesture !== command.gestureId) return;
      const entry = { gesture: command.gestureId, generation, session: previous?.session };
      if (command.action === "workspace_start") workspaceGestures.current.set(deviceId, entry);
      else workspaceGestures.current.delete(deviceId);
      const versionKey = `workspace:${deviceId}`;
      const version = (auditionCommandVersion.current.get(versionKey) ?? 0) + 1;
      auditionCommandVersion.current.set(versionKey, version);
      const current = () => auditionContext(deviceId) === context && useAppStore.getState().performanceWorkspaceGeneration === generation && auditionCommandVersion.current.get(versionKey) === version &&
        (command.action === "workspace_start" ? workspaceGestures.current.get(deviceId) === entry : !workspaceGestures.current.has(deviceId));
      try {
        const initial = useAppStore.getState();
        const device = [...initial.sequencer.tracks, ...initial.sequencer.drummerTracks, ...initial.sequencer.controllerSequencers, ...initial.sequencer.arpeggiators].find(d => d.id === deviceId);
        if (!device) return;
        const sequence = command.action === "workspace_start" ? compilePadLoopPattern({ ...device.padLoopPattern, rootSequence: command.items ?? [] }).sequence : [];
        if (command.action === "workspace_start" && !sequence.length) throw new Error("An audition requires a playable sequence.");
        if (command.action === "workspace_start" && initial.activeSessionState !== "running") {
          void browserClockClientRef.current.prime();
          await initial.startSession();
        }
        const store = useAppStore.getState();
        const session = store.activeSessionId;
        if (!current()) return;
        if (!session || store.activeSessionState !== "running") {
          if (command.action === "workspace_end") return;
          throw new Error(errors.noActiveRuntimeSession);
        }
        if (entry.session && entry.session !== session) return;
        entry.session = session;
        const request: SessionAuditionRequest = { action: command.action, gesture_id: command.gestureId, revision: version,
          ...("playbackMode" in device ? { arpeggiator_id: deviceId } : { track_ids: "rows" in device ? device.rows.map(row => drummerRowRuntimeTrackId(deviceId, row.id)) : [deviceId] }), sequence };
        if (!previous || command.action === "workspace_end") {
          previewGestures.current.delete(deviceId);
          auditionCommandVersion.current.set(deviceId, (auditionCommandVersion.current.get(deviceId) ?? 0) + 1);
        }
        if (command.action === "workspace_start") {
          configSyncRef.current?.baseline(session, store.sequencerEditRevision);
          await api.configureSessionSequencer(session, buildBackendSequencerConfig(store.sequencer));
          if (!current() || useAppStore.getState().activeSessionId !== session) return;
        }
        const status = effectiveAudioOutputModeRef.current === "browser_clock"
          ? await browserClockClientRef.current.audition(session, request) : await api.auditionSequence(session, request);
        if (current() && useAppStore.getState().activeSessionId === session) applySequencerStatus(status);
      } catch (error) {
        if (current()) {
          if (previous) workspaceGestures.current.set(deviceId, previous);
          else workspaceGestures.current.delete(deviceId);
          setSequencerError(error instanceof Error ? error.message : String(error));
          throw error;
        }
      }
      return;
    }
    const preview = typeof itemOrAction === "object" && "action" in itemOrAction
      ? itemOrAction as PreviewCommand : null;
    if (preview?.action === "preview_arm") { void browserClockClientRef.current.prime(); return; }
    if (!preview) {
      workspaceGestures.current.delete(deviceId);
      const key = `workspace:${deviceId}`;
      auditionCommandVersion.current.set(key, (auditionCommandVersion.current.get(key) ?? 0) + 1);
    }
    const context = auditionContext(deviceId);
    const existingGesture = previewGestures.current.get(deviceId);
    if (preview?.action === "preview_end" && existingGesture?.gesture !== preview.gestureId) return;
    const version = (auditionCommandVersion.current.get(deviceId) ?? 0) + 1;
    auditionCommandVersion.current.set(deviceId, version);
    const generation = useAppStore.getState().performanceWorkspaceGeneration;
    if (preview?.action === "preview_start") previewGestures.current.set(deviceId, { gesture: preview.gestureId, generation });
    else previewGestures.current.delete(deviceId);
    let commandSession: string | null = null;
    try {
      const item = typeof itemOrAction === "object" && "type" in itemOrAction ? itemOrAction : preview?.item ?? null;
      const previousDefinition = auditionDefinitions.current.get(deviceId);
      if (!preview && previousDefinition && !useAppStore.getState().performanceAuditions[deviceId]?.queued) {
        previousDefinition.replacing = false;
        previousDefinition.previous = undefined;
      }
      if (item && useAppStore.getState().activeSessionState !== "running") {
        void browserClockClientRef.current.prime();
        await useAppStore.getState().startSession();
      }
      const store = useAppStore.getState();
      const sessionId = store.activeSessionId;
      commandSession = sessionId;
      if (auditionContext(deviceId) !== context || generation !== store.performanceWorkspaceGeneration || auditionCommandVersion.current.get(deviceId) !== version) return;
      if (preview?.action === "preview_end" && (!sessionId || store.activeSessionState !== "running" || existingGesture?.session && existingGesture.session !== sessionId)) return;
      if (!sessionId || store.activeSessionState !== "running") throw new Error(errors.noActiveRuntimeSession);
      const gesture = previewGestures.current.get(deviceId);
      if (gesture) gesture.session = sessionId;
      const current = () => auditionContext(deviceId) === context && useAppStore.getState().activeSessionId === sessionId && useAppStore.getState().performanceWorkspaceGeneration === generation && auditionCommandVersion.current.get(deviceId) === version;
      const device = [...store.sequencer.tracks, ...store.sequencer.drummerTracks, ...store.sequencer.controllerSequencers, ...store.sequencer.arpeggiators].find(d => d.id === deviceId);
      if (!device) return;
      const request: SessionAuditionRequest = { action: preview ? preview.action as "preview_start" | "preview_end" : item ? "start" : itemOrAction as SessionAuditionRequest["action"],
        ...(preview ? { gesture_id: preview.gestureId, revision: version } : {}),
        ...("playbackMode" in device ? { arpeggiator_id: deviceId } : { track_ids: "rows" in device ? device.rows.map(row => drummerRowRuntimeTrackId(deviceId, row.id)) : [deviceId] }) };
      if (item) {
        request.sequence = compileDefinition(device.padLoopPattern, item);
        if (!request.sequence.length) return;
        // Compilation finishes before a new override can replace audible material.
        configSyncRef.current?.baseline(sessionId, store.sequencerEditRevision);
        await api.configureSessionSequencer(sessionId, buildBackendSequencerConfig(store.sequencer));
        if (!current()) return;
      }
      const status = effectiveAudioOutputModeRef.current === "browser_clock"
        ? await browserClockClientRef.current.audition(sessionId, request)
        : await api.auditionSequence(sessionId, request);
      if (!current()) return;
      const transition = status.auditions?.[request.arpeggiator_id ?? request.track_ids?.[0] ?? deviceId];
      const existing = auditionDefinitions.current.get(deviceId);
      if (preview) {
        const entry = previewGestures.current.get(deviceId);
        if (entry && item) entry.definition = { item, sequence: JSON.stringify(request.sequence), request };
      } else if (item) auditionDefinitions.current.set(deviceId, { item, sequence: JSON.stringify(request.sequence), request,
        replacing: transition?.queued === "start",
        previous: transition?.active && transition.queued === "start" ? existing?.replacing ? existing.previous : existing : undefined });
      else if (request.action === "stop") auditionDefinitions.current.delete(deviceId);
      else if (request.action === "cancel" && existing?.replacing) {
        if (existing.previous) auditionDefinitions.current.set(deviceId, existing.previous);
        else auditionDefinitions.current.delete(deviceId);
      }
      sequencerSessionIdRef.current = sessionId;
      applySequencerStatus(status);
    } catch (error) {
      if (useAppStore.getState().performanceWorkspaceGeneration === generation && auditionCommandVersion.current.get(deviceId) === version && (!commandSession || useAppStore.getState().activeSessionId === commandSession)) setSequencerError(error instanceof Error ? error.message : String(error));
    }
  }, [applySequencerStatus, browserClockClientRef, buildBackendSequencerConfig, effectiveAudioOutputModeRef, errors.noActiveRuntimeSession, setSequencerError]);

  refreshAuditions.current = async sessionId => {
    const previews = [...previewGestures.current].flatMap(([id, entry]) => entry.definition ? [[id, entry.definition] as const] : []);
    for (const [id, audition] of [...auditionDefinitions.current, ...previews]) {
      const preview = audition.request.action === "preview_start";
      if (!preview && (previewGestures.current.has(id) || workspaceGestures.current.has(id))) continue;
      if (useAppStore.getState().activeSessionId !== sessionId) return;
      if (!useAppStore.getState().performanceAuditions[id]) { auditionDefinitions.current.delete(id); continue; }
      const transition = useAppStore.getState().performanceAuditions[id];
      if (!transition.queued) { audition.previous = undefined; audition.replacing = false; }
      if (transition.queued === "return") continue;
      const seq = useAppStore.getState().sequencer;
      const device = [...seq.tracks, ...seq.drummerTracks, ...seq.controllerSequencers, ...seq.arpeggiators].find(d => d.id === id);
      if (!device) { auditionDefinitions.current.delete(id); continue; }
      const sequence = compileDefinition(device.padLoopPattern, audition.item);
      if (JSON.stringify(sequence) === audition.sequence) continue;
      const version = (auditionCommandVersion.current.get(id) ?? 0) + 1;
      if (preview) auditionCommandVersion.current.set(id, version);
      const request: SessionAuditionRequest = { ...audition.request,
        action: sequence.length ? preview ? "preview_start" : "start" : preview ? "preview_end" : "stop", sequence,
        ...(preview ? { revision: version } : {}) };
      await api.auditionSequence(sessionId, request);
      if (sequence.length) audition.sequence = JSON.stringify(sequence);
      else if (preview) previewGestures.current.delete(id);
      else auditionDefinitions.current.delete(id);
    }
  };

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

  const markSequencerConfigSyncPending = useCallback((): void => {
    // Run after the authoring action, so a no-op cannot leave polling suspended.
    queueMicrotask(() => {
      const state = useAppStore.getState();
      const sessionId = state.activeSessionId;
      if (sessionId && configSyncRef.current?.needsEdit(sessionId, state.sequencerEditRevision)) {
        sequencerConfigSyncPendingRef.current = true;
      }
    });
  }, []);

  const bundledArpeggiatorEdit = useRef<{ sessionId: string; signature: string } | null>(null);
  const arpeggiatorConfigSyncSignature = useMemo(() => {
    if (activeSessionState !== "running") {
      return null;
    }
    return JSON.stringify(buildBackendArpeggiatorConfig(sequencerConfig));
  }, [activeSessionState, buildBackendArpeggiatorConfig, sequencerConfig]);

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
    if (!sequencer.isPlaying || activeSessionState !== "running") return;
    const sessionId = resolveSequencerSessionId();
    if (sessionId && configSyncRef.current?.needsEdit(sessionId, authoredRevision)) {
      try {
        const payload = buildBackendSequencerConfig(sequencerConfig);
        if (payload.arpeggiators) {
          // The combined request prepares these lanes together. A second, standalone
          // arpeggiator request could otherwise apply half of a multitrack range edit.
          arpeggiatorSyncCancelRef.current();
          bundledArpeggiatorEdit.current = { sessionId, signature: JSON.stringify({ tempo_bpm: payload.timing.tempo_bpm, arpeggiators: payload.arpeggiators }) };
        }
        configSyncRef.current.edit(sessionId, authoredRevision, payload);
      } catch (error) {
        // Consume this revision without retrying on playback/status renders.
        configSyncRef.current.baseline(sessionId, authoredRevision);
        configSyncErrorRef.current(error);
      }
    }
  }, [activeSessionState, authoredRevision, buildBackendSequencerConfig, resolveSequencerSessionId, sequencer.isPlaying, sequencerConfig]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      configSyncRef.current?.stop();
      bundledArpeggiatorEdit.current = null;
    }
  }, [sequencer.isPlaying]);

  useEffect(() => () => {
    transportRequestVersionRef.current += 1;
    sequencerSeekPendingRef.current = false;
    configSyncRef.current?.stop();
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionState !== "running" || !arpeggiatorConfigSyncSignature) {
      bundledArpeggiatorEdit.current = null;
      return;
    }

    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }

    if (bundledArpeggiatorEdit.current?.sessionId === sessionId && bundledArpeggiatorEdit.current.signature === arpeggiatorConfigSyncSignature) return;
    bundledArpeggiatorEdit.current = null;

    let cancelled = false;
    const payload = JSON.parse(arpeggiatorConfigSyncSignature) as SessionArpeggiatorConfigRequest;
    const syncTimer = window.setTimeout(() => {
      void api
        .configureSessionArpeggiators(sessionId, payload)
        .then(async (status) => {
          if (!cancelled) { await refreshAuditions.current(sessionId); applyArpeggiatorStatus(status); }
        })
        .catch((syncError) => {
          if (cancelled) return;
          if (invalidateMissingRuntimeSession(sessionId, syncError)) {
            return;
          }
          setSequencerError(
            syncError instanceof Error
              ? `${errors.failedToUpdateSequencerConfig}: ${syncError.message}`
              : errors.failedToUpdateSequencerConfig
          );
        });
    }, 80);

    const cancel = () => {
      cancelled = true;
      window.clearTimeout(syncTimer);
    };
    arpeggiatorSyncCancelRef.current = cancel;
    return cancel;
  }, [
    activeSessionId,
    activeSessionState,
    applyArpeggiatorStatus,
    arpeggiatorConfigSyncSignature,
    errors.failedToUpdateSequencerConfig,
    invalidateMissingRuntimeSession,
    setSequencerError
  ]);

  useEffect(() => {
    if (useAppStore.getState().sequencerRuntime.independentSources || !sequencer.isPlaying || sequencerConfigSyncPendingRef.current) {
      return;
    }
    if (
      sequencer.tracks.some((track) => track.enabled || track.queuedEnabled === true) ||
      sequencer.drummerTracks.some((track) => track.enabled || track.queuedEnabled === true) ||
      sequencer.controllerSequencers.some((controllerSequencer) => controllerSequencer.enabled) ||
      sequencer.arpeggiators.some(arp => arp.enabled && arp.playbackMode === "arranger")
    ) {
      return;
    }
    void stopSequencerTransport(false);
  }, [
    sequencer.arpeggiators,
    sequencer.controllerSequencers,
    sequencer.drummerTracks,
    sequencer.isPlaying,
    sequencer.tracks,
    stopSequencerTransport
  ]);

  useEffect(() => {
    if (!sequencer.isPlaying) {
      return;
    }

    if (activeSessionState !== "running") {
      void stopSequencerTransport(false);
      setSequencerError(errors.sessionNotRunningSequencerStopped);
    }
  }, [
    activeSessionState,
    errors.sessionNotRunningSequencerStopped,
    sequencer.isPlaying,
    setSequencerError,
    stopSequencerTransport
  ]);

  const stopSequencerTransportRef = useRef(stopSequencerTransport);
  stopSequencerTransportRef.current = stopSequencerTransport;
  useEffect(() => () => {
    void stopSequencerTransportRef.current(false);
  }, []);

  return {
    transportDevice,
    auditionDevice,
    cancelPendingArpeggiatorEdits,
    browserAudioError,
    browserAudioDiagnostics,
    browserAudioStatus,
    browserAudioTransport,
    displayedSequencer,
    displayedSequencerTransportSubunit,
    readPlaybackTransportSubunit,
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
    moveSequencerTransport,
    seekSequencerTransport,
    markSequencerConfigSyncPending
  };
}
