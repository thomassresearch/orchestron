/** Shared migration contract: backend/tests/fixtures/sequencers/timing_migration.json. */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);

function doubleLengths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(doubleLengths);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if ((key === "lengthBeats" || key === "length_beats") && typeof item === "number") return [key, item * 2];
    if (key === "lengths" && Array.isArray(item)) return [key, item.map(n => Number(n) * 2)];
    if ((key === "padLoopSequence" || key === "pad_loop_sequence") && Array.isArray(item)) {
      return [key, item.map(n => typeof n === "number" && n < 0 ? n * 2 : n)];
    }
    return [key, doubleLengths(item)];
  }));
}

function canonicalLengths(value: unknown, kind: string): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalLengths(item, kind));
  if (!record(value)) return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalLengths(item, kind)]));
  if (result.lengthBeats === undefined && result.length_beats === undefined && (result.stepCount !== undefined || result.step_count !== undefined)) {
    let length = result.stepCount ?? result.step_count;
    if (kind !== "controller" && length === 16) length = 4;
    else if (length === 32) length = 8;
    else if (length === 64) length = kind === "controller" ? 16 : 4;
    else if (typeof length !== "number" || !((length >= 1 && length <= 8) || kind === "controller" && length === 16)) length = 4;
    result.lengthBeats = length;
  }
  return result;
}

export function migrateSequencerTiming(raw: unknown, appState = false): unknown {
  const targetVersion = appState ? 3 : 17;
  if (!record(raw) || !Number.isInteger(raw.version ?? 1) || Number(raw.version ?? 1) < 1 || Number(raw.version ?? 1) >= targetVersion || !record(raw.sequencer)) return raw;
  const result = structuredClone(raw);
  const sequencer = result.sequencer as RecordValue;
  const keys = [["tempoBPM", "tempo_bpm"], ["meterNumerator", "meter_numerator"], ["meterDenominator", "meter_denominator"], ["stepsPerBeat", "steps_per_beat"], ["beatRateNumerator", "beat_rate_numerator"], ["beatRateDenominator", "beat_rate_denominator"]];
  const globalTiming = record(sequencer.timing) ? sequencer.timing : Object.fromEntries(keys.map(([key, alias]) => [key, sequencer[key] ?? sequencer[alias]]).filter(([, value]) => value !== undefined));
  const migrated = new Set<string>();
  for (const [field, kind] of [["tracks", "sequencer"], ["drummerTracks", "drummer"], ["controllerSequencers", "controller"]]) {
    const tracks = sequencer[field];
    if (!Array.isArray(tracks)) continue;
    sequencer[field] = tracks.map(rawTrack => {
      if (!record(rawTrack)) return rawTrack;
      rawTrack = canonicalLengths(rawTrack, kind) as RecordValue;
      const timing = record(rawTrack.timing) ? rawTrack.timing : Object.fromEntries(keys.map(([key, alias]) =>
        [key, rawTrack[key] ?? rawTrack[alias] ?? globalTiming[key] ?? globalTiming[alias]]).filter(([, value]) => value !== undefined));
      if ((timing.meterDenominator ?? timing.meter_denominator ?? 4) !== 8) return rawTrack;
      const track = doubleLengths({ ...rawTrack, lengthBeats: rawTrack.lengthBeats ?? rawTrack.length_beats ?? 4 }) as RecordValue;
      const nextTiming: RecordValue = { ...timing, stepsPerBeat: Number(timing.stepsPerBeat ?? timing.steps_per_beat ?? 4) / 2 };
      delete nextTiming.steps_per_beat;
      track.timing = nextTiming;
      migrated.add(`${kind}:${rawTrack.id ?? rawTrack.trackId}`);
      return track;
    });
  }
  const history = result.arrangerHistory;
  const convert = (item: unknown) => record(item) && migrated.has(`${item.kind}:${item.id}`) ? doubleLengths(canonicalLengths(item, String(item.kind))) : item;
  if (record(history)) {
    if (Array.isArray(history.basis)) history.basis = history.basis.map(item => { const next = convert(item); return next !== item && record(next) ? { ...next, meterDenominator: 8 } : next; });
    if (Array.isArray(history.entries)) for (const entry of history.entries) {
      if (record(entry) && Array.isArray(entry.changes)) entry.changes = entry.changes.map(convert);
    }
  }
  result.version = targetVersion;
  return result;
}
