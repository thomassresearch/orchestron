"""Project version-23/24/25 clip definitions into the existing musical wire serializers.

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
    if config.get("version") not in (23, 24, 25) or model.get("version") not in (1, 2, 3):
        raise ValueError("Unsupported clip arrangement version.")
    if model["version"] >= 2 and config["version"] not in (24, 25):
        raise ValueError("Clip model v2 requires performance v24.")
    if sum(not t.get("automationTarget") for t in sequencer.get("controllerSequencers", [])) > 16:
        raise ValueError("At most 16 generic controller sequencers are allowed.")
    if model["version"] == 3 and config["version"] != 25:
        raise ValueError("Clip transposition requires performance v25.")
    from .clip_transposition import validate_transpositions
    identities = set()
    def identity(value):
        if not isinstance(value, str) or not 1 <= len(value) <= 128 or value in identities:
            raise ValueError("Clip identities must be unique nonempty strings.")
        identities.add(value)
    for lane in model["lanes"]:
        identity(lane["id"])
        for definition in lane["definitions"]:
            identity(definition["id"])
            for item in definition.get("children", []):
                identity(item["id"])
        for clip in lane["clips"]:
            identity(clip["id"])
            for item in clip["children"]:
                identity(item["id"])
    validate_transpositions(model, identity)
    schedules = {}
    if len(model["lanes"]) > 72 or type(model["end"]) is not int or not 0 < model["end"] <= 20160000000:
        raise ValueError("Invalid clip arrangement extent or lane count.")
    for lane in model["lanes"]:
        tracks = sequencer[KEYS[lane["source"]]]
        track = next(t for t in tracks if t["id"] == lane["id"])
        target = track.get("automationTarget")
        if target:
            if model["version"] < 2 or config["version"] not in (24, 25) or lane["source"] != "controller":
                raise ValueError("Instrument automation requires clip model v2 and performance v24.")
            nodes = target.get("controllerNodeIds")
            if (not isinstance(target.get("instrumentId"), str) or not 1 <= len(target["instrumentId"]) <= 128
                    or not isinstance(nodes, list) or not 1 <= len(nodes) <= 256
                    or any(not isinstance(n, str) or not 1 <= len(n) <= 256 for n in nodes) or len(set(nodes)) != len(nodes)):
                raise ValueError("Invalid automation target.")
            binding = next((b for b in result.get("instruments", []) if b.get("id") == target["instrumentId"]), None)
            mappings = binding.get("performanceControllerMidiCCs", {}) if binding else {}
            ccs = {mappings[node] for node in target["controllerNodeIds"] if node in mappings}
            if binding and binding.get("midiChannel", 0) in range(1, 17) and len(ccs) == 1 and all(node in mappings for node in nodes):
                track["targetChannels"] = [binding["midiChannel"]]
                track["controllerNumber"] = next(iter(ccs))
            else:
                track["enabled"] = False
                track["targetChannels"] = track.get("targetChannels", [1])[:1] or [1]
        definitions = {d["id"]: d for d in lane["definitions"]}
        if len(definitions) != len(lane["definitions"]) or not 1 <= len(definitions) <= 512 or len(lane["clips"]) > 2048:
            raise ValueError("Invalid clip definition/clip count.")
        patterns = [d for d in lane["definitions"] if d["kind"] == "pattern"]
        if target and any(not 2 <= len(d["payload"].get("keypoints", [])) <= 10 for d in patterns):
            raise ValueError("Automation curves require 2–10 points.")
        if lane["source"] == "controller":
            for pattern in patterns:
                payload = pattern["payload"]
                duration = payload.get("curveDurationTicks")
                if duration is not None and (not target or type(duration) is not int or not 0 < duration <= 20160000000):
                    raise ValueError("Invalid instrument automation duration.")
                if target:
                    positions = sorted(p["position"] for p in payload["keypoints"])
                    if positions[0] != 0 or positions[-1] != 1 or len(set(positions)) != len(positions):
                        raise ValueError("Automation curves require distinct points and both endpoints.")
        slots = {d["id"]: i for i, d in enumerate(patterns)}
        timing = track.get("timing", {})
        beat = Fraction(20160) if lane["source"] == "arpeggiator" else Fraction(20160 * 4 * timing.get("beatRateDenominator", 1), timing.get("meterDenominator", 4) * timing.get("beatRateNumerator", 1))
        plans, plan_indexes = [], {}
        profiles = {p["id"]: p["plan"] for p in lane.get("transposeProfiles", [])}
        def intern(plan):
            import json
            key = json.dumps(plan, sort_keys=True, separators=(",", ":"))
            if key not in plan_indexes:
                plan_indexes[key] = len(plans)
                plans.append(deepcopy(plan))
            return plan_indexes[key]
        def leaves(items, rank=3, path=(), refs=(), placements=None):
            if not 1 <= len(items) <= 256:
                raise ValueError("Invalid clip child count.")
            spans = []
            for item in items:
                if "restTicks" in item:
                    spans.append({"pad": None, "length": item["restTicks"], **({"transpose_refs": []} if model["version"] == 3 else {})})
                else:
                    definition = definitions[item["definitionId"]]
                    item_path = (*path, item["id"])
                    contributions = list(refs)
                    if definition.get("transposeProfileId"):
                        contributions.append(intern(profiles[definition["transposeProfileId"]]))
                    if "transpose" in item:
                        contributions.append(intern(item["transpose"]))
                    if placements and item_path in placements:
                        contributions.append(intern(placements[item_path]))
                    child_rank = {"pattern": 0, "group": 1, "supergroup": 2}[definition["kind"]]
                    if child_rank >= rank:
                        raise ValueError("Invalid clip nesting.")
                    if not child_rank:
                        if definition["source"] != lane["source"]:
                            raise ValueError("Invalid clip source.")
                        payload = definition["payload"]
                        extended = payload.get("curveDurationTicks") if lane["source"] == "controller" and track.get("controllerMode", "curve") == "curve" else None
                        duration = Fraction(extended) if extended is not None else payload["lengthBeats"] * beat
                        if extended is not None and (not track.get("automationTarget") or len(payload.get("keypoints", [])) > 10 or type(extended) is not int):
                            raise ValueError("Invalid instrument automation curve.")
                        if duration.denominator != 1:
                            raise ValueError("Clip duration must resolve to exact ticks.")
                        spans.append({"pad": slots[definition["id"]], "length": int(duration), **({"transpose_refs": contributions} if model["version"] == 3 else {})})
                    else:
                        spans.extend(leaves(definition["children"], child_rank, item_path, contributions, placements))
                if len(spans) > 65536:
                    raise ValueError("Clip expansion limit exceeded.")
            if any(type(s["length"]) is not int or not 0 < s["length"] <= 20160000000 for s in spans):
                raise ValueError("Invalid clip duration.")
            return spans
        clips = []
        for clip in sorted(lane["clips"], key=lambda c: c["start"]):
            clips.append({**{k: clip[k] for k in ("id", "start", "length", "offset", "mode")}, "content": leaves(clip["children"], placements={tuple(p["path"]):p["plan"] for p in clip.get("transposePlacements", [])}), **({"repeat_index_base": clip.get("repeatIndexBase", 0)} if model["version"] == 3 else {})})
            duration = sum(s["length"] for s in clips[-1]["content"])
            if clip.get("repeatIndexBase", 0) + ((clip["offset"] + clip["length"] - 1) // duration if clip["mode"] == "loop" else 0) > 40320000000:
                raise ValueError("Logical repetition extent exceeded.")
        schedules[lane["id"]] = {"version": 2 if model["version"] == 3 else 1, **({"transpose_plans": plans} if model["version"] == 3 else {}), "end": model["end"], "cycle_ticks": lane["cycleTicks"], "clips": clips}
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
