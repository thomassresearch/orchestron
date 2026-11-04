"""Validate new authored fields without normalizing away hidden entries or identities."""

from backend.app.models.clip_transposition import (
    MAX_PLAN_ENTRIES,
    MAX_PROFILES,
    MAX_PLACEMENTS,
    MAX_TOTAL_ENTRIES,
    MAX_TOTAL_PLACEMENTS,
    MAX_REPEAT_INDEX,
    OffsetPlan,
)


def validate_transpositions(model, identity):
    entries = placements = 0
    for lane in model["lanes"]:
        supported = lane.get("source") in ("sequencer", "score", "arpeggiator")

        def feature():
            if model["version"] < 3 or not supported:
                raise ValueError("Transposition requires clip v3 and a melodic, score or arpeggiator lane.")

        def plan(value):
            nonlocal entries
            feature()
            if (
                not isinstance(value, dict)
                or set(value) != {"base", "repetitions"}
                or not isinstance(value["repetitions"], list)
                or len(value["repetitions"]) > MAX_PLAN_ENTRIES
            ):
                raise ValueError("Invalid or oversized transposition plan.")
            # Authored JSON uses camelCase exclusively; runtime accepts snake_case too.
            for pair in [value["base"], *(e.get("offset") for e in value["repetitions"] if isinstance(e, dict))]:
                if not isinstance(pair, dict) or set(pair) != {"diatonicSteps", "chromaticSemitones"}:
                    raise ValueError("Invalid transposition offset fields.")
            OffsetPlan.model_validate(value)
            entries += len(value["repetitions"])
            if entries > MAX_TOTAL_ENTRIES:
                raise ValueError("Performance transposition entry limit exceeded.")

        profiles = lane.get("transposeProfiles", [])
        if "transposeProfiles" in lane:
            feature()
        if not isinstance(profiles, list) or len(profiles) > MAX_PROFILES:
            raise ValueError("Transposition profile limit exceeded.")
        for profile in profiles:
            if (
                not isinstance(profile, dict)
                or set(profile) != {"id", "revision", "plan"}
                or type(profile["revision"]) is not int
                or not 0 <= profile["revision"] <= 20160000000
            ):
                raise ValueError("Invalid transposition profile.")
            identity(profile["id"])
            plan(profile["plan"])
        profile_ids = {p["id"] for p in profiles}
        definitions = {d["id"]: d for d in lane["definitions"]}

        def children(items):
            for item in items:
                if "repeatIndex" in item and (model["version"] < 4 or "restTicks" in item or type(item["repeatIndex"]) is not int or not 0 <= item["repeatIndex"] <= MAX_REPEAT_INDEX):
                    raise ValueError("Invalid content repetition index.")
                if "transpose" in item:
                    if "restTicks" in item:
                        raise ValueError("Rests cannot be transposed.")
                    plan(item["transpose"])

        for definition in definitions.values():
            if "transposeProfileId" in definition:
                feature()
                if (
                    not isinstance(definition["transposeProfileId"], str)
                    or definition["transposeProfileId"] not in profile_ids
                ):
                    raise ValueError("Missing transposition profile.")
            children(definition.get("children", []))
        for clip in lane["clips"]:
            children(clip["children"])
            if "repeatIndexBase" in clip and (
                model["version"] < 3
                or type(clip["repeatIndexBase"]) is not int
                or not 0 <= clip["repeatIndexBase"] <= MAX_REPEAT_INDEX
            ):
                raise ValueError("Invalid repetition base.")
            records = clip.get("transposePlacements", [])
            if "transposePlacements" in clip:
                feature()
            if not isinstance(records, list) or len(records) > MAX_PLACEMENTS:
                raise ValueError("Clip transposition placement limit exceeded.")
            placements += len(records)
            if placements > MAX_TOTAL_PLACEMENTS:
                raise ValueError("Performance transposition placement limit exceeded.")
            seen = set()
            for record in records:
                if (
                    not isinstance(record, dict)
                    or set(record) != {"path", "plan"}
                    or not isinstance(record["path"], list)
                    or not 1 <= len(record["path"]) <= 3
                    or any(not isinstance(i, str) for i in record["path"])
                ):
                    raise ValueError("Invalid transposition placement.")
                path = tuple(record["path"])
                if path in seen:
                    raise ValueError("Duplicate transposition placement path.")
                seen.add(path)
                items = clip["children"]
                for item_id in path:
                    item = next((i for i in items if i["id"] == item_id), None)
                    if item is None or "definitionId" not in item:
                        raise ValueError("Invalid transposition placement path.")
                    items = definitions[item["definitionId"]].get("children", [])
                plan(record["plan"])

    validate_derived_transpositions(model)


def validate_derived_transpositions(model):
    """Preflight sparse unions and prepared pitch counts before saving or allocating."""
    total_variants = total_records = 0
    for lane in model["lanes"]:
        if lane["source"] not in ("sequencer", "score", "arpeggiator"):
            continue
        definitions = {d["id"]: d for d in lane["definitions"]}
        profiles = {p["id"]: p["plan"] for p in lane.get("transposeProfiles", [])}
        effective = {}
        variants = set()
        entry_count = 0

        def visit(items, path, inherited, placements, repeat_index=None):
            nonlocal entry_count, total_variants, total_records
            for item in items:
                if "definitionId" not in item:
                    continue
                definition = definitions[item["definitionId"]]
                current = (*path, item["id"])
                index = item.get("repeatIndex", repeat_index)
                plans = [*inherited]
                for p in (
                    profiles.get(definition.get("transposeProfileId")),
                    item.get("transpose"),
                    placements.get(current),
                ):
                    if p is not None:
                        plans.append((p, index))
                if definition["kind"] != "pattern":
                    visit(definition["children"], current, plans, placements, index)
                    continue
                key = tuple((id(p), index) for p, index in plans)
                if key not in effective:
                    plans = [p if index is None else {"base": next((e["offset"] for e in p["repetitions"] if e["index"] == index), p["base"]), "repetitions": []} for p, index in plans]
                    base = tuple(
                        sum(p["base"][field] for p in plans) for field in ("diatonicSteps", "chromaticSemitones")
                    )
                    changes = {}
                    for p in plans:
                        for entry in p["repetitions"]:
                            value = changes.setdefault(entry["index"], list(base))
                            if len(changes) > 65536:
                                raise ValueError("Effective transposition entry limit exceeded.")
                            for i, field in enumerate(("diatonicSteps", "chromaticSemitones")):
                                value[i] += entry["offset"][field] - p["base"][field]
                    entry_count += sum(tuple(v) != base for v in changes.values())
                    if entry_count > 65536:
                        raise ValueError("Effective transposition entry limit exceeded.")
                    effective[key] = {base, *(tuple(v) for v in changes.values())} - {(0, 0)}
                for pair in effective[key]:
                    variant = (definition["id"], pair)
                    if variant in variants:
                        continue
                    variants.add(variant)
                    total_variants += 1
                    total_records += len(definition["payload"]["notes"]) if lane["source"] == "score" else 0
                    if len(variants) > 256 or total_variants > 1024 or total_records > 200000:
                        raise ValueError("Transposition variant/score-record limit exceeded.")

        for clip in lane["clips"]:
            visit(clip["children"], (), [], {tuple(p["path"]): p["plan"] for p in clip.get("transposePlacements", [])})
