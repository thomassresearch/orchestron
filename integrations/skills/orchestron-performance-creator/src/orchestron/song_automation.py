"""Instrument-owned automation: identity-based routing, split/merge and long curves."""

from copy import deepcopy
import math

from .song_model import fail, fields, find, integer, lane_for, model, source_for, ticks, uid, upgrade
from .song_authoring import put_lane, put_definition, put_clip, stable_id


def controls(binding, patches):
    patch = next((p for p in patches if p["id"] == binding["patchId"]), None)
    if (
        not patch
        or patch.get("always_on", patch.get("alwaysOn", False))
        or not 1 <= binding.get("midiChannel", 0) <= 16
    ):
        return []
    return [d for d in patch.get("performance_controllers", []) if not d.get("error")]


def mapped(binding, patches):
    mappings = binding.get("performanceControllerMidiCCs", {})
    return [
        d
        for d in controls(binding, patches)
        if type(mappings.get(d["node_id"])) is int and 1 <= mappings[d["node_id"]] <= 50
    ]


def discover(config, patches, instrument_id=None):
    result = []
    for binding in config.get("instruments", []):
        if instrument_id and binding["id"] != instrument_id:
            continue
        eligible = controls(binding, patches)
        for d in eligible:
            result.append(
                {
                    "instrumentId": binding["id"],
                    **d,
                    "effectiveValue": binding.get("performanceControllerValues", {}).get(d["node_id"], d["default"]),
                    "midiCC": binding.get("performanceControllerMidiCCs", {}).get(d["node_id"]),
                    "channel": binding["midiChannel"],
                    "ownedLaneIds": [
                        t["id"]
                        for t in config["sequencer"].get("controllerSequencers", [])
                        if t.get("automationTarget", {}).get("instrumentId") == binding["id"]
                        and d["node_id"] in t["automationTarget"]["controllerNodeIds"]
                    ],
                }
            )
    return {"controllers": result, "catalogSource": "backend patch discovery", "count": len(result)}


def midi(value, definition):
    if definition["controller_type"] == "bool":
        return 127 if value >= 0.5 else 0
    lo, hi = definition["min"], definition["max"]
    fraction = (
        (math.log(max(lo, value)) - math.log(lo)) / (math.log(hi) - math.log(lo))
        if definition.get("scale") == "logarithmic"
        else (value - lo) / (hi - lo)
    )
    return max(0, min(127, math.floor(fraction * 127 + 0.5)))


def route(track, config, patches):
    target = track["automationTarget"]
    owner = next((i for i in config["instruments"] if i["id"] == target["instrumentId"]), None)
    available = {d["node_id"]: d for d in mapped(owner, patches)} if owner else {}
    valid = [n for n in target["controllerNodeIds"] if n in available]
    ccs = {owner["performanceControllerMidiCCs"][n] for n in valid} if owner else set()
    suspended = len(ccs) != 1 or len(valid) != len(target["controllerNodeIds"])
    track["automationSuspended"] = suspended
    if owner and 1 <= owner.get("midiChannel", 0) <= 16:
        track["targetChannels"] = [owner["midiChannel"]]
    if not suspended:
        track["controllerNumber"] = next(iter(ccs))
    return suspended


def clone_lane(lane, new_id):
    # Payload-local IDs (notes/curve points) are independent too, but drum row keys are retained.
    mapping = {lane["id"]: new_id}

    def collect(value):
        if isinstance(value, dict):
            if "id" in value:
                mapping.setdefault(value["id"], uid())
            for v in value.values():
                collect(v)
        elif isinstance(value, list):
            for v in value:
                collect(v)

    collect(lane)

    def remap(value, key=None):
        if isinstance(value, dict):
            return {k: remap(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v, key) for v in value]
        return (
            mapping.get(value, value)
            if isinstance(value, str) and key in ("id", "definitionId", "transposeProfileId", "path")
            else value
        )

    return remap(lane)


def musical_identity(track, lane):
    ids = {d["id"]: i for i, d in enumerate(lane["definitions"])}

    def clean(v):
        if isinstance(v, list):
            return [clean(i) for i in v]
        if isinstance(v, dict):
            return {
                k: ids.get(value) if k == "definitionId" else clean(value)
                for k, value in v.items()
                if k not in ("id", "name", "revision", "color")
            }
        return v

    return clean(
        {
            "mode": track["controllerMode"],
            "reset": track["resetValue"],
            "timing": track["timing"],
            "definitions": lane["definitions"],
            "clips": lane["clips"],
            "cycle": lane["cycleTicks"],
        }
    )


def reconcile(config, patches, choices=None):
    choices = choices or {}
    m, sequencer = model(config), config["sequencer"]
    entries, original_ids = {}, set()
    for track in sequencer.get("controllerSequencers", []):
        if not track.get("automationTarget"):
            continue
        original_ids.add(track["id"])
        lane = lane_for(config, track["id"])
        target = track["automationTarget"]
        owner = next((i for i in config["instruments"] if i["id"] == target["instrumentId"]), None)
        valid = {d["node_id"] for d in mapped(owner, patches)} if owner else set()
        partitions = {}
        for node in target["controllerNodeIds"]:
            cc = owner["performanceControllerMidiCCs"][node] if node in valid else None
            partitions.setdefault(cc, []).append(node)
        for index, (cc, nodes) in enumerate(partitions.items()):
            next_track, next_lane = deepcopy(track), deepcopy(lane)
            if index:
                next_track["id"] = uid()
                next_lane = clone_lane(lane, next_track["id"])
            next_track["automationTarget"]["controllerNodeIds"] = nodes
            route(next_track, config, patches)
            key = (
                f"{target['instrumentId']}:{cc}"
                if cc is not None
                else f"{target['instrumentId']}:off:{next_track['id']}"
            )
            entries.setdefault(key, []).append((next_track, next_lane))
    resolved, removed = [], []
    for key, candidates in entries.items():
        chosen = candidates[0]
        if any(musical_identity(*entry) != musical_identity(*chosen) for entry in candidates[1:]):
            chosen = next((e for e in candidates if e[0]["id"] == choices.get(key)), None)
            if chosen is None:
                fail(
                    "Merged controllers have different automation. Supply choices[key] with the lane to retain.",
                    key,
                    "automation_merge_conflict",
                    candidates=[e[0]["id"] for e in candidates],
                )
        nodes = list(dict.fromkeys(n for t, _ in candidates for n in t["automationTarget"]["controllerNodeIds"]))
        owner = next(
            (i for i in config["instruments"] if i["id"] == chosen[0]["automationTarget"]["instrumentId"]), None
        )
        if owner and not chosen[0]["automationSuspended"]:
            nodes.extend(
                d["node_id"]
                for d in mapped(owner, patches)
                if d["node_id"] not in nodes
                and owner["performanceControllerMidiCCs"][d["node_id"]] == chosen[0]["controllerNumber"]
            )
        chosen[0]["automationTarget"]["controllerNodeIds"] = nodes
        removed.extend(t["id"] for t, _ in candidates if t["id"] != chosen[0]["id"])
        resolved.append(chosen)
    # Stable order for unchanged lanes; split lanes follow their owner's existing automation.
    by_id = {t["id"]: (t, lane_item) for t, lane_item in resolved}
    tracks, lanes = [], []
    for t in sequencer.get("controllerSequencers", []):
        if t["id"] not in original_ids:
            tracks.append(t)
        elif t["id"] in by_id:
            tracks.append(by_id[t["id"]][0])
    for lane_item in m["lanes"]:
        if lane_item["id"] not in original_ids:
            lanes.append(lane_item)
        elif lane_item["id"] in by_id:
            lanes.append(by_id[lane_item["id"]][1])
    tracks.extend(t for t, _ in resolved if t["id"] not in original_ids)
    lanes.extend(lane_item for t, lane_item in resolved if t["id"] not in original_ids)
    sequencer["controllerSequencers"], m["lanes"] = tracks, lanes
    return {
        "lanes": [
            {
                "laneId": t["id"],
                "suspended": t["automationSuspended"],
                "target": t["automationTarget"],
                "channel": t["targetChannels"],
                "cc": t["controllerNumber"],
            }
            for t, _ in resolved
        ],
        "removedLaneIds": removed,
    }


def generate(config, patches, spec):
    fields(spec, {"instrumentId", "laneId", "clipId", "start", "length", "id"}, {"instrumentId"}, "automation")
    owner = find(config.get("instruments", []), spec["instrumentId"], "instrumentId")
    eligible = mapped(owner, patches)
    if not eligible:
        fail("No eligible mapped controls. Discover/map controllers on a MIDI rack instance first.", "instrumentId")
    if "laneId" in spec:
        lane = lane_for(config, spec["laneId"])
        clip = find(lane["clips"], spec.get("clipId"))
        source = source_for(config, lane)
        channel = source.get("targetChannel", source.get("midiChannel"))
        arp = next(
            (
                a
                for a in config["sequencer"].get("arpeggiators", [])
                if a.get("inputChannel") == channel and a.get("enabled") and a.get("processingMode") != "mute"
            ),
            None,
        )
        channel = arp["targetChannel"] if arp else channel
        if lane["source"] == "controller" or channel != owner["midiChannel"]:
            fail("Selected instrument does not receive this clip's notes.", "instrumentId")
        start, length = clip["start"], clip["length"]
    else:
        start, length = ticks(spec.get("start", 0)), ticks(spec.get("length", 0))
        integer(length, 1)
    groups = {}
    for definition in eligible:
        groups.setdefault(owner["performanceControllerMidiCCs"][definition["node_id"]], []).append(definition)
    created, reused, ids = 0, 0, []
    upgrade(config, 2)
    for cc, group in groups.items():
        track = next(
            (
                t
                for t in config["sequencer"]["controllerSequencers"]
                if t.get("automationTarget", {}).get("instrumentId") == owner["id"]
                and t["controllerNumber"] == cc
                and not t.get("automationSuspended")
            ),
            None,
        )
        if not track:
            lane_id = stable_id(spec.get("id", owner["id"]), f"cc{cc}")
            put_lane(
                config,
                {
                    "id": lane_id,
                    "source": "controller",
                    "name": f"{owner['id']} CC {cc}",
                    "channel": owner["midiChannel"],
                    "settings": {"controllerNumber": cc},
                    "automationTarget": {
                        "instrumentId": owner["id"],
                        "controllerNodeIds": [d["node_id"] for d in group],
                    },
                },
            )
            track = source_for(config, lane_for(config, lane_id))
            track["automationSuspended"] = False
        lane = lane_for(config, track["id"])
        same = next((c for c in lane["clips"] if c["start"] == start and c["length"] == length), None)
        if same:
            reused += 1
            ids.append({"laneId": lane["id"], "clipId": same["id"]})
            continue
        if track["controllerMode"] != "curve":
            fail("Switch the existing automation lane to Curve Mode before generation.", lane["id"])
        blockers = [c["id"] for c in lane["clips"] if c["start"] < start + length and c["start"] + c["length"] > start]
        if blockers:
            fail(
                "Automation overlaps existing music; move/trim it before generating.",
                lane["id"],
                "collision",
                blockingClipIds=blockers,
            )
        first = group[0]
        value = midi(owner.get("performanceControllerValues", {}).get(first["node_id"], first["default"]), first)
        definition_id = stable_id(lane["id"], f"curve-{start}")
        put_definition(
            config,
            lane["id"],
            {
                "id": definition_id,
                "payload": {
                    "curveDurationTicks": length,
                    "keypoints": [
                        {"id": "start", "position": 0, "value": value},
                        {"id": "end", "position": 1, "value": value},
                    ],
                },
            },
        )
        clip_id = stable_id(lane["id"], f"clip-{start}")
        put_clip(config, lane["id"], {"id": clip_id, "start": start, "length": length, "children": [definition_id]})
        created += 1
        ids.append({"laneId": lane["id"], "clipId": clip_id, "definitionId": definition_id})
    return {
        "summary": f"Generated {created} automation curves; retained {reused} existing windows.",
        "created": created,
        "reused": reused,
        "targets": ids,
    }


def command(config, patches, op, value):
    if op == "automation.generate":
        return generate(config, patches, value)
    if op == "automation.reconcile":
        fields(value, {"choices"})
        return reconcile(config, patches, value.get("choices"))
    if op == "automation.map":
        fields(value, {"instrumentId", "mappings", "choices"}, {"instrumentId", "mappings"})
        owner = find(config["instruments"], value["instrumentId"])
        valid = {d["node_id"] for d in controls(owner, patches)}
        for node, cc in value["mappings"].items():
            if node not in valid:
                fail("Unknown or ineligible controller node.", node)
            mappings = owner.setdefault("performanceControllerMidiCCs", {})
            if cc is None:
                mappings.pop(node, None)
            else:
                mappings[node] = integer(cc, 1, 50, node)
        return reconcile(config, patches, value.get("choices"))
    if op == "automation.curve":
        fields(value, {"laneId", "definitionId", "points", "duration", "clipId"}, {"laneId", "definitionId"})
        lane = lane_for(config, value["laneId"])
        if not source_for(config, lane).get("automationTarget"):
            fail("Independent curves require an instrument-bound lane.")
        patch = {}
        if "points" in value:
            patch["keypoints"] = value["points"]
        if "duration" in value:
            patch["curveDurationTicks"] = ticks(value["duration"])
        if "clipId" in value:
            patch["curveDurationTicks"] = find(lane["clips"], value["clipId"])["length"]
        return put_definition(config, lane["id"], {"id": value["definitionId"], "payload": patch})
    fail("Unknown automation operation.")
