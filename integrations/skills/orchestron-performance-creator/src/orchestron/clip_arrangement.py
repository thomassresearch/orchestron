"""Project version-23 clip definitions into the existing musical wire serializers.

The authored document is never rewritten into numeric slots. This module has no
backend dependency so the installed CLI uses the same compact schedule protocol.
"""
from copy import deepcopy
from fractions import Fraction

KEYS = {"sequencer": "tracks", "score": "scoreTracks", "drummer": "drummerTracks", "controller": "controllerSequencers", "arpeggiator": "arpeggiators"}


def project_clips(config):
    result = deepcopy(config)
    sequencer = result["sequencer"]
    model = sequencer.pop("clipArrangement")
    if config.get("version") != 23 or model.get("version") != 1:
        raise ValueError("Unsupported clip arrangement version.")
    schedules = {}
    if len(model["lanes"]) > 72 or type(model["end"]) is not int or not 0 < model["end"] <= 20160000000:
        raise ValueError("Invalid clip arrangement extent or lane count.")
    for lane in model["lanes"]:
        tracks = sequencer[KEYS[lane["source"]]]
        track = next(t for t in tracks if t["id"] == lane["id"])
        definitions = {d["id"]: d for d in lane["definitions"]}
        if len(definitions) != len(lane["definitions"]) or not 1 <= len(definitions) <= 512 or len(lane["clips"]) > 2048:
            raise ValueError("Invalid clip definition/clip count.")
        patterns = [d for d in lane["definitions"] if d["kind"] == "pattern"]
        slots = {d["id"]: i for i, d in enumerate(patterns)}
        timing = track.get("timing", {})
        beat = Fraction(20160) if lane["source"] == "arpeggiator" else Fraction(20160 * 4 * timing.get("beatRateDenominator", 1), timing.get("meterDenominator", 4) * timing.get("beatRateNumerator", 1))
        def leaves(items, rank=3):
            if not 1 <= len(items) <= 256:
                raise ValueError("Invalid clip child count.")
            spans = []
            for item in items:
                if "restTicks" in item:
                    spans.append({"pad": None, "length": item["restTicks"]})
                else:
                    definition = definitions[item["definitionId"]]
                    child_rank = {"pattern": 0, "group": 1, "supergroup": 2}[definition["kind"]]
                    if child_rank >= rank:
                        raise ValueError("Invalid clip nesting.")
                    if not child_rank:
                        if definition["source"] != lane["source"]:
                            raise ValueError("Invalid clip source.")
                        duration = definition["payload"]["lengthBeats"] * beat
                        if duration.denominator != 1:
                            raise ValueError("Clip duration must resolve to exact ticks.")
                        spans.append({"pad": slots[definition["id"]], "length": int(duration)})
                    else:
                        spans.extend(leaves(definition["children"], child_rank))
                if len(spans) > 65536:
                    raise ValueError("Clip expansion limit exceeded.")
            if any(type(s["length"]) is not int or not 0 < s["length"] <= 20160000000 for s in spans):
                raise ValueError("Invalid clip duration.")
            return spans
        clips = []
        for clip in sorted(lane["clips"], key=lambda c: c["start"]):
            clips.append({**{k: clip[k] for k in ("id", "start", "length", "offset", "mode")}, "content": leaves(clip["children"])})
        schedules[lane["id"]] = {"version": 1, "end": model["end"], "cycle_ticks": lane["cycleTicks"], "clips": clips}
        track.update(pads=[deepcopy(d["payload"]) for d in patterns], activePad=0, queuedPad=None, queuedEnabled=None,
                     padLoopEnabled=True, padLoopRepeat=False, padLoopPattern={"rootSequence": [], "groups": [], "superGroups": []})
    return result, schedules, model["end"]


def attach_schedules(wire, schedules, end):
    for key in ("tracks", "score_tracks", "controller_tracks", "arpeggiators"):
        for track in wire[key]:
            identity = track.get("track_id", track.get("arpeggiator_id"))
            if identity.startswith("drumrow:"):
                identity = identity.split(":")[1]
            if identity in schedules:
                track["clip_schedule"] = schedules[identity]
    wire["playback_end_step"] = (end + 2519) // 2520
    return wire
