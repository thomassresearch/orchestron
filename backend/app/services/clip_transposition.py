"""Prepared pitch variants; no pitch transformation or cache miss on the render thread."""

from collections import OrderedDict
from dataclasses import fields, is_dataclass, replace
from sys import getsizeof
from threading import RLock

from backend.app.models.clip_transposition import MAX_SCORE_RECORDS, MAX_TOTAL_VARIANTS, transpose_pitch

# Retain bounded content keys, not definition IDs (which are reused by live edits).
_cache = OrderedDict()
_cache_lock = RLock()
_cache_records = 0
_cache_bytes = 0
# Conservative per-entry accounting counts shared source objects again. 128 MiB
# retains the 200k-record stress case (about 47 MiB of distinct prepared objects).
MAX_CACHE_BYTES = 128 * 1024 * 1024
TRANSFORM_VERSION = 1


def retained_size(value, seen=None):
    """Conservative retained size, including dataclass slots and content keys."""
    seen = set() if seen is None else seen
    if id(value) in seen:
        return 0
    seen.add(id(value))
    children = (
        (*value.keys(), *value.values())
        if isinstance(value, dict)
        else (
            (getattr(value, f.name) for f in fields(value))
            if is_dataclass(value)
            else value
            if isinstance(value, (tuple, list, set))
            else (vars(value),)
            if hasattr(value, "__dict__")
            else ()
        )
    )
    return getsizeof(value) + sum(retained_size(child, seen) for child in children)


def variant(pad, pair):
    # Preparation/export callers can run on different worker threads.
    with _cache_lock:
        return _variant(pad, pair)


def _variant(pad, pair):
    global _cache_records, _cache_bytes
    if pair == (0, 0):
        return pad
    key = (
        TRANSFORM_VERSION,
        tuple(
            tuple(sorted(value.items())) if isinstance(value, dict) else value
            for value in (getattr(pad, f.name) for f in fields(pad))
        ),
        pair,
    )
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key][0]
    root, mode = pad.scale_root or "C", pad.mode or "aeolian"
    pitch_map = tuple(transpose_pitch(n, root, mode, pair) for n in range(128))
    if pad.score_by_id:
        from backend.app.services.score_sequencer import index_score_notes

        notes = [
            replace(n, pitch=pitch_map[n.pitch]) for n in pad.score_by_id.values() if pitch_map[n.pitch] is not None
        ]
        result = replace(pad, **index_score_notes(notes))
    else:
        steps = tuple(
            replace(step, notes=tuple(dict.fromkeys(pitch_map[n] for n in step.notes if pitch_map[n] is not None)))
            for step in pad.steps
        )
        # Delays belong to original chord tones, even when a preceding tone is omitted.
        attacks = tuple(
            tuple((delay, pitch_map[n]) for delay, n in group if pitch_map[n] is not None)
            for group in pad.strum_attacks
        )
        result = replace(pad, steps=steps, strum_attacks=attacks)
    # Source notes are shared with the authored pad; the byte budget includes
    # retained keys/source references, while this quota counts transformed notes.
    records = len(result.score_by_id)
    size = retained_size((key, result))
    while _cache and (
        len(_cache) >= 256 or _cache_records + records > MAX_SCORE_RECORDS or _cache_bytes + size > MAX_CACHE_BYTES
    ):
        _, (_, count, retained) = _cache.popitem(last=False)
        _cache_records -= count
        _cache_bytes -= retained
    if records <= MAX_SCORE_RECORDS and size <= MAX_CACHE_BYTES:
        _cache[key] = (result, records, size)
        _cache_records += records
        _cache_bytes += size
    return result


def prepare_variants(tracks, pinned_pairs=None):
    planned = []
    count = records = 0
    for track in tracks.values():
        pairs = track.clip_schedule.variant_pairs() if track.clip_schedule else set()
        if track.audition_schedule:
            pairs.update(track.audition_schedule.variant_pairs())
        pairs.update(
            (index, pair)
            for index, pair in (pinned_pairs or {}).get(track.track_id, ())
            if index in track.pads and pair != (0, 0)
        )
        if len(pairs) > 256:
            raise ValueError("Lane transposition variant limit exceeded (including sounding variants).")
        count += len(pairs)
        records += sum(len(track.pads[index].score_by_id) for index, _ in pairs)
        if count > MAX_TOTAL_VARIANTS or records > MAX_SCORE_RECORDS:
            raise ValueError("Performance transposition variant/score-record limit exceeded.")
        planned.append((track, pairs))
    for track, pairs in planned:
        track.transpose_variants = {(index, pair): variant(track.pads[index], pair) for index, pair in pairs}


def prepare_arpeggiators(configs):
    from backend.app.models.clip_arrangement import PreparedClipSchedule

    result = {}
    total = 0
    for config in configs:
        schedule = PreparedClipSchedule(config.clip_schedule) if config.clip_schedule else None
        audition = PreparedClipSchedule(config.audition_schedule) if config.audition_schedule else None
        pairs = (schedule.variant_pairs() if schedule else set()) | (audition.variant_pairs() if audition else set())
        if len(pairs) > 256:
            raise ValueError("Lane transposition variant limit exceeded (including audition).")
        total += len(pairs)
        if total > MAX_TOTAL_VARIANTS:
            raise ValueError("Performance transposition variant limit exceeded.")
        maps = {
            (index, pair): tuple(
                transpose_pitch(n, config.pads[index].scale_root, config.pads[index].mode, pair) for n in range(128)
            )
            for index, pair in pairs
        }
        result[config.arpeggiator_id] = (schedule, maps, audition)
    return result
