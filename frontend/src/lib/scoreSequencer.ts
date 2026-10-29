import type { ScoreNoteState, ScorePadState, ScoreTrackState, SequencerState, SequencerTimingConfig, SessionScoreTrackConfig } from "../types";
import { defaultSequencerTrack, normalizeSequencerTrackWithTiming } from "../store/appStoreModel";
import { compileArrangerTransportSequence } from "./arrangerTransport";

export const SCORE_TICKS_PER_QUARTER = 20160;
export const SCORE_MAX_BEATS = 8192;
export const SCORE_MAX_PAD_NOTES = 10000;
export const SCORE_MAX_TOTAL_NOTES = 50000;
export const scoreBeatTicks = (timing: SequencerTimingConfig) => SCORE_TICKS_PER_QUARTER * 4 / timing.meterDenominator;
export const scoreLengthTicks = (pad: ScorePadState, timing: SequencerTimingConfig) => pad.lengthBeats * scoreBeatTicks(timing);
export const scoreHasContent = (pad: ScorePadState, timing: SequencerTimingConfig) => pad.notes.some(n => n.velocity > 0 && n.startTicks < scoreLengthTicks(pad, timing));

export function defaultScoreTrack(index: number, timing: SequencerTimingConfig): ScoreTrackState {
  const base = defaultSequencerTrack(index, index, timing);
  const lengthBeats = timing.meterNumerator * 4;
  return { ...base, id: `score-${crypto.randomUUID()}`, name: `Score Sequencer ${index}`, lengthBeats,
    stepCount: lengthBeats * timing.stepsPerBeat, steps: [], launchQuantization: "bar",
    pads: base.pads.map(p => ({ ...p, lengthBeats, stepCount: lengthBeats * timing.stepsPerBeat, steps: [], notes: [] })) };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function integer(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid score ${name}.`);
  return value;
}
export function normalizeScoreNote(raw: unknown): ScoreNoteState {
  const n = record(raw);
  if (typeof n.id !== "string" || !n.id || n.id.length > 128) throw new Error("Invalid score note ID.");
  return { id: n.id, pitch: integer(n.pitch, 0, 127, "pitch"), velocity: integer(n.velocity ?? 100, 0, 127, "velocity"),
    startTicks: integer(n.startTicks, 0, SCORE_MAX_BEATS * SCORE_TICKS_PER_QUARTER - 1, "start"),
    durationTicks: integer(n.durationTicks, 1, SCORE_MAX_BEATS * SCORE_TICKS_PER_QUARTER, "duration") };
}

export function normalizeScoreTrack(raw: unknown, index: number, timing: SequencerTimingConfig): ScoreTrackState {
  const value = record(raw);
  const base = normalizeSequencerTrackWithTiming({ ...value, lengthBeats: 4, pads: [] }, index, timing);
  const inputs = Array.isArray(value.pads) ? value.pads : [];
  if (inputs.length > 8) throw new Error("A score track supports eight pads.");
  const pads = base.pads.map((pad, i): ScorePadState => {
    const p = record(inputs[i]);
    const lengthBeats = integer(p.lengthBeats ?? value.lengthBeats ?? base.timing.meterNumerator * 4, 1, SCORE_MAX_BEATS, "length");
    const notes = (Array.isArray(p.notes) ? p.notes : []).map(normalizeScoreNote);
    if (notes.length > SCORE_MAX_PAD_NOTES || new Set(notes.map(n => n.id)).size !== notes.length) throw new Error("Invalid score note count or duplicate IDs.");
    const theory = normalizeSequencerTrackWithTiming({ ...base, ...p, pads: [], lengthBeats: 4 }, index, timing);
    return { ...pad, scaleRoot: theory.scaleRoot, scaleType: theory.scaleType, mode: theory.mode,
      lengthBeats, stepCount: lengthBeats * base.timing.stepsPerBeat, steps: [], notes };
  });
  const active = pads[base.activePad];
  return { ...base, id: typeof value.id === "string" && value.id ? value.id : `score-${index}`, name: typeof value.name === "string" ? base.name : `Score Sequencer ${index}`,
    lengthBeats: active.lengthBeats, stepCount: active.stepCount, steps: [], scaleRoot: active.scaleRoot, scaleType: active.scaleType, mode: active.mode, pads, launchQuantization: value.launchQuantization === "score" ? "score" : "bar" };
}

export function validateScoreTracks(tracks: ScoreTrackState[]) {
  if (tracks.length > 16 || tracks.reduce((sum, t) => sum + t.pads.reduce((n, p) => n + p.notes.length, 0), 0) > SCORE_MAX_TOTAL_NOTES)
    throw new Error("Score capacity exceeded (16 tracks / 50000 notes).");
  tracks.forEach(t => normalizeScoreTrack(t, 1, t.timing));
}

export function scoreTrackConfig(track: ScoreTrackState, exportMode = false): SessionScoreTrackConfig {
  const t = track.timing;
  return { track_id: track.id, midi_channel: track.midiChannel,
    timing: { tempo_bpm: t.tempoBPM, meter_numerator: t.meterNumerator, meter_denominator: t.meterDenominator,
      steps_per_beat: t.stepsPerBeat, beat_rate_numerator: t.beatRateNumerator, beat_rate_denominator: t.beatRateDenominator, beat_unit: "meter" },
    length_beats: track.lengthBeats, active_pad: track.activePad, queued_pad: exportMode ? null : track.queuedPad,
    enabled: exportMode ? track.padLoopEnabled || track.enabled : track.enabled,
    queued_enabled: exportMode ? null : track.queuedEnabled, launch_quantization: track.launchQuantization,
    scale_root: track.scaleRoot, scale_type: track.scaleType, mode: track.mode,
    pad_loop_enabled: track.padLoopEnabled, pad_loop_repeat: track.padLoopRepeat,
    pad_loop_sequence: compileArrangerTransportSequence(track.padLoopPattern, track.activePad),
    pads: track.pads.map((p, pad_index) => ({ pad_index, length_beats: p.lengthBeats, scale_root: p.scaleRoot, scale_type: p.scaleType, mode: p.mode,
      notes: p.notes.map(n => ({ id: n.id, pitch: n.pitch, velocity: n.velocity, start_ticks: n.startTicks, duration_ticks: n.durationTicks })) })) };
}

export function persistedScoreTracks(state: Pick<SequencerState, "scoreTracks">) {
  return state.scoreTracks.map(t => ({ ...t, queuedPad: null, queuedEnabled: null, padLoopPosition: null,
    runtimeLocalStep: null, runtimePadStartSubunit: null }));
}
