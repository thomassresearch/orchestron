import { isApiError } from "../api/client";
import type {
  DrummerSequencerTrackState,
  SessionEvent,
  SessionSequencerTrackStatus
} from "../types";

export type SequencerRuntimeTrackDelta = {
  track_id: string;
  local_step: number | null;
};

export type ControllerSequencerRuntimeDelta = {
  track_id: string;
  runtime_pad_start_subunit: number | null;
};

export type SequencerStepEventPayload = {
  previous_step: number;
  current_step: number;
  cycle: number;
  running: boolean;
  step_count: number;
  transport_subunit: number;
  tracks: SequencerRuntimeTrackDelta[];
  controller_tracks: ControllerSequencerRuntimeDelta[];
};

export type SequencerPadSwitchEventPayload = {
  track_id: string;
  track_kind?: "note" | "controller";
  active_pad: number;
  cycle: number;
  current_step: number;
  running: boolean;
  step_count: number;
  transport_subunit: number;
  tracks: SequencerRuntimeTrackDelta[];
  controller_tracks: ControllerSequencerRuntimeDelta[];
  local_step?: number | null;
  queued_pad?: number | null;
  pad_loop_position?: number | null;
  enabled?: boolean;
  queued_enabled?: boolean | null;
  runtime_pad_start_subunit?: number | null;
};

export type SequencerPadSwitch = Pick<
  SequencerPadSwitchEventPayload,
  | "track_id"
  | "track_kind"
  | "active_pad"
  | "local_step"
  | "queued_pad"
  | "pad_loop_position"
  | "enabled"
  | "queued_enabled"
  | "runtime_pad_start_subunit"
>;

export type SequencerPadSwitchesEventPayload = Omit<SequencerStepEventPayload, "previous_step"> & {
  switches: SequencerPadSwitch[];
};

export type BrowserClockQueuedTransportEvent =
  | {
      kind: "step";
      transportSubunit: number;
      payload: SequencerStepEventPayload;
    }
  | {
      kind: "pad_switch";
      transportSubunit: number;
      payload: SequencerPadSwitchEventPayload;
    }
  | {
      kind: "pad_switches";
      transportSubunit: number;
      payload: SequencerPadSwitchesEventPayload;
    };

export type DrummerRuntimeTrackStatusUpdate = {
  trackId: string;
  stepCount?: number;
  localStep?: number;
  runtimePadStartSubunit?: number | null;
  activePad?: number;
  queuedPad?: number | null;
  padLoopPosition?: number | null;
  enabled?: boolean;
  queuedEnabled?: boolean | null;
};

export type DrummerRuntimeLocalStepUpdate = {
  trackId: string;
  localStep?: number | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || isFiniteNumber(value);
}

function isOptionalBoolean(value: unknown): value is boolean | null | undefined {
  return value === undefined || value === null || typeof value === "boolean";
}

function parseSequencerRuntimeTrackDeltas(value: unknown): SequencerRuntimeTrackDelta[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const tracks: SequencerRuntimeTrackDelta[] = [];
  for (const entry of value) {
    if (
      !isObjectRecord(entry) ||
      typeof entry.track_id !== "string" ||
      !isOptionalFiniteNumber(entry.local_step)
    ) {
      return null;
    }
    tracks.push({
      track_id: entry.track_id,
      local_step: entry.local_step ?? null
    });
  }

  return tracks;
}

function parseControllerSequencerRuntimeDeltas(value: unknown): ControllerSequencerRuntimeDelta[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const tracks: ControllerSequencerRuntimeDelta[] = [];
  for (const entry of value) {
    if (
      !isObjectRecord(entry) ||
      typeof entry.track_id !== "string" ||
      !isOptionalFiniteNumber(entry.runtime_pad_start_subunit)
    ) {
      return null;
    }
    tracks.push({
      track_id: entry.track_id,
      runtime_pad_start_subunit: entry.runtime_pad_start_subunit ?? null
    });
  }

  return tracks;
}

export function parseSequencerStepEventPayload(event: SessionEvent): SequencerStepEventPayload | null {
  if (event.type !== "sequencer_step") {
    return null;
  }

  const { payload } = event;
  const tracks = parseSequencerRuntimeTrackDeltas(payload.tracks);
  const controllerTracks = parseControllerSequencerRuntimeDeltas(payload.controller_tracks);
  if (
    !isFiniteNumber(payload.previous_step) ||
    !isFiniteNumber(payload.current_step) ||
    !isFiniteNumber(payload.cycle) ||
    typeof payload.running !== "boolean" ||
    !isFiniteNumber(payload.step_count) ||
    !isFiniteNumber(payload.transport_subunit) ||
    tracks === null ||
    controllerTracks === null
  ) {
    return null;
  }

  return {
    previous_step: payload.previous_step,
    current_step: payload.current_step,
    cycle: payload.cycle,
    running: payload.running,
    step_count: payload.step_count,
    transport_subunit: payload.transport_subunit,
    tracks,
    controller_tracks: controllerTracks
  };
}

function parseSequencerPadSwitch(value: unknown): SequencerPadSwitch | null {
  if (!isObjectRecord(value)) {
    return null;
  }
  if (
    typeof value.track_id !== "string" ||
    !isFiniteNumber(value.active_pad) ||
    !isOptionalFiniteNumber(value.local_step) ||
    !isOptionalFiniteNumber(value.queued_pad) ||
    !isOptionalFiniteNumber(value.pad_loop_position) ||
    !isOptionalBoolean(value.enabled) ||
    !isOptionalBoolean(value.queued_enabled) ||
    !isOptionalFiniteNumber(value.runtime_pad_start_subunit)
  ) {
    return null;
  }

  return {
    track_id: value.track_id,
    track_kind: value.track_kind === "controller" ? "controller" : value.track_kind === "note" ? "note" : undefined,
    active_pad: value.active_pad,
    local_step: value.local_step ?? undefined,
    queued_pad: value.queued_pad ?? undefined,
    pad_loop_position: value.pad_loop_position ?? undefined,
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
    queued_enabled:
      typeof value.queued_enabled === "boolean" || value.queued_enabled === null
        ? value.queued_enabled
        : undefined,
    runtime_pad_start_subunit: value.runtime_pad_start_subunit ?? undefined
  };
}

function parseSequencerRuntimeDelta(
  payload: Record<string, unknown>
): Omit<SequencerStepEventPayload, "previous_step"> | null {
  const tracks = parseSequencerRuntimeTrackDeltas(payload.tracks);
  const controllerTracks = parseControllerSequencerRuntimeDeltas(payload.controller_tracks);
  if (
    !isFiniteNumber(payload.cycle) ||
    !isFiniteNumber(payload.current_step) ||
    typeof payload.running !== "boolean" ||
    !isFiniteNumber(payload.step_count) ||
    !isFiniteNumber(payload.transport_subunit) ||
    tracks === null ||
    controllerTracks === null
  ) {
    return null;
  }

  return {
    cycle: payload.cycle,
    current_step: payload.current_step,
    running: payload.running,
    step_count: payload.step_count,
    transport_subunit: payload.transport_subunit,
    tracks,
    controller_tracks: controllerTracks
  };
}

export function parseSequencerPadSwitchEventPayload(event: SessionEvent): SequencerPadSwitchEventPayload | null {
  if (event.type !== "sequencer_pad_switched") {
    return null;
  }

  const delta = parseSequencerRuntimeDelta(event.payload);
  const switchPayload = parseSequencerPadSwitch(event.payload);
  if (delta === null || switchPayload === null) {
    return null;
  }

  return {
    ...switchPayload,
    ...delta
  };
}

export function parseSequencerPadSwitchesEventPayload(event: SessionEvent): SequencerPadSwitchesEventPayload | null {
  if (event.type !== "sequencer_pad_switches") {
    return null;
  }

  const delta = parseSequencerRuntimeDelta(event.payload);
  if (delta === null || !Array.isArray(event.payload.switches)) {
    return null;
  }

  const switches: SequencerPadSwitch[] = [];
  for (const entry of event.payload.switches) {
    const parsed = parseSequencerPadSwitch(entry);
    if (parsed === null) {
      return null;
    }
    switches.push(parsed);
  }

  return { ...delta, switches };
}

export function shouldLogSessionEvent(eventType: string): boolean {
  return (
    eventType !== "sequencer_step" &&
    eventType !== "sequencer_pad_switched" &&
    eventType !== "sequencer_pad_switches"
  );
}

export function isSessionNotFoundApiError(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

export function drummerRowRuntimeTrackId(drummerTrackId: string, rowId: string): string {
  return `drumrow:${drummerTrackId}:${rowId}`;
}

export function parseDrummerRowRuntimeTrackId(trackId: string): { drummerTrackId: string; rowId: string } | null {
  if (!trackId.startsWith("drumrow:")) {
    return null;
  }

  const parts = trackId.split(":");
  if (parts.length !== 3 || parts[1].trim().length === 0 || parts[2].trim().length === 0) {
    return null;
  }

  return {
    drummerTrackId: parts[1],
    rowId: parts[2]
  };
}

export function aggregateDrummerRuntimeTrackStatuses(
  backendTracks: SessionSequencerTrackStatus[],
  drummerTracks: DrummerSequencerTrackState[]
): DrummerRuntimeTrackStatusUpdate[] {
  const validIds = new Set(drummerTracks.map((track) => track.id));
  const byTrackId = new Map<string, DrummerRuntimeTrackStatusUpdate>();

  for (const statusTrack of backendTracks) {
    const parsed = parseDrummerRowRuntimeTrackId(statusTrack.track_id);
    if (!parsed || !validIds.has(parsed.drummerTrackId) || byTrackId.has(parsed.drummerTrackId)) {
      continue;
    }

    byTrackId.set(parsed.drummerTrackId, {
      trackId: parsed.drummerTrackId,
      stepCount: statusTrack.step_count,
      localStep: statusTrack.local_step,
      runtimePadStartSubunit: statusTrack.runtime_pad_start_subunit,
      activePad: statusTrack.active_pad,
      queuedPad: statusTrack.queued_pad,
      padLoopPosition: statusTrack.pad_loop_position,
      enabled: statusTrack.enabled,
      queuedEnabled: statusTrack.queued_enabled
    });
  }

  return Array.from(byTrackId.values());
}

export function aggregateDrummerRuntimeTrackLocalSteps(
  backendTracks: SequencerRuntimeTrackDelta[],
  drummerTracks: DrummerSequencerTrackState[]
): DrummerRuntimeLocalStepUpdate[] {
  const validIds = new Set(drummerTracks.map((track) => track.id));
  const byTrackId = new Map<string, DrummerRuntimeLocalStepUpdate>();

  for (const statusTrack of backendTracks) {
    const parsed = parseDrummerRowRuntimeTrackId(statusTrack.track_id);
    if (!parsed || !validIds.has(parsed.drummerTrackId) || byTrackId.has(parsed.drummerTrackId)) {
      continue;
    }

    byTrackId.set(parsed.drummerTrackId, {
      trackId: parsed.drummerTrackId,
      localStep: statusTrack.local_step
    });
  }

  return Array.from(byTrackId.values());
}
