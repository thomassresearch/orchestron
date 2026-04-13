import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { api } from "../api/client";
import { BrowserClockAudioClient } from "../lib/browserClockAudio";
import type {
  BrowserClockLatencySettings,
  RuntimeConfigResponse,
  SessionAudioOutputMode,
  SessionEvent,
  SessionSequencerStatus,
  SequencerRuntimeState,
  SequencerState
} from "../types";

type BrowserAudioStatus = "off" | "connecting" | "live" | "error";

interface UseBrowserClockAudioControllerParams {
  applySequencerStatusRef: MutableRefObject<(status: SessionSequencerStatus) => void>;
  browserClockLatencySettings: BrowserClockLatencySettings;
  events: SessionEvent[];
  sequencer: SequencerState;
  sequencerRuntime: SequencerRuntimeState;
  setBrowserClockLatencySettings: (settings: BrowserClockLatencySettings) => void;
}

interface UseBrowserClockAudioControllerResult {
  browserClockClientRef: MutableRefObject<BrowserClockAudioClient>;
  browserAudioError: string | null;
  browserAudioStatus: BrowserAudioStatus;
  browserAudioTransport: "browser_clock" | "off";
  disconnectBrowserAudio: () => void;
  disconnectBrowserClockAudio: () => void;
  displayedSequencer: SequencerState;
  displayedSequencerTransportSubunit: number;
  effectiveAudioOutputMode: SessionAudioOutputMode | null;
  effectiveAudioOutputModeRef: MutableRefObject<SessionAudioOutputMode | null>;
  onApplyBrowserClockLatencySettings: (settings: BrowserClockLatencySettings) => void;
  reportBrowserAudioConnectionError: (error: unknown) => void;
  resetBrowserAudioState: () => void;
  runtimeAudioOutputMode: SessionAudioOutputMode | null;
}

function transportPositionFromTransportSubunit(transportSubunit: number, stepCount: number): {
  playhead: number;
  cycle: number;
} {
  const boundedStepCount = Math.max(1, Math.round(stepCount));
  const absoluteStep = Math.max(0, Math.floor(transportSubunit / 420));
  return {
    playhead: absoluteStep % boundedStepCount,
    cycle: Math.floor(absoluteStep / boundedStepCount)
  };
}

export function useBrowserClockAudioController({
  applySequencerStatusRef,
  browserClockLatencySettings,
  events,
  sequencer,
  sequencerRuntime,
  setBrowserClockLatencySettings
}: UseBrowserClockAudioControllerParams): UseBrowserClockAudioControllerResult {
  const runtimeConfigRef = useRef<RuntimeConfigResponse | null>(null);
  const runtimeConfigPromiseRef = useRef<Promise<RuntimeConfigResponse> | null>(null);
  const browserClockLatencySettingsRef = useRef(browserClockLatencySettings);
  const [browserClockPlaybackTransportSubunit, setBrowserClockPlaybackTransportSubunit] = useState<number | null>(null);
  const [browserAudioStatus, setBrowserAudioStatus] = useState<BrowserAudioStatus>("off");
  const [browserAudioError, setBrowserAudioError] = useState<string | null>(null);
  const [runtimeAudioOutputMode, setRuntimeAudioOutputMode] = useState<SessionAudioOutputMode | null>(null);

  useEffect(() => {
    browserClockLatencySettingsRef.current = browserClockLatencySettings;
  }, [browserClockLatencySettings]);

  const browserClockClient = useMemo(
    () =>
      new BrowserClockAudioClient({
        onStatusChange: setBrowserAudioStatus,
        onErrorChange: setBrowserAudioError,
        onSequencerStatus: (status) => {
          applySequencerStatusRef.current(status);
        },
        getLatencySettings: () => browserClockLatencySettingsRef.current
      }),
    [applySequencerStatusRef]
  );
  const browserClockClientRef = useRef(browserClockClient);

  const onApplyBrowserClockLatencySettings = useCallback(
    (settings: BrowserClockLatencySettings) => {
      setBrowserClockLatencySettings(settings);
      if (runtimeAudioOutputMode === "browser_clock") {
        browserClockClientRef.current.refreshLatencySettings();
      }
    },
    [runtimeAudioOutputMode, setBrowserClockLatencySettings]
  );

  const latestStartedEvent = useMemo<SessionEvent | null>(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === "started") {
        return event;
      }
    }
    return null;
  }, [events]);

  const latestStartedAudioMode = useMemo<SessionAudioOutputMode | null>(() => {
    const raw = latestStartedEvent?.payload?.audio_mode;
    return raw === "browser_clock" || raw === "local" ? raw : null;
  }, [latestStartedEvent]);

  const effectiveAudioOutputMode = latestStartedAudioMode ?? runtimeAudioOutputMode;
  const browserAudioTransport = effectiveAudioOutputMode === "browser_clock" ? "browser_clock" : "off";
  const effectiveAudioOutputModeRef = useRef<SessionAudioOutputMode | null>(effectiveAudioOutputMode);

  useEffect(() => {
    effectiveAudioOutputModeRef.current = effectiveAudioOutputMode;
  }, [effectiveAudioOutputMode]);

  const displayedSequencerTransportSubunit = useMemo(() => {
    if (effectiveAudioOutputMode !== "browser_clock" || !sequencer.isPlaying) {
      return sequencerRuntime.transportSubunit;
    }
    return browserClockPlaybackTransportSubunit ?? sequencerRuntime.transportSubunit;
  }, [
    browserClockPlaybackTransportSubunit,
    effectiveAudioOutputMode,
    sequencer.isPlaying,
    sequencerRuntime.transportSubunit
  ]);

  const displayedSequencer = useMemo(() => {
    if (effectiveAudioOutputMode !== "browser_clock" || !sequencer.isPlaying) {
      return sequencer;
    }

    const { playhead, cycle } = transportPositionFromTransportSubunit(
      displayedSequencerTransportSubunit,
      sequencer.stepCount
    );
    if (playhead === sequencer.playhead && cycle === sequencer.cycle) {
      return sequencer;
    }

    return {
      ...sequencer,
      playhead,
      cycle
    };
  }, [displayedSequencerTransportSubunit, effectiveAudioOutputMode, sequencer]);

  useEffect(() => {
    if (effectiveAudioOutputMode !== "browser_clock" || !sequencer.isPlaying) {
      setBrowserClockPlaybackTransportSubunit(null);
      return;
    }

    const syncPlaybackTransport = () => {
      const transportSubunit = browserClockClientRef.current.getPlaybackTransportSubunit();
      setBrowserClockPlaybackTransportSubunit((previous) => {
        if (transportSubunit === null || transportSubunit === undefined) {
          return previous;
        }
        return previous !== null && Math.abs(previous - transportSubunit) < 0.25 ? previous : transportSubunit;
      });
    };

    syncPlaybackTransport();
    const timer = window.setInterval(syncPlaybackTransport, 30);
    return () => {
      window.clearInterval(timer);
    };
  }, [effectiveAudioOutputMode, sequencer.isPlaying]);

  const disconnectBrowserClockAudio = useCallback(() => {
    void browserClockClientRef.current.disconnect();
  }, []);

  const disconnectBrowserAudio = useCallback(() => {
    disconnectBrowserClockAudio();
  }, [disconnectBrowserClockAudio]);

  const resetBrowserAudioState = useCallback(() => {
    setBrowserAudioStatus("off");
    setBrowserAudioError(null);
  }, []);

  const reportBrowserAudioConnectionError = useCallback((error: unknown) => {
    setBrowserAudioStatus("error");
    setBrowserAudioError(error instanceof Error ? error.message : "Failed to connect browser PCM runtime.");
  }, []);

  const loadRuntimeConfig = useCallback(async (): Promise<RuntimeConfigResponse> => {
    if (runtimeConfigRef.current) {
      return runtimeConfigRef.current;
    }
    if (runtimeConfigPromiseRef.current) {
      return runtimeConfigPromiseRef.current;
    }

    const pending = api
      .getRuntimeConfig()
      .then((runtimeConfig) => {
        runtimeConfigRef.current = runtimeConfig;
        runtimeConfigPromiseRef.current = null;
        setRuntimeAudioOutputMode(runtimeConfig.audio_output_mode);
        return runtimeConfig;
      })
      .catch((error) => {
        runtimeConfigPromiseRef.current = null;
        throw error;
      });

    runtimeConfigPromiseRef.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    void loadRuntimeConfig().catch(() => {
      // Runtime mode discovery is best-effort here; the session "started" event remains authoritative.
    });
  }, [loadRuntimeConfig]);

  useEffect(() => {
    return () => {
      void browserClockClient.disconnect();
    };
  }, [browserClockClient]);

  return {
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
  };
}
