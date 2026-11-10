"""Author Gleissendes Licht; --install compile-checks and adds it to the library."""

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
    sn, sp = source.split(".")
    tn, tp = target.split(".")
    graph["connections"].append({"from_node_id": sn, "from_port_id": sp,
                                 "to_node_id": tn, "to_port_id": tp})


def build():
    payload = build_patch_payload(json.loads((HERE / "base_spec.json").read_text()))
    payload.update(instrument_type="melody", always_on=False, is_template=False)
    graph = payload["graph"]
    for node_id, opcode, params in [
        ("sting_envelope", "expseg", {"ia": 1, "idur1": 0.19, "ib": 0.025,
                                      "idur2": 0.01, "ic": 0.025}),
        ("shimmer_lfo", "lfo", {"kamp": 1, "kcps": 3.7, "itype": 0}),
        ("slow_lfo", "lfo", {"kamp": 0.25, "kcps": 0.43, "itype": 0}),
    ]:
        graph["nodes"].insert(-2, {"id": node_id, "opcode": opcode,
                                   "params": params, "position": {"x": 0, "y": 0}})
    graph = apply_performance_controllers(graph, [
        {"id": "light_brilliance", "target": "light_foscili.kndx", "label": "Brilliance",
         "min": 1.4, "max": 4.8, "default": 2.8, "scale": "linear",
         "controller_group": "Light"},
        {"id": "light_motion", "target": "shimmer_lfo.kamp", "label": "Motion",
         "min": 0, "max": 0.65, "default": 0.36, "scale": "linear",
         "controller_group": "Light"},
        {"id": "light_release", "target": "amp_madsr.irel", "label": "Release (s)",
         "min": 0.06, "max": 0.9, "default": 0.26, "scale": "logarithmic",
         "controller_group": "Envelope"},
    ])
    # High-pass the metallic branch before adding the quiet fundamental.
    replace_targets = {("layer_mix_1", "a"), ("effect_1_butterhp", "asig"),
                       ("effect_2_butterlp", "asig")}
    graph["connections"] = [c for c in graph["connections"]
                            if (c["to_node_id"], c["to_port_id"]) not in replace_targets]
    for source, target in [
        ("light_foscili.asig", "effect_1_butterhp.asig"),
        ("effect_1_butterhp.aout", "layer_mix_1.a"),
        ("layer_mix_1.aout", "effect_2_butterlp.asig"),
        ("pitch_cpsmidi.kfreq", "effect_1_butterhp.xfreq"),
        ("light_motion.iout", "slow_lfo.kamp"),
        ("velocity_ampmidi.iamp", "light_foscili.kndx"),
        ("sting_envelope.kenv", "light_foscili.kndx"),
        ("shimmer_lfo.kout", "light_foscili.kndx"),
        ("slow_lfo.kout", "light_foscili.kndx"),
        ("pitch_cpsmidi.kfreq", "light_foscili.kndx"),
    ]:
        connect(graph, source, target)
    graph = apply_input_formulas(graph, [
        {"target": "output_pan2.asig", "expression": "0.65 * in1"},
        {"target": "effect_1_butterhp.xfreq", "expression": "1.7 * in1"},
        {"target": "slow_lfo.kamp", "expression": "0.25 * in1"},
        {"target": "light_foscili.kndx",
         "expression": "(edge * (0.72 + 0.28 * velocity) + 0.85 * sting + shimmer + drift) / (1 + pitch / 1200)",
         "inputs": [{"token": token, "source": source} for token, source in [
             ("edge", "light_brilliance.iout"), ("velocity", "velocity_ampmidi.iamp"),
             ("sting", "sting_envelope.kenv"), ("shimmer", "shimmer_lfo.kout"),
             ("drift", "slow_lfo.kout"), ("pitch", "pitch_cpsmidi.kfreq")]]},
    ])
    # Remove the unused release constant replaced by the rack control.
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "env_release_const"]
    columns = [
        ["pitch_cpsmidi", "velocity_scale_const", "env_attack_const", "env_decay_const", "env_sustain_const"],
        ["velocity_ampmidi", "light_release", "amp_madsr", "amp_velocity_envelope"],
        ["light_gain", "light_amp", "anchor_gain", "anchor_amp"],
        ["light_brilliance", "light_motion", "sting_envelope", "shimmer_lfo", "slow_lfo"],
        ["light_foscili", "anchor_oscili"],
        ["effect_1_butterhp", "layer_mix_1"],
        ["effect_2_butterlp", "output_pan2"],
        ["output_left", "output_right"],
    ]
    positions = {name: {"x": 50 + col * 340, "y": 50 + row * 340}
                 for col, names in enumerate(columns) for row, name in enumerate(names)}
    for node in graph["nodes"]:
        node["position"] = positions[node["id"]]
    validate_graph_invariants(graph)
    payload["graph"] = graph
    PatchCreateRequest.model_validate(payload)
    return payload


def install(payload, api_url):
    client = ApiClient(api_url, timeout=60)
    if any(p["name"] == payload["name"] for p in client.get("/patches")):
        raise RuntimeError("Gleissendes Licht already exists; refusing to overwrite it.")
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
    assert restored.instrument_type == "melody" and not restored.is_template
    assert restored.graph == ExportedPatchDefinition.model_validate(exported).graph
    destination = ROOT / "examples/instruments/Gleissendes_Licht.orch.instrument.json"
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
