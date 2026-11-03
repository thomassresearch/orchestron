"""Persisted clip references and bounds. Legacy formats remain unchanged."""
from fractions import Fraction

from backend.app.models.clip_arrangement import MAX_CLIP_TICKS

SOURCE_KEYS = {"sequencer": "tracks", "score": "scoreTracks", "drummer": "drummerTracks", "controller": "controllerSequencers", "arpeggiator": "arpeggiators"}


def _integer(value, minimum=0, maximum=MAX_CLIP_TICKS):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Clip values require bounded integer ticks.")
    return value


def validate_authored_clips(document):
    sequencer = document.get("sequencer", {}) if isinstance(document, dict) else {}
    if not isinstance(sequencer, dict) or "clipArrangement" not in sequencer:
        return document
    if document.get("version") not in (5, 23):
        raise ValueError("Clip arrangements require performance v23 or app state v5.")
    model = sequencer["clipArrangement"]
    if not isinstance(model, dict) or model.get("version") != 1:
        raise ValueError("Unsupported clip arrangement version.")
    _integer(model.get("revision"))
    end = _integer(model.get("end"), 1)
    lanes = model.get("lanes")
    if not isinstance(lanes, list) or len(lanes) > 72:
        raise ValueError("Invalid clip lane count.")
    seen = set()

    def identity(value):
        if not isinstance(value, str) or not 1 <= len(value) <= 128 or value in seen:
            raise ValueError("Clip identities must be unique nonempty strings.")
        seen.add(value)

    score_count = 0
    for lane in lanes:
        if not isinstance(lane, dict):
            raise ValueError("Invalid clip lane.")
        identity(lane.get("id"))
        source = lane.get("source")
        if source not in SOURCE_KEYS:
            raise ValueError("Invalid clip source type.")
        tracks = sequencer.get(SOURCE_KEYS[source], [])
        if not isinstance(tracks, list) or any(not isinstance(t, dict) for t in tracks):
            raise ValueError("Invalid clip sources.")
        track = next((t for t in tracks if t.get("id") == lane["id"]), None)
        if track is None:
            raise ValueError("Missing clip source lane.")
        timing = track.get("timing", {})
        if not isinstance(timing, dict):
            raise ValueError("Invalid clip timing.")
        denominator = _integer(timing.get("beatRateDenominator", 1), 1, 64)
        numerator = _integer(timing.get("beatRateNumerator", 1), 1, 64)
        meter = _integer(timing.get("meterDenominator", 4), 1, 64)
        beat = Fraction(20160) if source == "arpeggiator" else Fraction(20160 * 4 * denominator, meter * numerator)
        if beat.denominator != 1:
            raise ValueError("Clip timing must resolve exactly.")
        definitions, clips = lane.get("definitions"), lane.get("clips")
        if not isinstance(definitions, list) or len(definitions) > 512 or not isinstance(clips, list) or len(clips) > 2048:
            raise ValueError("Clip resource limit exceeded.")
        if any(not isinstance(d, dict) or not isinstance(d.get("id"), str) for d in definitions) or any(not isinstance(c, dict) for c in clips):
            raise ValueError("Invalid clip definitions or windows.")
        defs = {d["id"]: d for d in definitions}
        cycle = lane.get("cycleTicks")
        if cycle is not None:
            _integer(cycle, 1)
        lengths = {}
        leaf_counts = {}

        def resolve(items, level, check_ids=False):
            if not isinstance(items, list) or not 1 <= len(items) <= 256:
                raise ValueError("Clip content requires 1–256 items.")
            total = count = 0
            for item in items:
                if not isinstance(item, dict):
                    raise ValueError("Invalid clip child.")
                if check_ids:
                    identity(item.get("id"))
                if "restTicks" in item:
                    total += _integer(item["restTicks"], 1)
                    count += 1
                else:
                    d = defs.get(item.get("definitionId"))
                    if not d:
                        raise ValueError("Missing clip definition.")
                    rank = {"pattern": 0, "group": 1, "supergroup": 2}.get(d.get("kind"), 3)
                    if rank >= level:
                        raise ValueError("Invalid or cyclic clip nesting.")
                    if d["id"] not in lengths:
                        length, leaves = resolve(d.get("children"), rank)
                        lengths[d["id"]], leaf_counts[d["id"]] = length, leaves
                    total += lengths[d["id"]]
                    count += leaf_counts[d["id"]]
                if count > 65536:
                    raise ValueError("Clip content expansion limit exceeded.")
            return _integer(total, 1), count

        for d in definitions:
            identity(d.get("id"))
            if not isinstance(d.get("name"), str) or not d["name"].strip() or len(d["name"]) > 128:
                raise ValueError("Invalid clip definition name.")
            _integer(d.get("revision"))
            if d.get("kind") == "pattern":
                if d.get("source") != source or not isinstance(d.get("payload"), dict):
                    raise ValueError("Clip pattern source mismatch.")
                payload = d["payload"]
                _validate_pattern_payload(source, payload)
                length = _integer(payload.get("lengthBeats"), 1, 8192 if source == "score" else 32 if source == "controller" else 16)
                lengths[d["id"]], leaf_counts[d["id"]] = _integer(length * int(beat), 1), 1
                if source == "score":
                    from backend.app.models.session import SessionScoreNoteConfig
                    notes = payload.get("notes", [])
                    if not isinstance(notes, list) or len(notes) > 10000 or any(not isinstance(n, dict) for n in notes) or len({n.get("id") for n in notes}) != len(notes):
                        raise ValueError("Invalid clip score notes.")
                    for n in notes:
                        SessionScoreNoteConfig(id=n.get("id"), pitch=n.get("pitch"), velocity=n.get("velocity"), start_ticks=n.get("startTicks"), duration_ticks=n.get("durationTicks"))
                    score_count += len(notes)
                    if score_count > 50000:
                        raise ValueError("Clip score capacity exceeded.")
            elif d.get("kind") not in ("group", "supergroup"):
                raise ValueError("Unknown clip definition type.")
        for d in definitions:
            if d["kind"] != "pattern":
                resolve(d.get("children"), 1 if d["kind"] == "group" else 2, True)
        previous_end = 0
        for clip in sorted(clips, key=lambda c: _integer(c.get("start"))):
            identity(clip.get("id"))
            start = _integer(clip.get("start"))
            finish = start + _integer(clip.get("length"), 1)
            _integer(clip.get("offset"))
            if start < previous_end or finish > end or cycle is not None and finish > cycle:
                raise ValueError("Clip overlap or invalid extent.")
            if clip.get("mode") not in ("once", "loop") or not isinstance(clip.get("name"), str) or not 1 <= len(clip["name"]) <= 128:
                raise ValueError("Invalid clip name or mode.")
            previous_end = finish
            resolve(clip.get("children"), 3, True)
    return document


def _validate_pattern_payload(source, payload):
    """Use existing musical validators without normalizing or dropping authored fields."""
    import re
    from backend.app.models.session import (
        ArpeggiatorPadConfig, SessionControllerSequencerPadConfig,
        SessionSequencerPadConfig, SessionSequencerStepConfig,
    )
    def wire(value):
        if isinstance(value, list):
            return [wire(item) for item in value]
        if isinstance(value, dict):
            return {re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): wire(item) for key, item in value.items()}
        return value
    if source == "arpeggiator":
        ArpeggiatorPadConfig.model_validate(wire(payload))
    elif source == "controller":
        if not isinstance(payload.get("steps"), list) or not isinstance(payload.get("keypoints"), list):
            raise ValueError("Controller patterns require both steps and keypoints.")
        SessionControllerSequencerPadConfig.model_validate({**wire(payload), "pad_index": 0})
        points = payload["keypoints"]
        if len(points) < 2 or len({p.get("id") for p in points}) != len(points):
            raise ValueError("Curve points require distinct IDs and both endpoints.")
        positions = sorted(p["position"] for p in points)
        if positions[0] != 0 or positions[-1] != 1 or len(set(positions)) != len(positions):
            raise ValueError("Curve positions require distinct points and both endpoints.")
    elif source == "sequencer":
        if not isinstance(payload.get("steps"), list):
            raise ValueError("Melodic patterns require steps.")
        SessionSequencerPadConfig.model_validate({**wire(payload), "pad_index": 0})
    elif source == "drummer":
        rows = payload.get("rows")
        if not isinstance(rows, list) or len(rows) > 128 or any(not isinstance(row, dict) for row in rows):
            raise ValueError("Invalid drummer rows.")
        if len({row.get("rowId") for row in rows}) != len(rows):
            raise ValueError("Duplicate drummer row.")
        for row in rows:
            steps = row.get("steps")
            if not isinstance(steps, list) or len(steps) > 128 or any(not isinstance(step, dict) for step in steps):
                raise ValueError("Invalid drummer steps.")
            for step in steps:
                SessionSequencerStepConfig.model_validate(wire(step))
