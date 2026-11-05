"""Reusable source/definition/clip operations shared by batch and incremental authoring."""

from copy import deepcopy

from .song_model import (
    KEYS,
    QUARTER,
    beat_ticks,
    content_length,
    fail,
    fields,
    find,
    fingerprint,
    identity,
    integer,
    lane_for,
    model,
    source_for,
    target_at,
    ticks,
    uid,
    upgrade,
    validate,
)


def stable_id(parent, label):
    return parent[:70] + ":" + str(label)[:20] + ":" + fingerprint([parent, label])[:16]


def merge(before, after):
    result = deepcopy(before)
    for key, value in after.items():
        result[key] = (
            merge(result[key], value)
            if isinstance(value, dict) and isinstance(result.get(key), dict)
            else deepcopy(value)
        )
    return result


def children(items, parent, config, lane, meter=None):
    if not isinstance(items, list) or not 1 <= len(items) <= 256:
        fail("Supply 1–256 definition references/rests.", parent)
    result = []
    for i, raw in enumerate(items):
        raw = {"definitionId": raw} if isinstance(raw, str) else raw
        fields(
            raw, {"id", "definitionId", "rest", "restTicks", "transpose", "repeatIndex"}, path=f"{parent}.children[{i}]"
        )
        item = deepcopy(raw)
        item.setdefault("id", stable_id(parent, f"ref{i}"))
        if "rest" in item:
            item["restTicks"] = ticks(item.pop("rest"), beat=beat_ticks(config, lane), meter=meter)
        if "repeatIndex" in item:
            upgrade(config, 4)
        elif "transpose" in item:
            upgrade(config, 3)
        result.append(item)
    return result


def put_lane(config, spec):
    from .cli import orchestron_cli as cli

    fields(
        spec, {"id", "source", "name", "channel", "timing", "settings", "automationTarget"}, {"id", "source"}, "lane"
    )
    identity(spec["id"])
    if spec["source"] not in KEYS:
        fail("Unknown source kind.", "lane.source")
    m = model(config)
    existing = next((lane_item for lane_item in m["lanes"] if lane_item["id"] == spec["id"]), None)
    if existing and existing["source"] != spec["source"]:
        fail("Changing a lane's source kind requires a new lane ID.", "lane.source")
    source = spec["source"]
    timing = merge(cli.default_timing(config["sequencer"].get("tempoBPM", 120)), spec.get("timing", {}))
    fields(
        timing,
        {
            "tempoBPM",
            "meterNumerator",
            "meterDenominator",
            "stepsPerBeat",
            "beatRateNumerator",
            "beatRateDenominator",
            "beatUnit",
        },
        path="lane.timing",
    )
    channel = integer(spec.get("channel", 1), 1, 16, "lane.channel")
    if existing:
        lane, track = existing, source_for(config, existing)
    else:
        scratch = cli.empty_performance_config(tempo=config["sequencer"].get("tempoBPM", 120))
        if source == "sequencer":
            track = cli.add_melodic_track_to_config(
                scratch,
                channel=channel,
                name=spec.get("name", spec["id"]),
                length_beats=4,
                scale_root="C",
                scale_type="minor",
                mode="aeolian",
                enabled=True,
                steps_pattern=None,
                grid_pattern=None,
                velocity=100,
                timing_override=timing,
            )
        elif source == "drummer":
            track = cli.add_drummer_track_to_config(
                scratch,
                channel=channel,
                name=spec.get("name", spec["id"]),
                length_beats=4,
                groove=None,
                enabled=True,
                timing_override=timing,
            )
        elif source == "controller":
            track = cli.add_controller_sequencer_to_config(
                scratch,
                controller_number=1,
                name=spec.get("name", spec["id"]),
                length_beats=4,
                curve="0:0,1:0",
                enabled=True,
                timing_override=timing,
            )
            track["targetChannels"] = [channel]
        elif source == "score":
            track = {
                "id": spec["id"],
                "name": spec.get("name", spec["id"]),
                "midiChannel": channel,
                "timing": timing,
                "enabled": True,
                "lengthBeats": 16,
                "scaleRoot": "C",
                "scaleType": "minor",
                "mode": "aeolian",
                "launchQuantization": "bar",
                "activePad": 0,
                "queuedPad": None,
                "pads": [{"lengthBeats": 16, "notes": [], "scaleRoot": "C", "scaleType": "minor", "mode": "aeolian"}],
            }
        else:
            track = cli.normalize_arpeggiator(
                {
                    "id": spec["id"],
                    "name": spec.get("name", spec["id"]),
                    "inputChannel": 1,
                    "targetChannel": channel,
                    "enabled": True,
                    "playbackMode": "arranger",
                }
            )
        track.update(
            id=spec["id"], padLoopEnabled=True, padLoopRepeat=False, padLoopPattern=cli.empty_pad_loop_pattern()
        )
        lane = {"id": spec["id"], "source": source, "cycleTicks": None, "definitions": [], "clips": []}
        m["lanes"].append(lane)
        config["sequencer"].setdefault(KEYS[source], []).append(track)
    if "name" in spec:
        track["name"] = identity(spec["name"])
    if "channel" in spec:
        track[
            "targetChannel"
            if source == "arpeggiator"
            else "targetChannels"
            if source == "controller"
            else "midiChannel"
        ] = [channel] if source == "controller" else channel
    if "timing" in spec or not existing:
        track["timing"] = merge(track.get("timing", timing), spec.get("timing", {}))
    settings = spec.get("settings", {})
    common = {"enabled"}
    allowed = {
        "sequencer": {"syncToTrackId"},
        "score": {"launchQuantization"},
        "drummer": {"rows"},
        "controller": {"controllerNumber", "controllerMode", "resetValue", "targetChannels"},
        "arpeggiator": {"inputChannel", "playbackMode", "holdMode", "processingMode", "restartMode", "launchQuantize"},
    }[source]
    fields(settings, common | allowed, path="lane.settings")
    track.update(deepcopy(settings))
    if "automationTarget" in spec:
        if source != "controller":
            fail("Automation targets belong to controller lanes.", "lane.automationTarget")
        track["automationTarget"] = deepcopy(spec["automationTarget"])
        upgrade(config, 2)
    return {"laneId": lane["id"], "source": source, "created": not bool(existing)}


def make_payload(config, lane, spec, previous=None):
    from .cli import orchestron_cli as cli

    source, track = lane["source"], source_for(config, lane)
    timing = track.get("timing", cli.default_timing())
    music = spec.get("music", {})
    common = {"lengthBeats"}
    by_source = {
        "sequencer": {"scaleRoot", "scaleType", "mode", "steps", "grid", "velocity"},
        "drummer": {"groove", "hits"},
        "score": {"scaleRoot", "scaleType", "mode", "notes"},
        "controller": {"curve"},
        "arpeggiator": set(),
    }
    fields(music, common | by_source[source], path="pattern.music")
    length = music.get("lengthBeats", (previous or {}).get("lengthBeats", 4))
    if source == "sequencer":
        payload = cli.configured_melodic_pad(
            {
                "length_beats": length,
                "scale_root": music.get("scaleRoot", "C"),
                "scale_type": music.get("scaleType", "minor"),
                "mode": music.get("mode", "aeolian"),
                "steps_pattern": music.get("steps"),
                "grid_pattern": music.get("grid"),
                "velocity": music.get("velocity", 100),
            },
            timing=timing,
        )
    elif source == "drummer":
        definition = {"length_beats": length}
        if "hits" in music:
            hits = (
                cli.parse_drum_hits(music["hits"], field="music.hits")
                if isinstance(music["hits"], str)
                else music["hits"]
            )
            definition["hits"] = cli.validate_drum_hits(
                hits, step_count=cli.resolved_pad_steps(length, timing), field="music.hits"
            )
            for hit in hits:
                if not any(r["key"] == hit["key"] for r in track["rows"]):
                    track["rows"].append({"id": stable_id(lane["id"], f"key{hit['key']}"), "key": hit["key"]})
        if "groove" in music:
            definition["groove"] = music["groove"]
        payload = cli.configured_drummer_pad(track["rows"], definition, timing=timing)
    elif source == "score":
        payload = {
            "lengthBeats": length,
            "scaleRoot": music.get("scaleRoot", "C"),
            "scaleType": music.get("scaleType", "minor"),
            "mode": music.get("mode", "aeolian"),
            "notes": deepcopy(music.get("notes", [])),
        }
    elif source == "controller":
        payload = cli.default_controller_pad(length_beats=length, timing=timing)
        if "curve" in music:
            payload["keypoints"] = (
                cli.parse_curve(music["curve"]) if isinstance(music["curve"], str) else deepcopy(music["curve"])
            )
    else:
        payload = cli.normalize_arpeggiator_pad({"lengthBeats": length})
    # Payload patch is explicit and lossless, including fields inactive in the current mode.
    # A music expression replaces musical material; a payload-only update preserves hidden cells.
    if previous is not None and not music:
        payload = deepcopy(previous)
    elif previous is not None and not any(k in music for k in ("steps", "grid", "hits", "groove", "curve", "notes")):
        # A length/theory edit retains every hidden cell and inactive controller dataset.
        updates = {
            k: payload[k] for k in ("lengthBeats", "stepCount", "scaleRoot", "scaleType", "mode") if k in payload
        }
        payload = {**deepcopy(previous), **updates}
    patch = spec.get("payload", {})
    allowed = set(payload) | {"curveDurationTicks"} if source == "controller" else set(payload)
    fields(patch, allowed, path="pattern.payload")
    payload = merge(payload, patch)
    if source == "controller":
        for index, point in enumerate(payload["keypoints"]):
            point["id"] = (
                (previous or {}).get("keypoints", [])[index]["id"]
                if previous and index < len(previous.get("keypoints", []))
                else stable_id(spec["id"], f"point{index}")
            )
    return payload


def edit_cells(config, lane_id, spec):
    fields(spec, {"definitionId", "target", "scope", "edits"}, {"edits"}, "cells")
    if ("target" in spec) == ("definitionId" in spec):
        fail("Choose definitionId for a shared edit or target for an occurrence edit.", "cells")
    if "target" in spec:
        lane, _, ancestry = target_at(config, spec["target"])
        definition = ancestry[-1][1]
    else:
        lane = lane_for(config, lane_id)
        definition = find(lane["definitions"], spec["definitionId"])
    if definition["kind"] != "pattern" or lane["source"] not in ("sequencer", "drummer"):
        fail("Cell editing requires a melodic or drummer pattern.")
    payload = deepcopy(definition["payload"])
    for edit in spec["edits"]:
        fields(edit, {"step", "rowId", "key", "values"}, {"step", "values"}, "cells.edits")
        values = edit["values"]
        fields(
            values,
            {
                "note",
                "chord",
                "hold",
                "velocity",
                "active",
                "timingOffsetPercent",
                "ratchets",
                "ratchetEndVelocity",
                "strumDirection",
                "strumSpreadPercent",
            },
            path="cells.edits.values",
        )
        steps = payload.get("steps")
        if lane["source"] == "drummer":
            row_id = edit.get("rowId")
            if "key" in edit:
                matches = [r for r in source_for(config, lane)["rows"] if r["key"] == edit["key"]]
                if len(matches) != 1:
                    fail("Drum key is missing or ambiguous; select rowId.")
                row_id = matches[0]["id"]
            row = next((r for r in payload["rows"] if r["rowId"] == row_id), None)
            if row is None:
                fail("Select a stored drum row.", "rowId")
            steps = row["steps"]
        step = integer(edit["step"], 0, len(steps) - 1, "step")
        steps[step].update(deepcopy(values))
    if "target" in spec:
        return edit_occurrence(config, spec["target"], {"payload": payload}, spec.get("scope", "local"))
    return put_definition(config, lane["id"], {"id": definition["id"], "payload": payload})


def put_definition(config, lane_id, spec):
    fields(
        spec,
        {"id", "name", "kind", "music", "payload", "children", "color", "presetId", "transpose"},
        {"id"},
        "definition",
    )
    lane = lane_for(config, lane_id)
    previous = next((d for d in lane["definitions"] if d["id"] == spec["id"]), None)
    kind = spec.get("kind", previous["kind"] if previous else "pattern")
    if kind not in ("pattern", "group", "supergroup") or previous and previous["kind"] != kind:
        fail("A definition kind cannot be changed in place.", "definition.kind")
    result = (
        deepcopy(previous)
        if previous
        else {"id": identity(spec["id"]), "name": spec.get("name", spec["id"]), "kind": kind, "revision": 0}
    )
    for key in ("name", "color", "presetId"):
        if key in spec:
            result[key] = deepcopy(spec[key])
    if kind == "pattern":
        if "children" in spec:
            fail("Patterns hold music; groups hold children.", "definition.children")
        result.update(
            source=lane["source"],
            payload=make_payload(config, lane, spec, previous.get("payload") if previous else None),
        )
    elif "children" in spec:
        result["children"] = children(spec["children"], spec["id"], config, lane)
    elif not previous:
        fail("A new group needs children.", "definition.children")
    if "transpose" in spec:
        upgrade(config, 3)
        pid = result.get("transposeProfileId", stable_id(result["id"], "transpose"))
        profiles = lane.setdefault("transposeProfiles", [])
        profile = next((p for p in profiles if p["id"] == pid), None)
        if profile is None:
            profiles.append({"id": pid, "revision": 0, "plan": deepcopy(spec["transpose"])})
        elif profile["plan"] != spec["transpose"]:
            profile.update(plan=deepcopy(spec["transpose"]), revision=profile["revision"] + 1)
        result["transposeProfileId"] = pid
    if previous:
        if result != previous:
            result["revision"] = previous["revision"] + 1
            lane["definitions"][lane["definitions"].index(previous)] = result
    else:
        lane["definitions"].append(result)
    return {
        "laneId": lane_id,
        "definitionId": result["id"],
        "created": previous is None,
        "linkedUses": sum(
            i.get("definitionId") == result["id"]
            for c in [*lane["definitions"], *lane["clips"]]
            for i in c.get("children", [])
        ),
    }


def put_clip(config, lane_id, spec, meter=None):
    fields(
        spec,
        {
            "id",
            "name",
            "start",
            "length",
            "offset",
            "mode",
            "children",
            "repeat",
            "repeatIndexBase",
            "transposePlacements",
        },
        {"id"},
        "clip",
    )
    lane = lane_for(config, lane_id)
    previous = next((c for c in lane["clips"] if c["id"] == spec["id"]), None)
    result = (
        deepcopy(previous)
        if previous
        else {"id": identity(spec["id"]), "name": spec.get("name", spec["id"]), "start": 0, "offset": 0, "mode": "once"}
    )
    for key in ("name", "mode", "repeatIndexBase", "transposePlacements"):
        if key in spec:
            result[key] = deepcopy(spec[key])
    for key in ("start", "length", "offset"):
        if key in spec:
            result[key] = ticks(spec[key], beat=beat_ticks(config, lane), meter=meter, path="clip." + key)
    if "children" in spec:
        result["children"] = children(spec["children"], result["id"], config, lane, meter)
    if "children" not in result:
        fail("A new clip needs children.", "clip.children")
    duration = content_length(config, lane, result["children"])
    if "repeat" in spec:
        if "length" in spec:
            fail("Choose repeat or length, not both.", "clip.repeat")
        repetitions = integer(spec["repeat"], 1, 40320000000, "clip.repeat")
        result.update(mode="loop", length=integer(duration * repetitions - result["offset"], 1))
    result.setdefault("length", duration)
    if "repeatIndexBase" in result or "transposePlacements" in result:
        upgrade(config, 3)
    if previous:
        lane["clips"][lane["clips"].index(previous)] = result
    else:
        lane["clips"].append(result)
    model(config)["end"] = max(model(config)["end"], result["start"] + result["length"])
    return {
        "laneId": lane_id,
        "clipId": result["id"],
        "created": previous is None,
        "window": {k: result[k] for k in ("start", "length", "offset", "mode")},
        "contentTicks": duration,
        "virtualPasses": (result["offset"] + result["length"] + duration - 1) // duration
        if result["mode"] == "loop"
        else 1,
    }


def fresh_clip(clip, new_id=None):
    result = deepcopy(clip)
    mapping = {i["id"]: uid() for i in clip["children"]}
    result["id"] = new_id or uid()
    for item in result["children"]:
        item["id"] = mapping[item["id"]]
    for p in result.get("transposePlacements", []):
        p["path"][0] = mapping[p["path"][0]]
    return result


def isolate_pass(config, lane, clip, source_pass):
    if clip["mode"] == "once":
        return clip
    length = content_length(config, lane, clip["children"])
    start = max(clip["start"], clip["start"] - clip["offset"] + source_pass * length)
    end = min(clip["start"] + clip["length"], clip["start"] - clip["offset"] + (source_pass + 1) * length)
    if end <= start:
        fail("The selected pass does not intersect the clip.", code="missing")
    parts = []
    if start > clip["start"]:
        first = fresh_clip(clip)
        first["length"] = start - clip["start"]
        parts.append(first)
    selected = deepcopy(clip)
    selected.update(
        start=start, length=end - start, offset=(clip["offset"] + start - clip["start"]) % length, mode="once"
    )
    if model(config)["version"] >= 3:
        selected["repeatIndexBase"] = clip.get("repeatIndexBase", 0) + source_pass
    parts.append(selected)
    if end < clip["start"] + clip["length"]:
        last = fresh_clip(clip)
        last.update(start=end, length=clip["start"] + clip["length"] - end, offset=clip["offset"] + end - clip["start"])
        parts.append(last)
    index = lane["clips"].index(clip)
    lane["clips"][index : index + 1] = parts
    return selected


def edit_occurrence(config, target, patch, scope):
    lane, clip, ancestry = target_at(config, target)
    original = ancestry[-1][1]
    spec = {**patch, "id": original["id"]}
    if scope == "shared":
        return put_definition(config, lane["id"], spec)
    if scope != "local":
        fail("Scope must be local or shared.", "scope")
    # First evaluate the candidate. A repeated identical local edit is a no-op.
    preview = deepcopy(config)
    put_definition(preview, lane["id"], spec)
    candidate = find(lane_for(preview, lane["id"])["definitions"], original["id"])
    if {k: v for k, v in candidate.items() if k != "revision"} == {
        k: v for k, v in original.items() if k != "revision"
    }:
        return {"definitionId": original["id"], "summary": "Selected music is unchanged."}
    old_lane, old_clip = deepcopy(lane), deepcopy(clip)
    if lane["source"] == "drummer":
        source_for(config, lane)["rows"] = deepcopy(source_for(preview, lane_for(preview, lane["id"]))["rows"])
    clip = isolate_pass(config, lane, clip, target.get("pass", 0))
    replacement = deepcopy(candidate)
    replacement.update(id=uid(), revision=0)
    if replacement.get("transposeProfileId"):
        profile = deepcopy(find(lane["transposeProfiles"], replacement["transposeProfileId"]))
        profile.update(id=uid(), revision=0)
        lane["transposeProfiles"].append(profile)
        replacement["transposeProfileId"] = profile["id"]
    if replacement["kind"] != "pattern":
        for child in replacement["children"]:
            child["id"] = uid()
    lane["definitions"].append(replacement)
    forks = [replacement["id"]]

    def fork(items, depth, shared_parent=False):
        item = find(items, target["path"][depth])
        if depth == len(target["path"]) - 1:
            item["definitionId"] = replacement["id"]
            return
        ancestor = find(lane["definitions"], item["definitionId"])
        links = sum(
            i.get("definitionId") == ancestor["id"]
            for c in [*lane["clips"], *lane["definitions"]]
            for i in c.get("children", [])
        )
        needs_copy = shared_parent or links > 1
        updated = deepcopy(ancestor)
        fork(updated["children"], depth + 1, needs_copy)
        if needs_copy:
            updated.update(id=uid(), revision=0)
            for c in updated["children"]:
                c["id"] = uid()
            lane["definitions"].append(updated)
            forks.append(updated["id"])
        else:
            updated["revision"] += 1
            lane["definitions"][lane["definitions"].index(ancestor)] = updated
        item["definitionId"] = updated["id"]

    fork(clip["children"], 0)

    def remap(path):
        before, after, result = old_clip["children"], clip["children"], []
        for part in path:
            index = next(i for i, item in enumerate(before) if item["id"] == part)
            a, b = before[index], after[index]
            result.append(b["id"])
            before = find(old_lane["definitions"], a["definitionId"]).get("children", [])
            after = find(lane["definitions"], b["definitionId"]).get("children", [])
        return result

    for placement in clip.get("transposePlacements", []):
        placement["path"] = remap(placement["path"])
    return {
        "definitionId": replacement["id"],
        "forkedIds": forks,
        "target": {"laneId": lane["id"], "clipId": clip["id"], "path": remap(target["path"]), "pass": 0},
    }


def migrate(config):
    if config.get("sequencer", {}).get("clipArrangement") is not None:
        return {"summary": "Already a clip performance."}
    s = config["sequencer"]
    reasons, lanes = [], []
    if len(s.get("pianoRolls", [])) > 1:
        reasons.append("multiple-keyboards")
    config["sequencer"]["clipArrangement"] = {"version": 1, "revision": 0, "end": QUARTER, "lanes": lanes}
    for kind, key in KEYS.items():
        for track in s.get(key, []):
            if not track.get("padLoopEnabled"):
                reasons.append("manual-source:" + track["id"])
            if track.get("playbackMode") == "live":
                reasons.append("live-arpeggiator:" + track["id"])
            lane = {"id": track["id"], "source": kind, "cycleTicks": None, "definitions": [], "clips": []}
            lanes.append(lane)
            prefix, counter = track["id"] + ":", 0
            pattern = track.get("padLoopPattern", {"rootSequence": [], "groups": [], "superGroups": []})
            colors = pattern.get("definitionColors", {})

            def convert(items):
                nonlocal counter
                result = []
                for item in items:
                    value = {"id": prefix + f"occurrence:{counter}"}
                    counter += 1
                    if item["type"] == "pause":
                        value["restTicks"] = item["lengthBeats"] * beat_ticks(config, lane)
                    else:
                        part = {
                            "pad": "pattern:" + str(item.get("padIndex")),
                            "group": "group:" + str(item.get("groupId")),
                            "superGroup": "supergroup:" + str(item.get("superGroupId")),
                        }[item["type"]]
                        value["definitionId"] = prefix + part
                    result.append(value)
                return result

            for index, pad in enumerate(track.get("pads", [])):
                d = {
                    "id": prefix + f"pattern:{index}",
                    "name": f"#{index + 1}",
                    "kind": "pattern",
                    "source": kind,
                    "revision": 0,
                    "payload": deepcopy(pad),
                }
                if f"pad:{index}" in colors:
                    d["color"] = colors[f"pad:{index}"]
                if "padPresetIds" in track:
                    d["presetId"] = track["padPresetIds"][index]
                lane["definitions"].append(d)
            for plural, kind_name, label in [("groups", "group", "group"), ("superGroups", "supergroup", "superGroup")]:
                for group in pattern.get(plural, []):
                    d = {
                        "id": prefix + kind_name + ":" + group["id"],
                        "name": group["id"],
                        "kind": kind_name,
                        "revision": 0,
                        "children": convert(group["sequence"]),
                    }
                    if label + ":" + group["id"] in colors:
                        d["color"] = colors[label + ":" + group["id"]]
                    lane["definitions"].append(d)
            items = convert(pattern.get("rootSequence", []))
            length = content_length(config, lane, items)
            if length:
                lane["clips"].append(
                    {
                        "id": prefix + "clip:0",
                        "name": track["name"],
                        "start": 0,
                        "length": length,
                        "offset": 0,
                        "mode": "once",
                        "children": items,
                    }
                )
                if track.get("padLoopRepeat"):
                    lane["cycleTicks"] = length
    if reasons:
        fail(
            "Legacy conversion is unsupported for these transports.",
            "sequencer",
            "migration_unsupported",
            reasons=reasons,
        )
    model(config)["end"] = max(
        QUARTER,
        s.get("stepCount", 8) * QUARTER // 8,
        *[c["start"] + c["length"] for lane_item in lanes for c in lane_item["clips"]],
    )
    config["version"] = 23
    s.pop("clipHistory", None)
    validate(config)
    return {
        "summary": "Converted legacy definitions and cycles; retained unused pads and original routing.",
        "lanes": len(lanes),
    }
