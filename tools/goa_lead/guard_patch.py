"""Add note-dependent statevar Q guards to an explicit saved Goa lead.

Only ordinary graph nodes and supported input formulas are emitted. See
documentation/instrument_design/goa_trance_fm_lead.md for the stability proof.
"""

import argparse
from copy import deepcopy
import json
from pathlib import Path

CUTOFF = "07817312-2bf6-4a88-8465-db474d02b0fe"
RESONANCE = "354bfb51-e700-4955-9141-b93bbe325c72"
FILTERS = ("f7a78046-4533-4b1b-b6e6-9e93bfaefe68", "c6aada3f-f49d-409f-8055-730cbf5f17ab")


def minimum(a, b):
    return f"(({a}) + ({b}) - abs(({a}) - ({b}))) / 2"


def maximum(a, b):
    return f"(({a}) + ({b}) + abs(({a}) - ({b}))) / 2"


def guard_patch(document):
    result = deepcopy(document)
    graph = result["graph"]
    nodes = {node["id"]: node for node in graph["nodes"]}
    formulas = graph["ui_layout"]["input_formulas"]
    # Keep the existing 18 kHz ceiling at 48 kHz, and stay below Nyquist at
    # lower engine rates. The original lower cutoff is 10 Hz.
    ceiling = next(c for c in graph["connections"] if c["to_node_id"] == CUTOFF and c["to_port_id"] == "xmax")
    formulas[f"{CUTOFF}::xmax"] = {
        "expression": minimum("in1", "0.45 * sr"),
        "inputs": [dict(token="in1", from_node_id=ceiling["from_node_id"], from_port_id=ceiling["from_port_id"])],
    }
    for index, filter_id in enumerate(FILTERS):
        assert nodes[filter_id]["opcode"] == "statevar"
        assert nodes[filter_id]["params"].get("iosamps", 0) in (0, 3)
        # Explicitly retain the native default. The coefficient below uses N=3.
        nodes[filter_id]["params"]["iosamps"] = 3
        guard_id = f"goa_stability_coefficient_{index}"
        if guard_id in nodes:
            raise ValueError("This patch already has stability guards")
        incoming = [c for c in graph["connections"] if c["to_node_id"] == filter_id and c["to_port_id"] == "xcf"]
        cutoff_formula = deepcopy(formulas.get(f"{filter_id}::xcf", {
            "expression": "in1",
            "inputs": [dict(token="in1", from_node_id=incoming[0]["from_node_id"], from_port_id=incoming[0]["from_port_id"])],
        }))
        x = f"(3.141592653589793 * ({cutoff_formula['expression']}) / (3 * sr))"
        x2 = f"({x} * {x})"
        # An upper bound on 2*sin(x), with error < 1.3e-11 for x <= .15*pi.
        # This preserves compatibility with the formula editor's arithmetic
        # and abs() language; no compiler-specific variable names are used.
        cutoff_formula["expression"] = f"2 * {x} * (1 - {x2} * (1/6 - {x2} * (1/120 - {x2} * (1/5040 - {x2}/362880))))"
        graph["nodes"].append(dict(id=guard_id, opcode="limit", params={"xmin": 0, "xmax": 2},
                                   position={"x": 960, "y": 1050 + index * 210}))
        formulas[f"{guard_id}::xin"] = cutoff_formula
        for connection in incoming:
            graph["connections"].append({**connection, "to_node_id": guard_id, "to_port_id": "xin"})
        graph["connections"].append(dict(from_node_id=guard_id, from_port_id="xout",
                                          to_node_id=filter_id, to_port_id="xq"))
        # Strict Jury bounds, inset by 2%. Both limits matter: small Q is also
        # unstable at high cutoff. Preserve the user's Q inside this interval.
        lower = "2 * in2 / (0.98 * (4 + in2 * in2))"
        upper = "0.98 / in2"
        formulas[f"{filter_id}::xq"] = {
            "expression": minimum(maximum("in1", lower), upper),
            "inputs": [dict(token="in1", from_node_id=RESONANCE, from_port_id="iout"),
                       dict(token="in2", from_node_id=guard_id, from_port_id="xout")],
        }
    result["description"] = (
        "Cross-FM lead with the original stereo statevar high-pass filters. "
        "Per-note guards keep each channel's effective Q inside its cutoff-dependent stability bounds "
        "with a 2% margin; stable settings retain their original sound. "
        "Guard formulas require the retained 3x filter oversampling. Allow mixer headroom for resonance."
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = guard_patch(json.loads(args.input.read_text()))
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
