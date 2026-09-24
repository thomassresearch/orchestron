"""Lossless conversion of designated legacy Master instances to the internal bus.

Read/save/import boundaries use this without modifying library patches. Explicit
database cleanup lives in backend.tools.migrate_internal_master.
"""

from copy import deepcopy
from hashlib import sha256
from pydantic import ValidationError

from backend.app.models.audio import AudioGraph, MixerState
from backend.app.services.internal_master import MASTER


def is_neutral_master(patch: dict) -> bool:
    """Recognize the shipped output graph, never a patch's display name."""
    graph = patch.get("graph", {})
    interface = graph.get("audio_interface") or {}
    if not patch.get("always_on", patch.get("alwaysOn", False)) or patch.get("is_template", patch.get("isTemplate", False)):
        return False
    if interface.get("role") != "output" or interface.get("guided") is not True:
        return False
    if graph.get("control_flow") or any(
        graph.get("ui_layout", {}).get(key) for key in ("input_formulas", "gen_nodes", "sfload_nodes")
    ):
        return False
    expected = {
        "input-left": ("inleta", {"sname": "left"}),
        "input-right": ("inleta", {"sname": "right"}),
        "output": ("outs", {}),
    }
    nodes = graph.get("nodes", [])
    if len(nodes) != 3 or {n.get("id") for n in nodes} != set(expected):
        return False
    if any((n.get("opcode"), n.get("params", {})) != expected[n["id"]] for n in nodes):
        return False
    connections = graph.get("connections", [])
    return len(connections) == 2 and {
        (c.get("from_node_id"), c.get("from_port_id"), c.get("to_node_id"), c.get("to_port_id"))
        for c in connections
    } == {("input-" + side, "asignal", "output", side) for side in ("left", "right")}


def direct_route_id(identity: str, side: str) -> str:
    return "direct_" + sha256((identity + side).encode()).hexdigest()[:24]


def replace_neutral_master(config: dict, old: str) -> dict:
    """Also used by explicit missing-Master repair after checking its ports."""
    result = deepcopy(config)
    graph = result["audioGraph"]
    graph["masterId"] = MASTER
    result["instruments"] = [b for b in result.get("instruments", []) if b.get("id") != old]
    removed_ids = {b.get("patchId") for b in config.get("instruments", []) if b.get("id") == old}
    used_ids = {b.get("patchId") for b in result["instruments"]}
    for key in ("patchDefinitions", "patch_definitions"):
        if isinstance(result.get(key), list):
            result[key] = [p for p in result[key] if p.get("sourcePatchId", p.get("id")) not in removed_ids - used_ids]
    for route in graph.get("routes", []):
        for key in ("sourceId", "targetId"):
            if route.get(key) == old:
                route[key] = MASTER
    graph["insertOwners"] = {k: MASTER if v == old else v for k, v in graph.get("insertOwners", {}).items()}
    mixer = result.setdefault("mixer", {})
    strips = mixer.setdefault("strips", {})
    if old in strips:
        strips[MASTER] = strips.pop(old)
        strips[MASTER]["solo"] = False
    sends = mixer.setdefault("sends", {})
    explicit_ids = {r["id"] for r in graph.get("routes", [])}
    for side in ("left", "right"):
        previous = direct_route_id(old, side)
        if previous in sends and previous not in explicit_ids:
            sends[direct_route_id(MASTER, side)] = sends.pop(previous)
    # Version 14 changes the audio model; earlier unrelated migrations still
    # belong to the existing v1–10 reader.
    if result.get("version", 11) >= 11:
        result["version"] = max(14, result.get("version", 14))
    return result


def normalize_master_config(config: dict, lookup) -> dict:
    graph = config.get("audioGraph")
    if not isinstance(graph, dict):
        return config
    old = graph.get("masterId")
    if old == MASTER:
        return config
    bindings = config.get("instruments", [])
    if not isinstance(bindings, list) or any(not isinstance(b, dict) for b in bindings):
        return config
    if not isinstance(config.get("version", 11), int):
        return config
    try:
        AudioGraph.model_validate(graph)
        MixerState.model_validate(config.get("mixer", {}))
    except ValidationError:
        return config  # Invalid imported data remains available for repair.
    if not old:
        result = deepcopy(config)
        result["audioGraph"]["masterId"] = MASTER
        if result.get("version", 11) >= 11:
            result["version"] = max(14, result.get("version", 14))
        return result
    binding = next((b for b in config.get("instruments", []) if b.get("id") == old), None)
    definitions = config.get("patchDefinitions", config.get("patch_definitions", []))
    embedded = next((p for p in definitions if isinstance(p, dict) and binding
                     and p.get("sourcePatchId", p.get("id")) == binding.get("patchId")), None) if isinstance(definitions, list) else None
    patch = embedded or (lookup(binding.get("patchId")) if binding else None)
    if patch is None:
        return config  # Keep missing references available for explicit repair.
    if is_neutral_master(patch) and old not in graph.get("insertOwners", {}):
        return replace_neutral_master(config, old)
    # Preserve custom synthesis, inserts and strip controls on the existing
    # processor. Only its speaker-bound paths acquire a neutral downstream bus.
    result = deepcopy(config)
    routes = result["audioGraph"].setdefault("routes", [])
    for route in routes:
        if route.get("sourceId") == old and route.get("targetId") == "$output":
            route["targetId"] = MASTER
            route["targetStage"] = "input"
    if any(n.get("opcode") == "outs" for n in patch.get("graph", {}).get("nodes", [])):
        for side in ("left", "right"):
            port = "$direct." + side
            if not any(r.get("sourceId") == old and r.get("sourcePort") == port and r.get("kind") == "main" for r in routes):
                routes.append({
                    "id": direct_route_id(old, side), "sourceId": old, "sourcePort": port,
                    "targetId": MASTER, "targetPort": side, "kind": "main",
                    "sourceStage": "strip", "targetStage": "input",
                })
    strip = result.get("mixer", {}).get("strips", {}).get(old)
    if strip:
        strip["solo"] = False  # Solo was ignored on the formerly designated Master.
    result["audioGraph"]["masterId"] = MASTER
    if len(routes) > 1024:
        return config  # Preserve a full custom graph for manual repair.
    if result.get("version", 11) >= 11:
        result["version"] = max(14, result.get("version", 14))
    return result


def normalize_master_bundle(payload: dict, lookup=lambda _: None) -> dict:
    if not isinstance(payload.get("performance"), dict) or not isinstance(payload["performance"].get("config"), dict):
        return payload
    definitions = payload.get("patch_definitions", [])
    if not isinstance(definitions, list) or any(not isinstance(p, dict) or not isinstance(p.get("sourcePatchId"), str) for p in definitions):
        return payload
    by_id = {p["sourcePatchId"]: p for p in definitions}
    config = payload["performance"]["config"]
    from backend.app.services.arpeggiator_migration import migrate_arpeggiators
    from backend.app.services.sequencer_timing_migration import migrate_sequencer_timing
    normalized = migrate_sequencer_timing(migrate_arpeggiators(normalize_master_config(config, lambda key: by_id.get(key) or lookup(key))))
    if normalized is config:
        return payload
    result = deepcopy(payload)
    result["performance"]["config"] = normalized
    old_ids = {b.get("patchId") for b in config.get("instruments", [])}
    used_ids = {b.get("patchId") for b in normalized.get("instruments", [])}
    removed = old_ids - used_ids
    result["patch_definitions"] = [p for p in definitions if p["sourcePatchId"] not in removed]
    return result


def normalize_master_app_state(state: dict, lookup) -> dict:
    if state.get("version") not in (2, 3) or not isinstance(state.get("audioGraph"), dict):
        return state
    config = {"version": 14, "instruments": state.get("sequencerInstruments", []),
              "audioGraph": state["audioGraph"], "mixer": state.get("mixer", {})}
    normalized = normalize_master_config(config, lookup)
    if normalized == config:
        return state
    return {**state, "sequencerInstruments": normalized["instruments"],
            "audioGraph": normalized["audioGraph"], "mixer": normalized["mixer"]}


def repository_lookup(repository):
    def lookup(patch_id):
        patch = repository.get(patch_id) if repository else None
        return patch.model_dump(mode="json", by_alias=True) if patch else None
    return lookup
