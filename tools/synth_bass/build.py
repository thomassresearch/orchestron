"""Rebuild Synth Bass; --install adds a new compiled patch through the API only."""

import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))

from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    ApiClient, apply_input_formulas, apply_performance_controllers,
    build_patch_payload, compile_payload_preflight, validate_graph_invariants,
)
from backend.app.models.patch import PatchCreateRequest  # noqa: E402
from backend.app.models.export import ExportedPatchDefinition  # noqa: E402


def connect(graph, source, target):
    source_node, source_port = source.split(".")
    target_node, target_port = target.split(".")
    graph["connections"].append({
        "from_node_id": source_node, "from_port_id": source_port,
        "to_node_id": target_node, "to_port_id": target_port,
    })


def build():
    payload = build_patch_payload(json.loads((HERE / "base_spec.json").read_text()))
    payload.update(instrument_type="bass", always_on=False, is_template=False)
    graph = payload["graph"]
    graph["nodes"].insert(-2, {
        "id": "filter_envelope", "opcode": "expseg",
        "params": {"ia": 3000, "idur1": 0.18, "ib": 900, "idur2": 0.01, "ic": 900},
        "position": {"x": 1000, "y": 520},
    })
    graph = apply_performance_controllers(graph, [
        {"id": "bass_tone", "target": "effect_1_moogladder2.xcf", "label": "Tone",
         "min": 0.5, "max": 2, "default": 1, "scale": "logarithmic"},
        {"id": "bass_decay", "target": "filter_envelope.idur1", "label": "Decay (s)",
         "min": 0.04, "max": 0.3, "default": 0.18, "scale": "logarithmic"},
        {"id": "bass_drive", "target": "effect_2_distort1.kpregain", "label": "Drive",
         "min": 1, "max": 3, "default": 1.2, "scale": "linear"},
    ])
    connect(graph, "filter_envelope.kenv", "effect_1_moogladder2.xcf")
    connect(graph, "bass_drive.iout", "effect_2_distort1.kpostgain")
    graph = apply_input_formulas(graph, [
        {"target": "effect_1_moogladder2.xcf", "expression": "tone * sweep", "inputs": [
            {"token": "tone", "source": "bass_tone.iout"},
            {"token": "sweep", "source": "filter_envelope.kenv"}]},
        {"target": "effect_2_distort1.kpostgain", "expression": "0.9 / in1"},
    ])
    # Leave room for every node's ports, constants and the collapsed output block.
    positions = {
        "pitch_cpsmidi": (40, 40), "velocity_scale_const": (40, 250),
        "velocity_ampmidi": (330, 250), "env_attack_const": (40, 470),
        "env_decay_const": (40, 680), "env_sustain_const": (40, 890),
        "env_release_const": (40, 1100), "amp_madsr": (330, 600),
        "amp_velocity_envelope": (630, 350), "bass_gain": (330, 40),
        "bass_amp": (630, 40), "bass_vco2": (930, 40),
        "bass_tone": (630, 650), "bass_decay": (630, 980),
        "filter_envelope": (930, 650), "effect_1_moogladder2": (1230, 40),
        "bass_drive": (1230, 650), "effect_2_distort1": (1530, 40),
        "output_pan2": (1830, 40), "output_left": (2130, 40),
        "output_right": (2130, 260),
    }
    for node in graph["nodes"]:
        x, y = positions[node["id"]]
        node["position"] = {"x": x, "y": y}
    validate_graph_invariants(graph)
    payload["graph"] = graph
    PatchCreateRequest.model_validate(payload)
    return payload


def install(payload, api_url):
    client = ApiClient(api_url, timeout=60)
    if any(p["name"] == payload["name"] for p in client.get("/patches")):
        raise RuntimeError("Synth Bass already exists; refusing to replace an instrument.")
    result = compile_payload_preflight(client, payload)
    if result["state"] != "compiled":
        raise RuntimeError(result)
    patch = client.post("/patches", payload)
    exported = ExportedPatchDefinition(
        sourcePatchId=patch["id"], name=patch["name"], description=patch["description"],
        isTemplate=patch["is_template"], alwaysOn=patch["always_on"],
        instrumentType=patch["instrument_type"], schema_version=patch["schema_version"],
        graph=patch["graph"],
    ).model_dump(mode="json", by_alias=True)
    bundle = client.post("/bundles/export/patch", exported)
    restored = ExportedPatchDefinition.model_validate(bundle)
    assert restored.instrument_type == "bass" and not restored.is_template
    assert restored.graph == ExportedPatchDefinition.model_validate(exported).graph
    destination = ROOT / "examples/instruments/Synth_Bass.orch.instrument.json"
    destination.write_text(json.dumps(bundle, indent=2) + "\n")
    report = {"patch_id": patch["id"], "name": patch["name"], "compile_state": result["state"],
              "diagnostics": result["diagnostics"], "native_export": str(destination.relative_to(ROOT))}
    (HERE / "installation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    args = parser.parse_args()
    payload = build()
    (HERE / "patch.json").write_text(json.dumps(payload, indent=2) + "\n")
    if args.install:
        install(payload, args.api_url)
    else:
        print(f"Built {len(payload['graph']['nodes'])} nodes; no backend writes.")
