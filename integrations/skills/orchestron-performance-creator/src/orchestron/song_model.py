"""Portable authored clip model. Times are exact transport ticks, never rounded floats."""

from fractions import Fraction
from hashlib import sha256
import json
import math
from uuid import uuid4

from .clip_arrangement import KEYS
from .clip_transposition import validate_transpositions

QUARTER = 20160
MAX_TICKS = QUARTER * 1_000_000
RANK = {"pattern": 0, "group": 1, "supergroup": 2}


class SongError(ValueError):
    def __init__(self, code, message, path="$", **details):
        super().__init__(message)
        self.code, self.path, self.details = code, path, details


def fail(message, path="$", code="invalid_song", **details):
    raise SongError(code, message, path, **details)


def integer(value, low=0, high=MAX_TICKS, path="$"):
    if type(value) is not int or not low <= value <= high:
        fail(f"Expected an integer in {low}..{high}.", path)
    return value


def fields(value, allowed, required=(), path="$"):
    if not isinstance(value, dict):
        fail("Expected an object.", path)
    extra, missing = set(value) - set(allowed), set(required) - set(value)
    if extra:
        fail(f"Unknown field: {sorted(extra)[0]}.", f"{path}.{sorted(extra)[0]}")
    if missing:
        fail(f"Missing field: {sorted(missing)[0]}.", f"{path}.{sorted(missing)[0]}")


def identity(value, path="$"):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        fail("Expected a nonempty ID/name of at most 128 characters.", path)
    return value


def uid():
    return str(uuid4())


def fingerprint(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def ticks(value, *, beat=QUARTER, meter=None, path="time"):
    """Numbers are ticks; strings explicitly suffix t, b (master), l (local), or bar."""
    if type(value) is int:
        return integer(value, path=path)
    if not isinstance(value, str):
        fail("Use integer ticks or an exact string such as '3/2b', '4l', '2bar'.", path)
    units = {
        "bar": None if meter is None else Fraction(QUARTER * 4 * meter[0], meter[1]),
        "b": QUARTER,
        "l": beat,
        "t": 1,
    }
    for suffix, scale in units.items():
        if value.endswith(suffix):
            if scale is None:
                fail(
                    "Bar times require explicit songMeter [numerator, denominator]. Bars are zero-origin durations.",
                    path,
                )
            try:
                result = Fraction(value[: -len(suffix)]) * scale
            except (ValueError, ZeroDivisionError):
                fail("Invalid exact time.", path)
            if result.denominator != 1:
                fail("Time does not resolve to an integer transport tick.", path)
            return integer(int(result), path=path)
    fail("Time needs a unit: t, b, l or bar.", path)


def model(config):
    result = config.get("sequencer", {}).get("clipArrangement")
    if result is None:
        fail("Use edit begin --new --arranger clips, or explicitly migrate this legacy song.", code="clips_required")
    return result


def find(items, key, path="id"):
    matches = [item for item in items if item.get("id") == key]
    if len(matches) != 1:
        fail(f"Expected exactly one object with ID '{key}'.", path, "missing" if not matches else "ambiguous")
    return matches[0]


def lane_for(config, lane_id):
    return find(model(config)["lanes"], lane_id, "laneId")


def source_for(config, lane):
    return find(config["sequencer"].get(KEYS[lane["source"]], []), lane["id"], "laneId")


def beat_ticks(config, lane):
    t = source_for(config, lane).get("timing", {})
    if lane["source"] == "arpeggiator":
        return QUARTER
    n = integer(t.get("beatRateNumerator", 1), 1, 64)
    d = integer(t.get("beatRateDenominator", 1), 1, 64)
    m = integer(t.get("meterDenominator", 4), 1, 64)
    beat = Fraction(QUARTER * 4 * d, m * n)
    if beat.denominator != 1:
        fail("Lane beat duration must resolve exactly.", lane["id"])
    return int(beat)


def duration(config, lane, definition):
    payload = definition["payload"]
    if lane["source"] == "controller" and source_for(config, lane).get("controllerMode", "curve") == "curve":
        if "curveDurationTicks" in payload:
            return integer(payload["curveDurationTicks"], 1)
    return integer(payload["lengthBeats"] * beat_ticks(config, lane), 1)


def leaves(config, lane, children, level=3, path=()):
    """Resolve one content cycle only. Callers restrict any virtual repetition window."""
    result, cursor = [], 0
    for item in children:
        current = (*path, item["id"])
        if "restTicks" in item:
            spans = [{"definition": None, "path": list(current), "start": 0, "length": integer(item["restTicks"], 1)}]
        else:
            d = find(lane["definitions"], item["definitionId"])
            rank = RANK.get(d.get("kind"), 3)
            if rank >= level:
                fail("Invalid hierarchy or cyclic reference.", "/".join(current))
            spans = (
                [{"definition": d, "path": list(current), "start": 0, "length": duration(config, lane, d)}]
                if rank == 0
                else leaves(config, lane, d["children"], rank, current)
            )
        if len(result) + len(spans) > 65536:
            fail("Content expansion exceeds 65536 leaves.", code="limit")
        result.extend({**span, "start": span["start"] + cursor} for span in spans)
        cursor = integer(cursor + sum(s["length"] for s in spans), 1)
    return result


def content_length(config, lane, children):
    return sum(s["length"] for s in leaves(config, lane, children))


def target_at(config, target):
    fields(
        target, {"laneId", "clipId", "path", "pass", "revision", "fingerprint"}, {"laneId", "clipId", "path"}, "target"
    )
    if "revision" in target and target["revision"] != model(config)["revision"]:
        fail("The occurrence selector is stale. Inspect again.", "target.revision", "conflict")
    if "fingerprint" in target and target["fingerprint"] != fingerprint(model(config)):
        fail("The occurrence fingerprint is stale. Inspect again.", "target.fingerprint", "conflict")
    lane = lane_for(config, target["laneId"])
    clip = find(lane["clips"], target["clipId"])
    if not isinstance(target["path"], list) or not 1 <= len(target["path"]) <= 3:
        fail("Select a path of one to three occurrence IDs.", "target.path")
    items, ancestry = clip["children"], []
    for part in target["path"]:
        item = find(items, part, "target.path")
        if "definitionId" not in item:
            fail("This selector identifies a rest.", "target.path")
        definition = find(lane["definitions"], item["definitionId"])
        ancestry.append((item, definition))
        items = definition.get("children", [])
    source_pass = integer(target.get("pass", 0), 0, 40320000000, "target.pass")
    length = content_length(config, lane, clip["children"])
    if clip["mode"] == "once":
        if source_pass != 0:
            fail("A Once clip has only pass zero.", "target.pass", "missing")
    elif not clip["offset"] // length <= source_pass <= (clip["offset"] + clip["length"] - 1) // length:
        fail("That pass is outside the clip window.", "target.pass", "missing")
    return lane, clip, ancestry


def _step(value, path):
    if value is None:
        return
    if isinstance(value, dict):
        fields(
            value,
            {
                "note",
                "notes",
                "chord",
                "hold",
                "velocity",
                "active",
                "ratchets",
                "ratchetEndVelocity",
                "timingOffsetPercent",
                "strumDirection",
                "strumSpreadPercent",
            },
            path=path,
        )
        for key in ("hold", "active"):
            if key in value and type(value[key]) is not bool:
                fail("Expected a boolean.", path + "." + key)
        if "chord" in value:
            from .cli.orchestron_cli import chord_notes

            chord_notes(60, value["chord"])
        note = value.get("note", value.get("notes"))
        for key, lo, hi in [
            ("velocity", 0, 127),
            ("ratchets", 1, 8),
            ("ratchetEndVelocity", 0, 127),
            ("timingOffsetPercent", -50, 50),
            ("strumSpreadPercent", 0, 100),
        ]:
            if value.get(key) is not None:
                integer(value[key], lo, hi, f"{path}.{key}")
        if value.get("strumDirection", "off") not in ("off", "up", "down"):
            fail("Invalid strum direction.", path)
        if (
            value.get("strumDirection", "off") != "off"
            and value.get("strumSpreadPercent", 0) > 0
            and value.get("ratchets", 1) > 1
        ):
            fail("Strumming cannot be combined with multiple ratchets.", path)
    else:
        note = value
    if note is not None:
        for pitch in note if isinstance(note, list) else [note]:
            integer(pitch, 0, 127, f"{path}.note")


def validate_payload(source, p, target, path):
    if not isinstance(p, dict):
        fail("Expected a musical payload.", path)
    integer(
        p.get("lengthBeats"),
        1,
        8192 if source == "score" else 32 if source == "controller" else 16,
        path + ".lengthBeats",
    )
    if source in ("sequencer", "score"):
        from .cli.orchestron_cli import validate_melodic_theory

        validate_melodic_theory(
            scale_root=p.get("scaleRoot", "C"), scale_type=p.get("scaleType", "minor"), mode=p.get("mode", "aeolian")
        )
    if source in ("sequencer", "drummer"):
        rows = p.get("rows", []) if source == "drummer" else [{"steps": p.get("steps")}]
        if not isinstance(rows, list) or len(rows) > 128:
            fail("Invalid drummer rows.", path)
        if source == "drummer" and len({r.get("rowId") for r in rows}) != len(rows):
            fail("Duplicate drummer row ID.", path)
        for r, row in enumerate(rows):
            steps = row.get("steps")
            if not isinstance(steps, list) or len(steps) > 128:
                fail("Patterns require at most 128 stored steps.", path)
            for i, step in enumerate(steps):
                _step(step, f"{path}.rows[{r}].steps[{i}]")
    elif source == "score":
        notes = p.get("notes")
        if not isinstance(notes, list) or len(notes) > 10000:
            fail("Score patterns require at most 10000 notes.", path)
        seen = set()
        for i, n in enumerate(notes):
            where = f"{path}.notes[{i}]"
            identity(n.get("id"), where)
            if n["id"] in seen:
                fail("Duplicate note ID.", where)
            seen.add(n["id"])
            integer(n.get("pitch"), 0, 127, where + ".pitch")
            integer(n.get("velocity", 100), 0, 127, where + ".velocity")
            integer(n.get("startTicks"), 0, 8192 * QUARTER - 1, where + ".startTicks")
            integer(n.get("durationTicks"), 1, 8192 * QUARTER, where + ".durationTicks")
    elif source == "controller":
        steps, points = p.get("steps"), p.get("keypoints")
        if (
            not isinstance(steps, list)
            or len(steps) > 128
            or not isinstance(points, list)
            or not 2 <= len(points) <= (10 if target else 256)
        ):
            fail("Controller patterns need stored steps and 2–10 bound (2–256 generic) curve points.", path)
        for step in steps:
            if step is not None:
                integer(step, 0, 127, path + ".steps")
        positions, ids = [], set()
        for point in points:
            position = point.get("position")
            if type(position) not in (int, float) or not math.isfinite(position) or not 0 <= position <= 1:
                fail("Curve positions are finite numbers from zero to one.", path)
            integer(point.get("value"), 0, 127, path)
            identity(point.get("id"), path)
            positions.append(position)
            ids.add(point["id"])
        if len(ids) != len(points) or len(set(positions)) != len(points) or min(positions) != 0 or max(positions) != 1:
            fail("Curve points require unique IDs/positions and both endpoints.", path)
        if "curveDurationTicks" in p:
            if not target:
                fail("Independent curve durations require instrument-bound automation.", path)
            integer(p["curveDurationTicks"], 1, path=path)
    elif source == "arpeggiator":
        from .cli.orchestron_cli import ARPEGGIATOR_PATTERNS, ARPEGGIATOR_RATES

        if p.get("pattern", "up") not in ARPEGGIATOR_PATTERNS or p.get("rate", "1/16") not in ARPEGGIATOR_RATES:
            fail("Invalid arpeggiator pattern or rate.", path)
        for key, lo, hi in [
            ("octaves", 1, 4),
            ("fixedVelocity", 1, 127),
            ("repeats", 1, 4),
            ("humanizeVelocity", 0, 32),
            ("transpose", -24, 24),
            ("rotation", 0, 31),
            ("randomSeed", 0, 2147483647),
        ]:
            if key in p:
                integer(p[key], lo, hi, path + "." + key)
        for key, lo, hi in [("gateRatio", 0.05, 2), ("swing", 0, 0.75), ("probability", 0, 1), ("humanizeMs", 0, 50)]:
            v = p.get(key, lo)
            if type(v) not in (int, float) or not math.isfinite(v) or not lo <= v <= hi:
                fail(f"Invalid {key}.", path + "." + key)
        if not isinstance(p.get("steps", []), list) or not 1 <= len(p.get("steps", [])) <= 32:
            fail("Arpeggiators need 1–32 stored steps.", path)
        if p["lengthBeats"] not in (*range(1, 9), 16):
            fail("Arpeggiator length must be 1–8 or 16 beats.", path + ".lengthBeats")
        for key, choices in {
            "octaveTraversal": ("range", "octave"),
            "velocityMode": ("input", "fixed", "accent"),
            "scaleMode": ("off", "source", "custom"),
            "randomMode": ("repeat", "evolve"),
        }.items():
            if key in p and p[key] not in choices:
                fail("Invalid arpeggiator setting.", path + "." + key)
        for key in ("scaleQuantize", "advanceRests"):
            if key in p and type(p[key]) is not bool:
                fail("Expected a boolean.", path + "." + key)
        for index, step in enumerate(p["steps"]):
            where = f"{path}.steps[{index}]"
            fields(step, {"kind", "notePosition", "velocity", "gateRatio", "probability", "ratchets"}, path=where)
            if step.get("kind", "next") not in ("next", "position", "rest", "tie", "chord"):
                fail("Unknown arpeggiator step kind.", where)
            for key, default, lo, hi in [("notePosition", 1, 1, 128), ("velocity", 100, 0, 200), ("ratchets", 1, 1, 4)]:
                integer(step.get(key, default), lo, hi, where + "." + key)
            for key, lo, hi in [("gateRatio", 0.05, 2), ("probability", 0, 1)]:
                value = step.get(key)
                if value is not None and (
                    type(value) not in (int, float) or not math.isfinite(value) or not lo <= value <= hi
                ):
                    fail("Invalid arpeggiator step value.", where + "." + key)


def validate_source(track, source):
    path = track["id"]
    timing = track.get("timing", {})
    integer(timing.get("tempoBPM", 120), 30, 300, path + ".timing.tempoBPM")
    for key, default, choices in [
        ("meterNumerator", 4, (2, 3, 4, 5, 6, 7)),
        ("meterDenominator", 4, (4, 8)),
        ("stepsPerBeat", 4, (1, 2, 3, 4, 6, 8)),
    ]:
        value = timing.get(key, default)
        if type(value) is not int or value not in choices:
            fail("Unsupported timing value.", path + ".timing." + key)
    if timing.get("beatUnit", "quarter") not in ("quarter", "meter"):
        fail("Unsupported beat unit.", path + ".timing.beatUnit")
    if (timing.get("beatRateNumerator", 1), timing.get("beatRateDenominator", 1)) not in (
        (1, 1),
        (2, 1),
        (3, 2),
        (4, 3),
        (3, 4),
        (5, 4),
        (4, 5),
        (7, 4),
    ):
        fail("Unsupported beat ratio.", path + ".timing")
    if type(track.get("enabled", True)) is not bool:
        fail("Expected boolean enabled.", path + ".enabled")
    if source in ("sequencer", "score", "drummer"):
        integer(track.get("midiChannel"), 1, 16, path + ".midiChannel")
    if source == "controller":
        integer(track.get("controllerNumber"), 0, 127, path + ".controllerNumber")
        if track.get("controllerMode") not in ("curve", "steps"):
            fail("Controller mode must be curve or steps.", path + ".controllerMode")
        channels = track.get("targetChannels", [])
        if not isinstance(channels, list) or len(set(channels)) != len(channels):
            fail("Target channels must be a unique list.", path + ".targetChannels")
        for channel in channels:
            integer(channel, 1, 16, path + ".targetChannels")
    if source == "arpeggiator":
        integer(track.get("inputChannel"), 1, 16, path + ".inputChannel")
        integer(track.get("targetChannel"), 1, 16, path + ".targetChannel")
        for key, choices in {
            "playbackMode": ("arranger", "live"),
            "holdMode": ("off", "replace", "toggle"),
            "processingMode": ("active", "bypass", "mute"),
            "restartMode": ("free", "first_note", "beat", "bar"),
            "launchQuantize": ("cycle", "bar"),
        }.items():
            if key in track and track[key] not in choices:
                fail("Invalid arpeggiator source setting.", path + "." + key)


def validate(config):
    m = model(config)
    if (
        config.get("version") not in (23, 24, 25, 26)
        or type(m.get("version")) is not int
        or m["version"] not in (1, 2, 3, 4)
        or config["version"] < m["version"] + 22
    ):
        fail("Unsupported or incompatible performance/clip version.", "version")
    integer(m.get("revision"))
    integer(m.get("end"), 1)
    if not isinstance(m.get("lanes"), list) or len(m["lanes"]) > 72:
        fail("At most 72 lanes are allowed.", "lanes", "limit")
    seen, routes, score_notes = set(), set(), 0

    def unique(value):
        identity(value)
        if value in seen:
            fail(f"Duplicate ID '{value}'.", value, "duplicate_id")
        seen.add(value)

    for lane in m["lanes"]:
        unique(lane.get("id"))
        if lane.get("source") not in KEYS:
            fail("Unknown source kind.", lane["id"])
        track = source_for(config, lane)
        validate_source(track, lane["source"])
        beat_ticks(config, lane)
        if lane.get("cycleTicks") is not None:
            integer(lane["cycleTicks"], 1)
        definitions, clips = lane.get("definitions"), lane.get("clips")
        if (
            not isinstance(definitions, list)
            or len(definitions) > 512
            or not isinstance(clips, list)
            or len(clips) > 2048
        ):
            fail("At most 512 definitions and 2048 clips per lane.", lane["id"], "limit")
        target = track.get("automationTarget")
        if target:
            if lane["source"] != "controller" or m["version"] < 2:
                fail("Automation requires a controller lane and clip v2+.", lane["id"])
            identity(target.get("instrumentId"))
            nodes = target.get("controllerNodeIds")
            if (
                not isinstance(nodes, list)
                or not 1 <= len(nodes) <= 256
                or any(not isinstance(n, str) or not 1 <= len(n) <= 256 for n in nodes)
                or len(set(nodes)) != len(nodes)
            ):
                fail("Invalid automation controller identities.", lane["id"])
            owner = next((i for i in config.get("instruments", []) if i.get("id") == target["instrumentId"]), None)
            mappings = owner.get("performanceControllerMidiCCs", {}) if owner else {}
            ccs = {mappings[n] for n in nodes if n in mappings}
            if owner and len(ccs) == 1 and 1 <= owner.get("midiChannel", 0) <= 16:
                cc = next(iter(ccs))
                if track.get("controllerNumber") != cc or track.get("targetChannels") != [owner["midiChannel"]]:
                    fail("Automation routing must match its rack owner.", lane["id"])
                route = (target["instrumentId"], cc)
                if route in routes:
                    fail("Duplicate instrument/CC lane.", lane["id"])
                routes.add(route)
        for d in definitions:
            unique(d.get("id"))
            identity(d.get("name"))
            integer(d.get("revision"))
            if d.get("kind") not in RANK:
                fail("Unknown definition kind.", d["id"])
            if d["kind"] == "pattern":
                if d.get("source") != lane["source"]:
                    fail("Definition/source mismatch.", d["id"])
                validate_payload(lane["source"], d.get("payload"), target, d["id"])
                duration(config, lane, d)
                score_notes += len(d["payload"].get("notes", [])) if lane["source"] == "score" else 0

        def children(items, rank):
            if not isinstance(items, list) or not 1 <= len(items) <= 256:
                fail("Content needs 1–256 children.", lane["id"], "limit")
            for item in items:
                unique(item.get("id"))
                fields(item, {"id", "definitionId", "restTicks", "repeatIndex", "transpose"}, {"id"}, item["id"])
                if ("restTicks" in item) == ("definitionId" in item):
                    fail("Choose a definition reference or a rest.", item["id"])
            leaves(config, lane, items, rank)

        for d in definitions:
            if d["kind"] != "pattern":
                children(d.get("children"), RANK[d["kind"]])
        previous = None
        for c in sorted(clips, key=lambda c: integer(c.get("start"))):
            unique(c.get("id"))
            identity(c.get("name"))
            integer(c.get("length"), 1)
            integer(c.get("offset"))
            if c.get("mode") not in ("once", "loop"):
                fail("Clip mode is once or loop.", c["id"])
            end = integer(c["start"] + c["length"], 1)
            if previous and c["start"] < previous["start"] + previous["length"]:
                fail(
                    "Clips on the same lane overlap. Move or trim the requested window.",
                    c["id"],
                    "collision",
                    blockingClipId=previous["id"],
                )
            if end > m["end"] or lane.get("cycleTicks") is not None and end > lane["cycleTicks"]:
                fail("Clip exceeds song/cycle end; extend explicitly.", c["id"])
            children(c.get("children"), 3)
            length = content_length(config, lane, c["children"])
            integer(
                c.get("repeatIndexBase", 0) + ((c["offset"] + c["length"] - 1) // length if c["mode"] == "loop" else 0),
                0,
                40320000000,
            )
            previous = c
    if score_notes > 50000:
        fail("At most 50000 authored score notes.", code="limit")
    if sum(not t.get("automationTarget") for t in config["sequencer"].get("controllerSequencers", [])) > 16:
        fail("At most 16 generic controller sequencers.", code="limit")
    try:
        validate_transpositions(m, unique)
    except ValueError as exc:
        fail(str(exc), "transposition")
    return config


def upgrade(config, version=1):
    m = model(config)
    m["version"] = max(m["version"], version)
    config["version"] = max(config.get("version", 22), 22 + m["version"])


def empty_clip_config(tempo=120):
    from .cli.orchestron_cli import empty_performance_config

    config = empty_performance_config(tempo=tempo)
    config["version"] = 23
    config["sequencer"]["clipArrangement"] = {"version": 1, "revision": 0, "end": QUARTER, "lanes": []}
    config["sequencer"]["pianoRolls"] = [
        {
            "id": "piano-1",
            "name": "Piano Roll 1",
            "midiChannel": 2,
            "autoChordEnabled": False,
            "autoChordSize": 3,
            "velocity": 110,
            "scaleRoot": "C",
            "scaleType": "minor",
            "mode": "aeolian",
            "enabled": False,
        }
    ]
    return config
