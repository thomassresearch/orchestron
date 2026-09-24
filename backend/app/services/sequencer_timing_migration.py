"""Versioned, non-destructive migration from quarter beats to meter beats.

Keep this contract aligned with frontend/lib/sequencerTimingMigration.ts and
the standalone performance CLI; shared fixtures exercise all three readers.
"""
from copy import deepcopy


def _double_lengths(value):
    if isinstance(value, list):
        return [_double_lengths(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in ("lengthBeats", "length_beats") and isinstance(item, (int, float)):
            result[key] = item * 2
        elif key == "lengths" and isinstance(item, list):
            result[key] = [length * 2 for length in item]
        elif key in ("padLoopSequence", "pad_loop_sequence") and isinstance(item, list):
            result[key] = [token * 2 if isinstance(token, int) and token < 0 else token for token in item]
        else:
            result[key] = _double_lengths(item)
    return result


def _canonical_lengths(value, kind):
    if isinstance(value, list):
        return [_canonical_lengths(item, kind) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _canonical_lengths(item, kind) for key, item in value.items()}
    if not any(key in result for key in ("lengthBeats", "length_beats")) and any(key in result for key in ("stepCount", "step_count")):
        length = result.get("stepCount", result.get("step_count"))
        if kind != "controller" and length == 16:
            length = 4
        elif length == 32:
            length = 8
        elif length == 64:
            length = 16 if kind == "controller" else 4
        elif not isinstance(length, (int, float)) or not (1 <= length <= 8 or kind == "controller" and length == 16):
            length = 4
        result["lengthBeats"] = length
    return result


def migrate_sequencer_timing(config: dict, *, app_state: bool = False) -> dict:
    target_version = 3 if app_state else 17
    if not isinstance(config, dict) or type(config.get("version", 1)) is not int or config.get("version", 1) not in range(1, target_version):
        return config
    sequencer = config.get("sequencer")
    if not isinstance(sequencer, dict):
        return config
    result = deepcopy(config)
    sequencer = result["sequencer"]
    timing_keys = (("tempoBPM", "tempo_bpm"), ("meterNumerator", "meter_numerator"), ("meterDenominator", "meter_denominator"), ("stepsPerBeat", "steps_per_beat"), ("beatRateNumerator", "beat_rate_numerator"), ("beatRateDenominator", "beat_rate_denominator"))
    global_timing = sequencer["timing"] if isinstance(sequencer.get("timing"), dict) else {key: sequencer.get(key, sequencer.get(alias)) for key, alias in timing_keys if key in sequencer or alias in sequencer}
    migrated = set()
    for field, kind in (("tracks", "sequencer"), ("drummerTracks", "drummer"), ("controllerSequencers", "controller")):
        tracks = sequencer.get(field)
        if not isinstance(tracks, list):
            continue
        for index, raw_track in enumerate(tracks):
            if not isinstance(raw_track, dict):
                continue
            track = _canonical_lengths(raw_track, kind)
            timing = track["timing"] if isinstance(track.get("timing"), dict) else {key: track.get(key, track.get(alias, global_timing.get(key, global_timing.get(alias))))
                for key, alias in timing_keys if key in track or alias in track or key in global_timing or alias in global_timing}
            denominator = timing.get("meterDenominator", timing.get("meter_denominator", 4))
            sequencer[field][index] = track
            if denominator != 8:
                continue
            track.setdefault("lengthBeats", track.get("length_beats", 4))
            converted = _double_lengths(track)
            converted["timing"] = deepcopy(timing)
            grid = timing.get("stepsPerBeat", timing.get("steps_per_beat", 4))
            converted["timing"]["stepsPerBeat"] = grid // 2
            converted["timing"].pop("steps_per_beat", None)
            sequencer[field][index] = converted
            identity = track.get("id", track.get("trackId"))
            if isinstance(identity, str):
                migrated.add((kind, identity))
    history = result.get("arrangerHistory")
    def convert(item):
        if isinstance(item, dict) and isinstance(item.get("kind"), str) and isinstance(item.get("id"), str) and (item["kind"], item["id"]) in migrated:
            return _double_lengths(_canonical_lengths(item, item.get("kind")))
        return item

    if isinstance(history, dict):
        if isinstance(history.get("basis"), list):
            basis_values = []
            for basis in history["basis"]:
                converted = convert(basis)
                basis_values.append({**converted, "meterDenominator": 8} if converted is not basis else basis)
            history["basis"] = basis_values
        if isinstance(history.get("entries"), list):
            for entry in history["entries"]:
                if isinstance(entry, dict) and isinstance(entry.get("changes"), list):
                    entry["changes"] = [convert(change) for change in entry["changes"]]
    result["version"] = target_version
    return result
