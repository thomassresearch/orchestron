"""Arranger history v2: the same reversible field/tail diffs as the GUI."""

from copy import deepcopy
from .song_model import fail, model, validate

MISSING = object()


def diff(before, after, path=()):
    if before == after:
        return []
    if isinstance(before, list) and isinstance(after, list):
        common = min(len(before), len(after))
        changes = [c for i in range(common) for c in diff(before[i], after[i], (*path, i))]
        if len(before) != len(after):
            changes.append(
                {
                    "kind": "splice",
                    "path": list(path),
                    "index": common,
                    "before": deepcopy(before[common:]),
                    "after": deepcopy(after[common:]),
                }
            )
        return changes
    if isinstance(before, dict) and isinstance(after, dict):
        return [
            c
            for k in dict.fromkeys([*before, *after])
            for c in diff(before.get(k, MISSING), after.get(k, MISSING), (*path, k))
        ]
    return [
        {
            "kind": "replace",
            "path": list(path),
            **({"before": deepcopy(before)} if before is not MISSING else {}),
            **({"after": deepcopy(after)} if after is not MISSING else {}),
        }
    ]


def apply_entry(basis, entry, forward):
    result = deepcopy(basis)
    for change in entry["changes"] if forward else reversed(entry["changes"]):
        path = change["path"]
        if (
            not isinstance(path, list)
            or not 1 <= len(path) <= 64
            or any(p in ("__proto__", "constructor", "prototype") for p in path)
        ):
            fail("Invalid history path.", code="history_conflict")
        expected = change.get("before" if forward else "after", MISSING)
        replacement = change.get("after" if forward else "before", MISSING)
        parent = result
        for key in path[:-1]:
            parent = parent[key]
        key = path[-1]
        actual = parent.get(key, MISSING) if isinstance(parent, dict) else parent[key]
        if change["kind"] == "splice":
            index = change["index"]
            if not isinstance(actual, list) or actual[index:] != expected:
                fail("History no longer matches this arrangement.", code="history_conflict")
            actual[index:] = deepcopy(replacement)
        elif change["kind"] == "replace" and actual == expected:
            if replacement is MISSING:
                del parent[key]
            else:
                parent[key] = deepcopy(replacement)
        else:
            fail("History no longer matches this arrangement.", code="history_conflict")
    return result


def empty():
    return {"version": 2, "cursor": 0, "basis": None, "entries": []}


def read(config):
    raw = config.get("sequencer", {}).get("clipHistory")
    if not raw:
        return empty(), None
    try:
        h = deepcopy(raw)
        if h.get("version") not in (1, 2) or not 0 <= h["cursor"] <= len(h["entries"]) <= 25:
            raise ValueError("Invalid cursor/version")
        if not h["entries"]:
            return empty(), None
        if h["version"] == 1:
            entries = h["entries"]
            basis = entries[h["cursor"] - 1]["after"] if h["cursor"] else entries[0]["before"]
            if any(a["after"] != b["before"] for a, b in zip(entries, entries[1:])):
                raise ValueError("Discontinuous history")
            h = {
                "version": 2,
                "cursor": h["cursor"],
                "basis": basis,
                "entries": [{"label": e["label"], "changes": diff(e["before"], e["after"])} for e in entries],
            }
        if h["basis"] != model(config):
            raise ValueError("External arrangement changes")
        topology = [(lane_item["id"], lane_item["source"]) for lane_item in model(config)["lanes"]]
        for forward, indexes in [
            (False, range(h["cursor"] - 1, -1, -1)),
            (True, range(h["cursor"], len(h["entries"]))),
        ]:
            state = model(config)
            for i in indexes:
                state = apply_entry(state, h["entries"][i], forward)
                if [(lane_item["id"], lane_item["source"]) for lane_item in state["lanes"]] != topology:
                    raise ValueError("Source topology changed")
                candidate = {**config, "sequencer": {**config["sequencer"], "clipArrangement": state}}
                validate(candidate)
        return h, None
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        return empty(), f"Discarded incompatible history: {exc}"


def record(config, before, label):
    after = model(config)
    if before == after:
        return None

    def topology(m):
        return [(lane_item["id"], lane_item["source"]) for lane_item in m["lanes"]]

    if topology(before) != topology(after):
        config["sequencer"]["clipHistory"] = empty()
        return "History reset because source topology changed."
    old = {**config, "sequencer": {**config["sequencer"], "clipArrangement": before}}
    h, warning = read(old)
    entries = h["entries"][: h["cursor"]] + [{"label": label[:256], "changes": diff(before, after)}]
    config["sequencer"]["clipHistory"] = {
        "version": 2,
        "cursor": min(len(entries), 25),
        "basis": deepcopy(after),
        "entries": entries[-25:],
    }
    return warning


def replay(config, forward):
    h, warning = read(config)
    if warning:
        fail(warning, code="history_conflict")
    index = h["cursor"] if forward else h["cursor"] - 1
    if not 0 <= index < len(h["entries"]):
        return {"summary": "Nothing to redo." if forward else "Nothing to undo."}
    state = apply_entry(model(config), h["entries"][index], forward)
    config["sequencer"]["clipArrangement"] = state
    h["basis"], h["cursor"] = deepcopy(state), h["cursor"] + (1 if forward else -1)
    config["sequencer"]["clipHistory"] = h
    validate(config)
    return {"summary": ("Redid " if forward else "Undid ") + h["entries"][index]["label"], "cursor": h["cursor"]}
