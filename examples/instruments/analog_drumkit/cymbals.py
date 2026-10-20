"""Install the listening-approved MIDI 49/51 branches without changing the rack."""
from __future__ import annotations

import copy
import json
from pathlib import Path


def apply_approved_cymbals(graph):
    """Replace only the cymbal cases, retaining shared controls and output gain.

    The versioned fragment is the exact crash-v2 / ride-v1 graph approved through
    paired auditions. Keeping it as data avoids retuning it during regeneration.
    """
    fragment = json.loads(Path(__file__).with_name("approved_cymbals.json").read_text())
    cases = graph["control_flow"]["kit"]["cases"]
    previous = [case for case in cases if case["value"] in (49, 51)]
    removed = {key for case in previous for key in case["node_ids"]}
    added = {node["id"] for node in fragment["nodes"]}
    retained = {node["id"] for node in graph["nodes"]} - removed
    if added & retained:
        raise ValueError("Cymbal node IDs conflict with another voice.")
    if any(edge["from_node_id"] in removed and edge["to_node_id"] not in removed
           for edge in graph["connections"]):
        raise ValueError("A cymbal node is connected outside its case; merge manually.")
    for edge in fragment["connections"]:
        if edge["from_node_id"] not in added | retained:
            raise ValueError(f"Missing shared cymbal input: {edge['from_node_id']}")

    graph["nodes"][:] = [node for node in graph["nodes"] if node["id"] not in removed]
    graph["nodes"].extend(fragment["nodes"])
    graph["connections"][:] = [
        edge for edge in graph["connections"]
        if edge["from_node_id"] not in removed and edge["to_node_id"] not in removed
    ]
    graph["connections"].extend(fragment["connections"])
    formulas = graph["ui_layout"].setdefault("input_formulas", {})
    for key in list(formulas):
        if key.split("::")[0] in removed:
            del formulas[key]
    formulas.update(fragment["input_formulas"])
    for replacement in fragment["cases"]:
        current = next((case for case in cases if case["value"] == replacement["value"]), None)
        if current is None:
            cases.insert(len(cases) - 1, copy.deepcopy(replacement))
        else:
            current["node_ids"] = replacement["node_ids"]
            current["result_node_id"] = replacement["result_node_id"]
            current["silence"] = False
