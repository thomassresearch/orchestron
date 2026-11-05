"""Scoped pitch plans; original notes are never rewritten by a transpose edit."""

from copy import deepcopy
from .song_model import fail, fields, integer, target_at, upgrade, uid
from .clip_transposition import validate_plan

ZERO = {"diatonicSteps": 0, "chromaticSemitones": 0}


def empty_plan():
    return {"base": dict(ZERO), "repetitions": []}


def offset_at(plan, index):
    return next((e["offset"] for e in plan["repetitions"] if e["index"] == index), plan["base"])


def sum_plans(plans):
    indexes = sorted({e["index"] for p in plans for e in p["repetitions"]})
    if len(indexes) > 4096:
        fail("Combined plan exceeds 4096 repetition entries.", code="limit")
    result = {
        "base": {k: sum(p["base"][k] for p in plans) for k in ZERO},
        "repetitions": [
            {"index": i, "offset": {k: sum(offset_at(p, i)[k] for p in plans) for k in ZERO}} for i in indexes
        ],
    }
    validate_plan(result)
    return result


def contributions(config, target):
    lane, clip, ancestry = target_at(config, target)
    index = clip.get("repeatIndexBase", 0) + target.get("pass", 0)
    result = []
    for depth, (item, definition) in enumerate(ancestry):
        index = item.get("repeatIndex", index)
        profile = next(
            (p for p in lane.get("transposeProfiles", []) if p["id"] == definition.get("transposeProfileId")), None
        )
        placement = next(
            (p for p in clip.get("transposePlacements", []) if p["path"] == target["path"][: depth + 1]), None
        )
        for scope, plan in [
            ("shared", profile["plan"] if profile else None),
            ("parent", item.get("transpose")),
            ("placement", placement["plan"] if placement else None),
        ]:
            if plan:
                result.append(
                    {
                        "scope": scope,
                        "definitionId": definition["id"],
                        "path": target["path"][: depth + 1],
                        "index": index,
                        "offset": deepcopy(offset_at(plan, index)),
                    }
                )
    return {"contributions": result, "effective": {k: sum(c["offset"][k] for c in result) for k in ZERO}}


def pitch(value, root, mode, offset):
    from .cli.orchestron_cli import SCALE_ROOTS, MODE_INTERVALS

    r, intervals = SCALE_ROOTS[root][0], MODE_INTERVALS[mode]
    octave, pc = divmod(value - r, 12)
    degree = max(i for i, n in enumerate(intervals) if n <= pc)
    target_octave, target_degree = divmod(7 * octave + degree + offset["diatonicSteps"], 7)
    result = r + 12 * target_octave + intervals[target_degree] + pc - intervals[degree] + offset["chromaticSemitones"]
    return result if 0 <= result <= 127 else None


def edit(config, spec):
    fields(
        spec, {"target", "scope", "plan", "action", "index", "offset", "component"}, {"target", "scope"}, "transpose"
    )
    lane, clip, ancestry = target_at(config, spec["target"])
    if lane["source"] not in ("sequencer", "score", "arpeggiator"):
        fail("Pitch transposition is available for melodic, score and arpeggiator lanes.", "transpose.target")
    item, definition = ancestry[-1]
    scope = spec["scope"]
    if scope not in ("shared", "parent", "placement"):
        fail("Scope must be shared, parent or placement.", "transpose.scope")
    profile = next(
        (p for p in lane.get("transposeProfiles", []) if p["id"] == definition.get("transposeProfileId")), None
    )
    placement = next((p for p in clip.get("transposePlacements", []) if p["path"] == spec["target"]["path"]), None)
    prior = (
        profile["plan"]
        if scope == "shared" and profile
        else item.get("transpose")
        if scope == "parent"
        else placement["plan"]
        if scope == "placement" and placement
        else None
    )
    plan = deepcopy(prior or empty_plan())
    action = spec.get("action", "set")
    if "plan" in spec:
        plan = deepcopy(spec["plan"])
    elif action == "reset-plan":
        plan = empty_plan()
    elif action == "reset-component":
        component = spec.get("component")
        if component not in ZERO:
            fail("Choose diatonicSteps or chromaticSemitones.", "transpose.component")
        for pair in [plan["base"], *(e["offset"] for e in plan["repetitions"])]:
            pair[component] = 0
    elif "index" in spec:
        index = integer(spec["index"], 0, 40320000000, "transpose.index")
        plan["repetitions"] = [e for e in plan["repetitions"] if e["index"] != index]
        if action != "inherit":
            plan["repetitions"].append(
                {"index": index, "offset": dict(ZERO) if action == "zero" else deepcopy(spec.get("offset", ZERO))}
            )
            plan["repetitions"].sort(key=lambda e: e["index"])
    elif action in ("set", "zero"):
        plan["base"] = dict(ZERO) if action == "zero" else deepcopy(spec.get("offset", ZERO))
    else:
        fail("Use set/zero/inherit/reset-component/reset-plan; inherit requires an index.", "transpose.action")
    fields(plan, {"base", "repetitions"}, {"base", "repetitions"}, "transpose.plan")
    validate_plan(plan)
    if prior == plan or prior is None and plan == empty_plan():
        return {"summary": "Transposition is unchanged.", **contributions(config, spec["target"])}
    upgrade(config, 3)
    if scope == "shared":
        if profile:
            profile.update(plan=plan, revision=profile["revision"] + 1)
        else:
            profile = {"id": uid(), "revision": 0, "plan": plan}
            lane.setdefault("transposeProfiles", []).append(profile)
            definition["transposeProfileId"] = profile["id"]
    elif scope == "parent":
        item["transpose"] = plan
        if len(ancestry) > 1:
            ancestry[-2][1]["revision"] += 1
    elif scope == "placement":
        if placement:
            placement["plan"] = plan
        else:
            clip.setdefault("transposePlacements", []).append({"path": deepcopy(spec["target"]["path"]), "plan": plan})
    else:
        fail("Scope must be shared, parent or placement.", "transpose.scope")
    clean_target = {k: v for k, v in spec["target"].items() if k not in ("revision", "fingerprint")}
    return {
        "summary": f"Updated {scope} pitch plan; musical definitions reused.",
        "patternsCreated": 0,
        **contributions(config, clean_target),
    }
