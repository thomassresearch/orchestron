"""Occurrence structure, section windows and explicit timeline changes.

Port of clipArranger operations/structure/timedStructure. Stored definitions remain
linked; only changed occurrence paths are copied for a local save.
"""

from copy import deepcopy
from fractions import Fraction

from .song_model import (
    RANK,
    beat_ticks,
    content_length,
    duration,
    fail,
    fields,
    find,
    integer,
    lane_for,
    leaves,
    model,
    source_for,
    ticks,
    uid,
    upgrade,
)
from .song_authoring import fresh_clip
from .song_transpose import offset_at, sum_plans


def expand(lane, items, clip=None, path=()):
    result = []
    for item in items:
        node = deepcopy(item)
        current = [*path, item["id"]]
        node["originalPath"] = current
        if "definitionId" in item:
            d = deepcopy(find(lane["definitions"], node.pop("definitionId")))
            node["definition"] = d
            if d["kind"] != "pattern":
                node["children"] = expand(lane, d["children"], clip, current)
            placement = next(
                (p["plan"] for p in (clip or {}).get("transposePlacements", []) if p["path"] == current), None
            )
            if placement:
                node["placement"] = deepcopy(placement)
        result.append(node)
    return result


def node_ticks(config, lane, node):
    if "children" in node:
        return sum(node_ticks(config, lane, n) for n in node["children"])
    return duration(config, lane, node["definition"]) if "definition" in node else node["restTicks"]


def row(roots, path):
    nodes = roots
    for part in path:
        node = find(nodes, part)
        if "children" not in node:
            fail("Select an existing container.", "/".join(path))
        nodes = node["children"]
    return nodes


def rank(node):
    return RANK[node["definition"]["kind"]] if "definition" in node else 0


def selection(nodes, ids):
    indexes = sorted(next((i for i, n in enumerate(nodes) if n["id"] == key), -1) for key in ids)
    if not indexes or indexes[0] < 0 or indexes != list(range(indexes[0], indexes[0] + len(indexes))):
        fail("Select consecutive distinct children in one container.", "ids")
    return indexes[0], len(indexes)


def place_at(config, lane, items, chosen, at):
    integer(at)
    length = sum(node_ticks(config, lane, n) for n in chosen)
    integer(length, 1)
    cursor, entries = 0, []
    for n in items:
        end = cursor + node_ticks(config, lane, n)
        if "definition" in n:
            if cursor < at + length and end > at:
                fail("Content overlaps; make room or choose a rest.", n["id"], "collision", blockingChildId=n["id"])
            entries.append((cursor, end, n))
        cursor = end
    for n in chosen:
        end = at + node_ticks(config, lane, n)
        entries.append((at, end, n))
        at = end
    result, position = [], 0
    for start, end, node in sorted(entries, key=lambda e: e[0]):
        if start > position:
            result.append({"id": uid(), "restTicks": start - position})
        result.append(node)
        position = end
    if cursor > position:
        result.append({"id": uid(), "restTicks": cursor - position})
    return result


def inherited(lane, roots, parent, initial):
    index, plans, nodes = initial, [], roots
    for part in parent:
        n = find(nodes, part)
        index = n.get("repeatIndex", index)
        profile = next(
            (
                p["plan"]
                for p in lane.get("transposeProfiles", [])
                if p["id"] == n["definition"].get("transposeProfileId")
            ),
            None,
        )
        plans.extend(
            {"base": deepcopy(offset_at(p, index)), "repetitions": []}
            for p in [profile, n.get("transpose"), n.get("placement")]
            if p
        )
        nodes = n["children"]
    return index, plans


def edit(config, spec):
    fields(
        spec, {"laneId", "clipId", "pass", "revision", "scope", "command"}, {"laneId", "clipId", "command"}, "structure"
    )
    m = model(config)
    if "revision" in spec and spec["revision"] != m["revision"]:
        fail("Structure selector is stale. Inspect again.", "revision", "conflict")
    lane = lane_for(config, spec["laneId"])
    if lane["cycleTicks"] is not None:
        fail("Convert the independent cycle before editing song structure.", lane["id"])
    original_lane = deepcopy(lane)
    original = deepcopy(find(lane["clips"], spec["clipId"]))
    roots = expand(lane, original["children"], original)
    original_roots = deepcopy(roots)
    command = spec["command"]
    fields(
        command,
        {
            "kind",
            "parent",
            "ids",
            "target",
            "definitionId",
            "variation",
            "ticks",
            "name",
            "level",
            "range",
            "edge",
            "delta",
        },
        {"kind"},
        "command",
    )
    kind, scope, source_pass = command["kind"], spec.get("scope", "local"), spec.get("pass", 0)
    if scope not in ("local", "shared"):
        fail("Scope must be local or shared.")
    before = content_length(config, lane, original["children"])
    expanded = False
    parent, ids = list(command.get("parent", [])), list(command.get("ids", []))
    expanded_offset, expanded_base, expanded_ticks = 0, 0, 0
    if original["mode"] == "loop" and kind in ("group-repetitions", "duplicate"):
        if scope != "local":
            fail("Materializing repetitions edits only this clip; definitions stay linked.", "scope")
        first = original["offset"] // before
        last = (original["offset"] + original["length"] - 1) // before
        if not first <= source_pass <= last:
            fail("The selected repetition is outside the clip.", "pass")
        passes = last - first + 1
        root_count = len(roots) * passes
        if (
            root_count > 256
            or len(leaves(config, lane, original["children"])) * passes > 65536
            or len(original.get("transposePlacements", [])) * passes > 1024
        ):
            fail("Materialization exceeds content capacity. Shorten the clip first.", code="limit")
        integer(before * passes, 1)
        expanded_roots = []

        def provenance(nodes, p):
            for n in nodes:
                n["originalPass"] = p
                if "children" in n:
                    provenance(n["children"], p)

        for p in range(first, last + 1):
            nodes = deepcopy(roots)
            provenance(nodes, p)
            for n in nodes:
                n["id"] = uid()
                if "definition" in n:
                    n.setdefault("repeatIndex", original.get("repeatIndexBase", 0) + p)
            expanded_roots.extend(nodes)

        def mapped_id(key, p):
            index = next((i for i, n in enumerate(roots) if n["id"] == key), -1)
            if index < 0 or not first <= p <= last:
                fail("The repetition selection changed.", "range")
            return expanded_roots[(p - first) * len(roots) + index]["id"]

        if kind == "group-repetitions":
            r = command["range"]
            a, b = mapped_id(r["first"]["id"], r["first"]["pass"]), mapped_id(r["last"]["id"], r["last"]["pass"])
            start = next(i for i, n in enumerate(expanded_roots) if n["id"] == a)
            end = next(i for i, n in enumerate(expanded_roots) if n["id"] == b)
            if end <= start:
                fail("Select adjacent content across repetitions.", "range")
            parent, ids, kind = [], [n["id"] for n in expanded_roots[start : end + 1]], "group"
        elif parent:
            parent[0] = mapped_id(parent[0], source_pass)
        else:
            ids = [mapped_id(key, source_pass) for key in ids]
        roots = expanded_roots
        expanded, expanded_offset = True, original["offset"] - first * before
        expanded_base, expanded_ticks = original.get("repeatIndexBase", 0) + first, before * passes
        upgrade(config, 4)
    target = command.get("target", {"path": [], "index": 0})
    fields(target, {"path", "index", "ticks"})
    destination_path = target.get("path", [])
    nodes = row(roots, parent)
    timed = kind in ("timed", "resize", "resize-rest", "duplicate") or "ticks" in target
    if kind in ("insert", "rest"):
        if kind == "rest":
            n = {"id": uid(), "restTicks": ticks(command["ticks"], beat=beat_ticks(config, lane))}
            integer(n["restTicks"], 1)
        else:
            d = deepcopy(find(lane["definitions"], command["definitionId"]))
            n = expand(lane, [{"id": uid(), "definitionId": d["id"]}])[0]
            n.pop("originalPath", None)
            if command.get("variation"):
                n["definition"].update(id=uid(), revision=0)
                if d.get("transposeProfileId"):
                    profile = deepcopy(find(lane["transposeProfiles"], d["transposeProfileId"]))
                    profile.update(id=uid(), revision=0)
                    lane["transposeProfiles"].append(profile)
                    n["definition"]["transposeProfileId"] = profile["id"]
        destination = row(roots, destination_path)
        if "ticks" in target:
            destination[:] = place_at(
                config, lane, destination, [n], ticks(target["ticks"], beat=beat_ticks(config, lane))
            )
        else:
            destination.insert(integer(target.get("index", 0), 0, len(destination)), n)
    elif kind == "rename":
        start, count = selection(nodes, ids)
        if count != 1 or "children" not in nodes[start]:
            fail("Select one container to rename.")
        nodes[start]["definition"]["name"] = command["name"]
    else:
        start, count = selection(nodes, ids)
        chosen = nodes[start : start + count]
        if kind == "remove":
            del nodes[start : start + count]
        elif kind == "group":
            level = command.get("level", "group")
            required = {"group": 0, "supergroup": 1}.get(level)
            if (
                required is None
                or count < 2
                or any(rank(n) != required for n in chosen if "definition" in n)
                or sum("definition" in n for n in chosen) < (2 if required else 1)
            ):
                fail("Group adjacent patterns, or supergroup at least two adjacent groups.")
            grouped = {
                "id": uid(),
                "definition": {
                    "id": uid(),
                    "name": command.get("name", "Group"),
                    "revision": 0,
                    "kind": level,
                    "children": [],
                },
                "children": chosen,
            }
            if "repeatIndex" in chosen[0]:
                grouped["repeatIndex"] = chosen[0]["repeatIndex"]
            nodes[start : start + count] = [grouped]
        elif kind == "ungroup":
            ungrouped = []
            parent_index, _ = inherited(lane, roots, parent, original.get("repeatIndexBase", 0) + source_pass)
            for n in chosen:
                if "children" not in n:
                    fail("Select containers to ungroup.")
                fixed = n.get("repeatIndex")
                if fixed is None:
                    # Only an explicitly fixed ancestor freezes contributions; ordinary plans remain sparse.
                    ancestor_nodes = roots
                    for part in parent:
                        ancestor = find(ancestor_nodes, part)
                        fixed = ancestor.get("repeatIndex", fixed)
                        ancestor_nodes = ancestor.get("children", [])
                profile = next(
                    (
                        p["plan"]
                        for p in lane.get("transposeProfiles", [])
                        if p["id"] == n["definition"].get("transposeProfileId")
                    ),
                    None,
                )

                def freeze(p):
                    return p if fixed is None else {"base": offset_at(p, fixed), "repetitions": []}

                for child in deepcopy(n["children"]):
                    child["id"] = uid()
                    if "definition" in child:
                        if fixed is not None:
                            child.setdefault("repeatIndex", fixed)
                        plans = [freeze(p) for p in [profile, n.get("transpose")] if p] + (
                            [child["transpose"]] if child.get("transpose") else []
                        )
                        local = ([freeze(n["placement"])] if n.get("placement") else []) + (
                            [child["placement"]] if child.get("placement") else []
                        )
                        if plans:
                            child["transpose"] = sum_plans(plans)
                        if local:
                            child["placement"] = sum_plans(local)
                    ungrouped.append(child)
            nodes[start : start + count] = ungrouped
        elif kind == "duplicate":
            index, plans = inherited(lane, roots, parent, original.get("repeatIndexBase", 0) + source_pass)
            duplicated = deepcopy(chosen)

            def forget(items):
                for n in items:
                    n.pop("originalPath", None)
                    n.pop("originalPass", None)
                    if "children" in n:
                        forget(n["children"])

            forget(duplicated)
            for n in duplicated:
                n["id"] = uid()
                if "definition" in n:
                    n.setdefault("repeatIndex", index)
                    if plans:
                        n["placement"] = sum_plans([*plans, *([n["placement"]] if n.get("placement") else [])])
            at, cursor = 0, 0
            for n in roots:
                cursor += node_ticks(config, lane, n)
                if "definition" in n:
                    at = cursor
            roots = place_at(config, lane, roots, duplicated, at)
            upgrade(config, 4)
        elif kind == "move":
            if (
                destination_path[: len(parent)] == parent
                and len(destination_path) > len(parent)
                and destination_path[len(parent)] in ids
            ):
                fail("Cannot move a container into itself.")
            destination = row(roots, destination_path)
            at = integer(target.get("index", 0), 0, len(destination))
            if destination is nodes:
                at -= sum(i < at for i in range(start, start + count))
            del nodes[start : start + count]
            for n in chosen:
                if any(other["id"] == n["id"] for other in destination):
                    n["id"] = uid()
            destination[at:at] = chosen
        elif kind in ("timed", "resize", "resize-rest"):
            chosen = deepcopy(chosen)
            if kind == "resize-rest":
                if count != 1 or start != len(nodes) - 1 or "restTicks" not in chosen[0]:
                    fail("Select one trailing rest to resize.")
                length = ticks(command["ticks"], beat=beat_ticks(config, lane))
                if length:
                    nodes[start]["restTicks"] = length
                elif len(nodes) > 1:
                    nodes.pop()
                else:
                    fail("An empty container needs a positive rest.")
            else:
                at = ticks(target.get("ticks", 0), beat=beat_ticks(config, lane))
                if kind == "resize":
                    if count != 1 or chosen[0].get("definition", {}).get("kind") != "pattern":
                        fail("Select one pattern to resize.")
                    p = chosen[0]["definition"]["payload"]
                    length = ticks(command["ticks"], beat=beat_ticks(config, lane))
                    if "curveDurationTicks" in p:
                        p["curveDurationTicks"] = integer(length, 1)
                    else:
                        beats = Fraction(length, beat_ticks(config, lane))
                        if beats.denominator != 1:
                            fail("Resize to a whole local beat; no implicit rounding.")
                        p["lengthBeats"] = integer(
                            int(beats),
                            1,
                            8192 if lane["source"] == "score" else 32 if lane["source"] == "controller" else 16,
                        )
                        if "stepCount" in p:
                            p["stepCount"] = p["lengthBeats"] * source_for(config, lane).get("timing", {}).get(
                                "stepsPerBeat", 4
                            )
                for i in range(start, start + count):
                    nodes[i] = {"id": uid(), "restTicks": node_ticks(config, lane, nodes[i])}
                destination = row(roots, destination_path)
                destination[:] = place_at(config, lane, destination, chosen, at)
        else:
            fail("Unknown structure command.", "command.kind")
    if kind in ("timed", "resize", "resize-rest"):
        paths = [parent] if kind == "resize-rest" else [parent, destination_path]

        def repair(before_nodes, after_nodes, path):
            if not any(p[: len(path)] == path for p in paths):
                return after_nodes
            for node in after_nodes:
                old = next((n for n in before_nodes if n["id"] == node["id"]), None)
                if old and "children" in node and "children" in old:
                    node["children"] = repair(old["children"], node["children"], [*path, node["id"]])
            if path in paths:
                return after_nodes
            cursor, positions = 0, {}
            for node in before_nodes:
                positions[node["id"]] = cursor
                cursor += node_ticks(config, lane, node)
            extent = (
                max((positions[n["id"]] + node_ticks(config, lane, n) for n in after_nodes), default=0)
                if kind == "resize-rest"
                else cursor
            )
            result = [{"id": uid(), "restTicks": extent}] if extent else []
            for node in after_nodes:
                if "definition" in node:
                    result = place_at(config, lane, result, [node], positions[node["id"]])
            return result

        roots = repair(original_roots, roots, [])

    # Empty nested containers disappear; an empty clip leaves its timeline gap.
    def clean(nodes):
        result = []
        for n in nodes:
            if "children" in n:
                n["children"] = clean(n["children"])
                if not n["children"]:
                    continue
            result.append(n)
        return result

    roots = clean(roots)
    if not roots:
        lane["clips"] = [c for c in lane["clips"] if c["id"] != original["id"]]
        return {"removedClipId": original["id"], "summary": "Removed empty clip; song time retained."}
    # Materialize only changed definitions. New occurrence IDs do not copy unchanged payloads.
    changed, mappings, created, path_rules = {}, {}, [], {}

    def materialize(nodes, level=3):
        result = []
        if len(nodes) > 256:
            fail("Container exceeds 256 children.", code="limit")
        for n in nodes:
            item = {"id": n["id"]}
            if "definition" not in n:
                item["restTicks"] = n["restTicks"]
                result.append(item)
                continue
            definition = deepcopy(n["definition"])
            if RANK[definition["kind"]] >= level:
                fail("Invalid structural nesting.")
            previous = next((d for d in original_lane["definitions"] if d["id"] == definition["id"]), None)
            if definition["kind"] != "pattern":
                nested = materialize(n["children"], RANK[definition["kind"]])
                definition["children"] = nested
            if previous != definition:
                if previous and scope == "shared":
                    signature = {k: v for k, v in definition.items() if k != "revision"}
                    if "children" in signature:
                        signature["children"] = [
                            {k: v for k, v in i.items() if k != "id"} for i in signature["children"]
                        ]
                    if definition["id"] in changed and changed[definition["id"]] != signature:
                        fail("Shared occurrences need incompatible structures. Use local scope.")
                    changed[definition["id"]] = signature
                    definition["revision"] = previous["revision"] + 1
                    if "children" in definition:
                        definition["children"] = [{**i, "id": uid()} for i in definition["children"]]
                    current = find(lane["definitions"], definition["id"])
                    lane["definitions"][lane["definitions"].index(current)] = definition
                else:
                    if previous:
                        definition.update(id=uid(), revision=0)
                    if "children" in definition:
                        definition["children"] = [{**i, "id": uid()} for i in definition["children"]]
                    if not any(d["id"] == definition["id"] for d in lane["definitions"]):
                        lane["definitions"].append(definition)
                        created.append(definition["id"])
                if previous and scope == "shared" and "children" in definition and n.get("originalPath"):
                    rules = []

                    def trace(nodes, items, path):
                        for child, mapped in zip(nodes, items):
                            after_path = [*path, mapped["id"]]
                            old_path = child.get("originalPath", [])
                            if old_path[: len(n["originalPath"])] == n["originalPath"]:
                                rules.append((old_path[len(n["originalPath"]) :], after_path))
                            if "children" in child:
                                trace(
                                    child["children"],
                                    find(lane["definitions"], mapped["definitionId"])["children"],
                                    after_path,
                                )

                    trace(n["children"], definition["children"], [])
                    path_rules[previous["id"]] = rules
            item["definitionId"] = definition["id"]
            for k in ("repeatIndex", "transpose"):
                if k in n:
                    item[k] = deepcopy(n[k])
            result.append(item)
        return result

    items = [{**i, "id": uid()} for i in materialize(roots)]
    if scope == "shared":
        for candidate in lane["clips"]:
            if candidate["id"] == original["id"]:
                continue
            remapped = []
            for placement in candidate.get("transposePlacements", []):
                old_items = find(original_lane["clips"], candidate["id"])["children"]
                targets = [placement["path"]]
                for depth, part in enumerate(placement["path"]):
                    item = find(old_items, part)
                    definition = find(original_lane["definitions"], item["definitionId"])
                    rules, suffix = path_rules.get(definition["id"]), placement["path"][depth + 1 :]
                    if rules and suffix:
                        exact = [r for r in rules if r[0] == suffix]
                        matches = exact or [r for r in rules if r[0][: len(suffix)] == suffix]
                        shortest = [
                            r
                            for r in matches
                            if not any(
                                len(other[1]) < len(r[1]) and r[1][: len(other[1])] == other[1] for other in matches
                            )
                        ]
                        targets = [[*placement["path"][: depth + 1], *r[1]] for r in shortest]
                        break
                    old_items = definition.get("children", [])
                for path in targets:
                    existing = next((p for p in remapped if p["path"] == path), None)
                    if existing:
                        existing["plan"] = sum_plans([existing["plan"], placement["plan"]])
                    else:
                        remapped.append({"path": path, "plan": deepcopy(placement["plan"])})
            if "transposePlacements" in candidate:
                candidate["transposePlacements"] = remapped
    if timed and scope == "shared":

        def keep_positions(old_items, new_items):
            if old_items != new_items:
                return new_items
            before_nodes, after_nodes = expand(original_lane, old_items), expand(lane, new_items)
            if all(
                node_ticks(config, lane, a) == node_ticks(config, lane, b) for a, b in zip(before_nodes, after_nodes)
            ):
                return new_items
            result = [{"id": uid(), "restTicks": sum(node_ticks(config, lane, n) for n in before_nodes)}]
            at = 0
            for old, node in zip(before_nodes, after_nodes):
                if "definition" in node:
                    result = place_at(config, lane, result, [node], at)
                at += node_ticks(config, lane, old)
            return [
                {
                    "id": n["id"],
                    **(
                        {
                            "definitionId": n["definition"]["id"],
                            **{k: n[k] for k in ("transpose", "repeatIndex") if k in n},
                        }
                        if "definition" in n
                        else {"restTicks": n["restTicks"]}
                    ),
                }
                for n in result
            ]

        for kind_of_definition in ("group", "supergroup"):
            for definition in lane["definitions"]:
                old = next((d for d in original_lane["definitions"] if d["id"] == definition["id"]), None)
                if old and definition["kind"] == kind_of_definition:
                    definition["children"] = keep_positions(old["children"], definition["children"])
        for candidate in lane["clips"]:
            if candidate["id"] != original["id"]:
                candidate["children"] = keep_positions(
                    find(original_lane["clips"], candidate["id"])["children"], candidate["children"]
                )
    placements, occurrence_map = [], []

    def collect(nodes, items, path=()):
        for n, item in zip(nodes, items):
            current = [*path, item["id"]]
            if "originalPath" in n:
                occurrence_map.append(
                    {
                        "from": {"path": n["originalPath"], "pass": n.get("originalPass", source_pass)},
                        "to": {"path": current, "pass": 0},
                    }
                )
                mappings[tuple(n["originalPath"])] = current
            if n.get("placement") and "definitionId" in item:
                placements.append({"path": current, "plan": deepcopy(n["placement"])})
            if "children" in n:
                collect(n["children"], find(lane["definitions"], item["definitionId"])["children"], current)

    collect(roots, items)
    clip = find(lane["clips"], original["id"])
    clip["children"] = items
    if placements or "transposePlacements" in clip:
        clip["transposePlacements"] = placements
    after = content_length(config, lane, items)

    def scaled(value, old, new):
        return (value * new + old // 2) // old

    if expanded:
        clip.update(mode="once", offset=expanded_offset, repeatIndexBase=expanded_base)
        if after > expanded_ticks:
            clip["length"] = max(clip["length"], after - clip["offset"])
    elif scope == "local" and original["mode"] == "loop":
        start = max(original["start"], original["start"] - original["offset"] + source_pass * before)
        end = min(
            original["start"] + original["length"], original["start"] - original["offset"] + (source_pass + 1) * before
        )
        if end <= start:
            fail("The selected repetition no longer exists.")
        offset = (original["offset"] + start - original["start"]) % before
        new_offset = scaled(offset, before, after) if after > before else offset
        length = scaled(offset + end - start, before, after) - new_offset if after > before else end - start
        growth = length - (end - start)
        clip.update(start=start, length=length, offset=new_offset, mode="once")
        if m["version"] >= 3:
            clip["repeatIndexBase"] = original.get("repeatIndexBase", 0) + source_pass
        parts = []
        if start > original["start"]:
            left = fresh_clip(original)
            left["length"] = start - original["start"]
            parts.append(left)
        parts.append(clip)
        if end < original["start"] + original["length"]:
            right = fresh_clip(original)
            right.update(
                start=end + (0 if timed else growth),
                length=original["start"] + original["length"] - end,
                offset=original["offset"] + end - original["start"],
            )
            parts.append(right)
        index = lane["clips"].index(clip)
        lane["clips"][index : index + 1] = parts
    else:
        for candidate in lane["clips"]:
            old = find(original_lane["clips"], candidate["id"])
            old_duration = content_length(
                {**config, "sequencer": {**config["sequencer"], "clipArrangement": {**m, "lanes": [original_lane]}}},
                original_lane,
                old["children"],
            )
            new_duration = content_length(config, lane, candidate["children"])
            if (
                timed
                and scope == "shared"
                and candidate["mode"] == "loop"
                and new_duration != old_duration
                and old["offset"] + old["length"] > old_duration
            ):
                fail("Resizing changes another loop repetition. Use local scope.")
            if new_duration > old_duration:
                if candidate["mode"] == "loop":
                    candidate["offset"] = scaled(old["offset"], old_duration, new_duration)
                    candidate["length"] = (
                        scaled(old["offset"] + old["length"], old_duration, new_duration) - candidate["offset"]
                    )
                else:
                    candidate["length"] = max(old["length"], new_duration - old["offset"])
    if kind == "duplicate" or timed and m["version"] >= 3:
        upgrade(config, 4)
    m["end"] = max(m["end"], *[c["start"] + c["length"] for c in lane["clips"]])
    return {
        "summary": f"Applied {kind} to {scope} structure.",
        "laneId": lane["id"],
        "clipId": original["id"],
        "createdDefinitionIds": created,
        "occurrences": occurrence_map[:50],
        "occurrenceCount": len(occurrence_map),
        "truncated": len(occurrence_map) > 50,
        "materializedRepetitions": expanded,
    }


def edit_time(config, lane_ids, start, length, operation):
    m = model(config)
    integer(start)
    integer(length, 1)
    for lane_id in lane_ids:
        lane = lane_for(config, lane_id)
        if lane["cycleTicks"] is not None:
            fail("Convert repeating cycles before editing song time.", lane_id)
        clips = []
        cut_end = start + length if operation == "close" else start
        delta = length if operation == "insert" else -length
        for c in lane["clips"]:
            end = c["start"] + c["length"]
            if end <= start:
                clips.append(c)
            elif c["start"] >= cut_end:
                clips.append({**c, "start": c["start"] + delta})
            else:
                if c["start"] < start:
                    clips.append({**c, "length": start - c["start"]})
                if end > cut_end:
                    right = fresh_clip(c) if c["start"] < start else deepcopy(c)
                    left = max(c["start"], cut_end)
                    right.update(start=left + delta, offset=c["offset"] + left - c["start"], length=end - left)
                    clips.append(right)
        lane["clips"] = clips
    extent = max([1, *[c["start"] + c["length"] for lane_item in m["lanes"] for c in lane_item["clips"]]])
    m["end"] = max(
        extent, m["end"] + length if operation == "insert" else m["end"] - min(length, max(0, m["end"] - start))
    )


def slice_clip(clip, start, end):
    left, right = max(start, clip["start"]), min(end, clip["start"] + clip["length"])
    if right <= left:
        return None
    result = fresh_clip(clip)
    result.update(start=left, length=right - left, offset=clip["offset"] + left - clip["start"])
    return result


def command(config, op, spec):
    if op == "structure.edit":
        return edit(config, spec)
    if op == "structure.convert-cycle":
        fields(spec, {"laneId"}, {"laneId"})
        lane, m = lane_for(config, spec["laneId"]), model(config)
        cycle = lane["cycleTicks"]
        if cycle is None:
            return {"summary": "Lane already uses song clips."}
        repeats = (m["end"] + cycle - 1) // cycle
        if repeats * len(lane["clips"]) > 2048:
            fail("Cycle conversion exceeds 2048 clips. Shorten the song first.", code="limit")
        lane["clips"] = [
            {
                **fresh_clip(c),
                "start": c["start"] + p * cycle,
                "length": min(c["length"], m["end"] - c["start"] - p * cycle),
            }
            for p in range(repeats)
            for c in lane["clips"]
            if c["start"] + p * cycle < m["end"]
        ]
        lane["cycleTicks"] = None
        return {"laneId": lane["id"], "clips": len(lane["clips"])}
    if op in ("sections.insert-time", "sections.close-time"):
        fields(spec, {"lanes", "start", "length"}, {"lanes", "start", "length"})
        edit_time(
            config,
            spec["lanes"],
            ticks(spec["start"]),
            ticks(spec["length"]),
            "insert" if op.endswith("insert-time") else "close",
        )
        return {"endTicks": model(config)["end"], "lanes": spec["lanes"]}
    if op == "sections.paste":
        fields(spec, {"lanes", "from", "length", "at", "mode"}, {"lanes", "from", "length", "at", "mode"})
        start, length, at = ticks(spec["from"]), ticks(spec["length"]), ticks(spec["at"])
        integer(length, 1)
        if spec["mode"] not in ("insert", "overwrite"):
            fail("Section paste mode is insert or overwrite.")
        copied = {}
        for lane_id in spec["lanes"]:
            lane = lane_for(config, lane_id)
            if lane["cycleTicks"] is not None:
                fail("Convert repeating cycles before copying song time.")
            copied[lane_id] = [s for c in lane["clips"] if (s := slice_clip(c, start, start + length))]
        if spec["mode"] == "insert":
            edit_time(config, spec["lanes"], at, length, "insert")
        for lane_id, copies in copied.items():
            lane = lane_for(config, lane_id)
            if spec["mode"] == "overwrite":
                retained = []
                for c in lane["clips"]:
                    if c["start"] + c["length"] <= at or c["start"] >= at + length:
                        retained.append(c)
                    else:
                        retained.extend(
                            s for a, b in [(0, at), (at + length, model(config)["end"])] if (s := slice_clip(c, a, b))
                        )
                lane["clips"] = retained
            lane["clips"].extend({**c, "start": c["start"] - start + at} for c in copies)
            lane["clips"].sort(key=lambda c: c["start"])
        model(config)["end"] = max(model(config)["end"], at + length)
        return {
            "summary": f"Pasted section with {spec['mode']} semantics.",
            "lanes": spec["lanes"],
            "start": at,
            "length": length,
        }
    if op == "structure.copy":
        return copy_clip(config, spec)
    fail("Unknown structural operation.", "op")


def copy_clip(config, spec):
    fields(
        spec,
        {"laneId", "clipId", "destinationLaneId", "id", "start"},
        {"laneId", "clipId", "destinationLaneId", "id", "start"},
    )
    source, dest = lane_for(config, spec["laneId"]), lane_for(config, spec["destinationLaneId"])
    if source["source"] != dest["source"]:
        fail("Copy to a lane of the same source type.")
    original = find(source["clips"], spec["clipId"])
    copied = fresh_clip(original, spec["id"])
    copied["start"] = ticks(spec["start"])
    if source is not dest:
        from .song_automation import clone_lane

        src, dst = source_for(config, source), source_for(config, dest)
        if source["source"] == "controller" and (
            src.get("controllerMode") != dst.get("controllerMode")
            or bool(src.get("automationTarget")) != bool(dst.get("automationTarget"))
        ):
            fail("Controller mode and automation ownership kind must match.")
        used = set()

        def collect(items):
            for i in items:
                if "definitionId" in i and i["definitionId"] not in used:
                    used.add(i["definitionId"])
                    collect(find(source["definitions"], i["definitionId"]).get("children", []))

        collect(original["children"])
        partial = {
            **deepcopy(source),
            "definitions": [deepcopy(d) for d in source["definitions"] if d["id"] in used],
            "clips": [deepcopy(original)],
        }
        cloned = clone_lane(partial, dest["id"])
        scale = Fraction(beat_ticks(config, dest), beat_ticks(config, source))

        def scaled(value):
            result = value * scale
            if result.denominator != 1:
                fail("Destination timing cannot represent this exact span.")
            return integer(int(result))

        for d in cloned["definitions"]:
            for item in d.get("children", []):
                if "restTicks" in item:
                    item["restTicks"] = scaled(item["restTicks"])
            if d["kind"] == "pattern":
                payload = d["payload"]
                if "stepCount" in payload:
                    payload["stepCount"] = payload["lengthBeats"] * dst.get("timing", {}).get("stepsPerBeat", 4)
                if source["source"] == "drummer":
                    rows = []
                    for r in payload["rows"]:
                        key = find(src["rows"], r["rowId"])["key"]
                        matches = [row for row in dst["rows"] if row["key"] == key]
                        if len(matches) != 1:
                            if any(c.get("active") for c in r["steps"]):
                                fail("A used drum key is missing/ambiguous in destination.", str(key))
                            continue
                        rows.append({**r, "rowId": matches[0]["id"]})
                    payload["rows"] = rows
        copied = cloned["clips"][0]
        for item in copied["children"]:
            if "restTicks" in item:
                item["restTicks"] = scaled(item["restTicks"])
        copied.update(
            id=spec["id"],
            start=ticks(spec["start"]),
            offset=scaled(original["offset"]),
            length=scaled(original["length"]),
        )
        dest["definitions"].extend(cloned["definitions"])
        if cloned.get("transposeProfiles"):
            dest.setdefault("transposeProfiles", []).extend(cloned["transposeProfiles"])
    dest["clips"].append(copied)
    model(config)["end"] = max(model(config)["end"], copied["start"] + copied["length"])
    return {"laneId": dest["id"], "clipId": copied["id"], "independentDefinitions": source is not dest}
