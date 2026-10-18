"""Portable score contract. All stored times are rational quarter-note strings."""

from __future__ import annotations

import copy
from fractions import Fraction
from typing import Any


class CompositionError(ValueError):
    pass


MODES = {"ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"}
KEYS = {"C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B", "Cb"}


def integer(value: Any, low: int, high: int, name: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise CompositionError(f"{name} must be an integer in {low}..{high}.")
    return value


def qn(value: Any) -> Fraction:
    if not isinstance(value, (str, int, Fraction)) or isinstance(value, bool):
        raise CompositionError("Musical time must be an integer or rational string, such as '1/3'.")
    try:
        result = Fraction(value)
    except (ValueError, ZeroDivisionError) as exc:
        raise CompositionError("Invalid rational musical time.") from exc
    if result.denominator > 960 or abs(result) > 16384:
        raise CompositionError("Musical time exceeds the supported range or precision.")
    return result


def end(event: dict) -> Fraction:
    return qn(event["onset_qn"]) + qn(event["duration_qn"])


def validate(score: dict) -> dict:
    if (
        not isinstance(score, dict)
        or score.get("schema") != "orchestron.composition"
        or type(score.get("version")) is not int
        or score["version"] != 1
    ):
        raise CompositionError("Expected an orchestron.composition score, version 1.")
    integer(score.get("tempo"), 30, 300, "tempo")
    if not isinstance(score.get("mode"), str) or score["mode"] not in MODES:
        raise CompositionError("Unsupported mode.")
    if not isinstance(score.get("key"), str) or score["key"] not in KEYS:
        raise CompositionError("Unsupported key spelling.")
    meter = score.get("meter", [])
    if (
        not isinstance(meter, list)
        or len(meter) != 2
        or type(meter[0]) is not int
        or meter[0] not in range(2, 8)
        or type(meter[1]) is not int
        or meter[1] not in (4, 8)
    ):
        raise CompositionError("Meter must use numerator 2..7 and denominator 4 or 8.")
    length = qn(score.get("length_qn"))
    if length <= 0 or length > 1024:
        raise CompositionError("Score length must be positive and at most 1024 quarter notes.")
    parts = score.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 16:
        raise CompositionError("A score needs 1..16 parts.")
    ids = set()
    notes_by_channel: dict[tuple[int, int], list] = {}
    count = 0
    for part in parts:
        if not isinstance(part, dict) or not isinstance(part.get("id"), str) or not part["id"] or part["id"] in ids:
            raise CompositionError("Parts need unique nonempty IDs.")
        ids.add(part["id"])
        channel = integer(part.get("channel"), 1, 16, "channel")
        integer(part.get("program", 0), 0, 127, "program")
        events = part.get("events")
        if not isinstance(events, list):
            raise CompositionError("Part events must be a list.")
        count += len(events)
        if count > 8192:
            raise CompositionError("Score exceeds 8192 note events.")
        for event in events:
            if not isinstance(event, dict):
                raise CompositionError("Note events must be objects.")
            pitch = integer(event.get("pitch_midi"), 0, 127, "pitch_midi")
            integer(event.get("velocity"), 1, 127, "velocity")
            onset, duration = qn(event.get("onset_qn")), qn(event.get("duration_qn"))
            if onset < 0 or duration <= 0 or onset + duration > length:
                raise CompositionError("Notes must have positive duration and lie inside the score.")
            notes_by_channel.setdefault((channel, pitch), []).append((onset, onset + duration))
    for events in notes_by_channel.values():
        events.sort()
        if any(a[1] > b[0] for a, b in zip(events, events[1:])):
            raise CompositionError(
                "Same-pitch notes overlap on one MIDI channel; use separate channels or shorten them."
            )
    return score


def event(pitch: int, start: Fraction, duration: Fraction, velocity: int = 88) -> dict:
    return {"pitch_midi": pitch, "onset_qn": str(start), "duration_qn": str(duration), "velocity": velocity}


def verify_melody_locks(parent: dict, score: dict, locks: list[dict]) -> None:
    for lock in locks:
        start, stop = qn(lock["start_qn"]), qn(lock["end_qn"])

        def protected_events(material):
            return sorted(
                (qn(e["onset_qn"]), qn(e["duration_qn"]), e["pitch_midi"], e["velocity"])
                for e in material["parts"][0]["events"]
                if qn(e["onset_qn"]) < stop and end(e) > start
            )

        if stop > qn(score["length_qn"]) or protected_events(score) != protected_events(parent):
            raise CompositionError("The revision changes a locked melody passage, including its silence.")


def to_music21(score: dict, *, solo: bool = False):
    from music21 import instrument, meter, note, stream, tempo

    validate(score)
    result = stream.Score()
    for index, part in enumerate(score["parts"][:1] if solo else score["parts"]):
        target = stream.Part(id=part["id"])
        target.partName = part.get("name", part["id"])
        inst = instrument.Instrument()
        inst.midiProgram, inst.midiChannel = part.get("program", 0), part["channel"] - 1
        target.insert(0, inst)
        target.insert(0, meter.TimeSignature("/".join(map(str, score["meter"]))))
        if index == 0:
            target.insert(0, tempo.MetronomeMark(number=score["tempo"]))
        for item in part["events"]:
            n = note.Note(item["pitch_midi"], quarterLength=qn(item["duration_qn"]))
            n.volume.velocity = item["velocity"]
            target.insert(qn(item["onset_qn"]), n)
        target.insert(qn(score["length_qn"]), note.Rest(quarterLength=0))
        result.insert(0, target)
    return result


def assemble(scores: list[dict], title: str) -> dict:
    if not scores:
        raise CompositionError("Select at least one phrase for the arrangement.")
    result = copy.deepcopy(validate(scores[0]))
    result["title"] = title
    result["parts"] = []
    result["sections"] = []
    parts: dict[str, dict] = {}
    position = Fraction(0)
    for score in scores:
        validate(score)
        if any(score[k] != result[k] for k in ("tempo", "meter", "key", "mode")):
            raise CompositionError("Assembled phrases must share tempo, meter, key and mode.")
        result["sections"].append(
            {"title": score.get("title", "Phrase"), "onset_qn": str(position), "duration_qn": score["length_qn"]}
        )
        for part in score["parts"]:
            target = parts.setdefault(part["id"], {**copy.deepcopy(part), "events": []})
            if (target["channel"], target.get("program", 0)) != (part["channel"], part.get("program", 0)):
                raise CompositionError("A part's channel and program must be consistent across phrases.")
            for item in part["events"]:
                target["events"].append({**item, "onset_qn": str(position + qn(item["onset_qn"]))})
        position += qn(score["length_qn"])
    result["parts"] = list(parts.values())
    result["length_qn"] = str(position)
    return validate(result)
