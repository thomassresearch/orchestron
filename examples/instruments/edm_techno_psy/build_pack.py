#!/usr/bin/env python3
"""Reproduce, compile, and install the six-instrument pack using the skill API.

Run with the repository .venv Python. No database access; install is explicit.
Base specs are valid CLI specs. This builder adds modulation wiring afterward.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))
from orchestron_patch.cli.orchestron_patch_cli import (
    ApiClient, PatchCliError, apply_input_formulas, apply_performance_controllers,
    build_patch_payload, compile_payload_preflight, validate_graph_invariants,
)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def control(id, target, label, low, high, default, scale="logarithmic"):
    return dict(id=id, target=target, label=label, min=low, max=high,
                default=default, scale=scale)


def specifications():
    def spec(name, description, family, adsr, layers, effects, controls):
        return dict(name=name, description=description +
                    " Dry, velocity-sensitive, polyphonic. Three per-instance controls read on new notes. "
                    "Route Stereo Output through the performance mixer to Master.",
                    family=family, envelope=dict(zip(("attack", "decay", "sustain", "release"), adsr)),
                    layers=layers, effects=effects, output={"pan": 0.5},
                    performance_controllers=controls)

    def fm(gain, ratio, index):
        return dict(id="fm", opcode="foscili", gain=gain, carrier_ratio=1,
                    mod_ratio=ratio, mod_index=index, table=1, phase=0)

    def ladder(cutoff, resonance):
        return dict(opcode="moogladder2", cutoff=cutoff, resonance=resonance)

    def distortion(drive, gain):
        return dict(opcode="distort1", pre_gain=drive, post_gain=gain,
                    shape1=0, shape2=0, mode=1)

    return {
        "psy_rotor_bass": spec("Psy Rotor Bass",
            "Phase-reset saw for rolling psy bass. Tone is the floor of a 3500 Hz envelope sweep; "
            "mild saturation precedes the ladder filter. Suggested MIDI notes 28–52.",
            "subtractive", (.002, .10, 0, .012),
            [dict(id="saw", opcode="vco2", gain=.65, mode=0, phase=0)],
            [distortion(1.8, .42), ladder(350, .16)], [
                control("rotor_decay", "amp_madsr.idec", "Decay (s)", .04, .25, .10),
                control("rotor_tone", "effect_2_moogladder2.xcf", "Tone (Hz)", 100, 1800, 350),
                control("rotor_drive", "effect_1_distort1.kpregain", "Drive", 1, 5, 1.8)]),
        "rubber_core_fm_bass": spec("Rubber Core FM Bass",
            "One 1:2 FM pair plus a sine at the played fundamental. Growl fades with the envelope "
            "to a sustained rubbery body. Suggested MIDI notes 28–55.",
            "fm_pad", (.003, .25, .15, .05),
            [fm(.24, 2, 2), dict(id="body", opcode="oscili", gain=.14, table=1)],
            [ladder(900, .12)], [
                control("rubber_growl", "fm_foscili.kndx", "Growl", .3, 6, 2),
                control("rubber_tone", "effect_1_moogladder2.xcf", "Tone (Hz)", 150, 3500, 900),
                control("rubber_decay", "amp_madsr.idec", "Decay (s)", .08, 1.2, .25)]),
        "prism_fm_pluck": spec("Prism FM Pluck",
            "A harmonic 1:3 FM pair with a bright onset that softens into a glassy pluck. "
            "Release controls the tail after key-up; decay controls held notes. Suggested MIDI notes 48–84.",
            "fm_pad", (.002, .35, 0, .15), [fm(.25, 3, 1.2)],
            [dict(opcode="butterhp", cutoff=100), dict(opcode="butterlp", cutoff=10000)], [
                control("prism_color", "fm_foscili.kndx", "Color", .15, 5, 1.2),
                control("prism_decay", "amp_madsr.idec", "Decay (s)", .08, 1.8, .35),
                control("prism_release", "amp_madsr.irel", "Release (s)", .03, 1.2, .15)]),
        "furnace_techno_stab": spec("Furnace Techno Stab",
            "Saw and square at one played pitch, saturated into an envelope-swept resonant filter. "
            "Play your own chords; no fixed chord or unison. Suggested MIDI notes 43–79.",
            "subtractive", (.003, .22, 0, .08),
            [dict(id="saw", opcode="vco2", gain=.45, mode=0, phase=0),
             dict(id="square", opcode="vco2", gain=.30, mode=2, pulse_width=.5, phase=.25)],
            [distortion(2, .25), ladder(1100, .28), dict(opcode="butterhp", cutoff=100)], [
                control("furnace_tone", "effect_2_moogladder2.xcf", "Tone (Hz)", 200, 6000, 1100),
                control("furnace_decay", "amp_madsr.idec", "Decay (s)", .06, 1, .22),
                control("furnace_drive", "effect_1_distort1.kpregain", "Drive", 1, 8, 2)]),
        "alloy_sequence_voice": spec("Alloy Sequence Voice",
            "Short metallic FM sequence voice. Ratio sets the modulator/carrier relationship; "
            "non-integer values are inharmonic. High-pass filtered to leave bass space. Suggested MIDI notes 48–84.",
            "fm_pad", (.001, .14, 0, .04), [fm(.24, 2.414, 3)],
            [dict(opcode="butterhp", cutoff=220), dict(opcode="butterlp", cutoff=9000)], [
                control("alloy_clang", "fm_foscili.kndx", "Clang", .2, 8, 3),
                control("alloy_ratio", "fm_foscili.xmod", "Ratio", 1, 4, 2.414, "linear"),
                control("alloy_decay", "amp_madsr.idec", "Decay (s)", .03, .7, .14)]),
        "undertow_motion_pad": spec("Undertow Motion Pad",
            "Dark triangle and PWM pulse pad. Sine LFO moves pulse width from 0.32 to 0.68 and "
            "filter cutoff from 70% to 130% of Tone. Motion is Hz, not tempo sync. Suggested MIDI notes 43–79.",
            "subtractive", (.6, 1.5, .7, 2.5),
            [dict(id="triangle", opcode="vco2", gain=.14, mode=12, phase=0),
             dict(id="pulse", opcode="vco2", gain=.09, mode=2, pulse_width=.5, phase=.25)],
            [dict(opcode="butterhp", cutoff=70), ladder(1400, .18)], [
                control("undertow_tone", "effect_2_moogladder2.xcf", "Tone (Hz)", 200, 6000, 1400),
                control("undertow_release", "amp_madsr.irel", "Release (s)", .2, 6, 2.5)]),
    }


def extend_graph(slug, payload):
    graph = payload["graph"]
    formulas = []

    def formula(target, expression, **sources):
        node, port = target.split(".")
        graph["connections"] = [c for c in graph["connections"]
                                if (c["to_node_id"], c["to_port_id"]) != (node, port)]
        for source in sources.values():
            source_node, source_port = source.split(".")
            graph["connections"].append(dict(from_node_id=source_node, from_port_id=source_port,
                                             to_node_id=node, to_port_id=port))
        next(n for n in graph["nodes"] if n["id"] == node)["params"].pop(port, None)
        formulas.append(dict(target=target, expression=expression,
                             inputs=[dict(token=k, source=v) for k, v in sources.items()]))

    def fm_index(expression, ratio_expression, **sources):
        # Keep the strongest FM sidebands below 0.42*sr in the upper register.
        # abs expresses max(0, ceiling) and min(index, ceiling) in GUI formulas.
        ceiling = f"((0.42 * sr / pitch - 1) / {ratio_expression} - 1)"
        ceiling = f"(0.5 * ({ceiling} + abs({ceiling})))"
        bounded = f"0.5 * (({expression}) + {ceiling} - abs(({expression}) - {ceiling}))"
        formula("fm_foscili.kndx", bounded, pitch="pitch_cpsmidi.kfreq", **sources)

    if slug == "psy_rotor_bass":
        formula("effect_2_moogladder2.xcf", "tone + 3500 * env * env",
                tone="rotor_tone.iout", env="amp_madsr.kenv")
    elif slug == "rubber_core_fm_bass":
        fm_index("growl * (0.2 + 0.8 * env)", "2",
                growl="rubber_growl.iout", env="amp_madsr.kenv")
        formula("effect_1_moogladder2.xcf", "tone + 1700 * env * env",
                tone="rubber_tone.iout", env="amp_madsr.kenv")
    elif slug == "prism_fm_pluck":
        fm_index("color * (0.12 + 0.88 * env)", "3",
                color="prism_color.iout", env="amp_madsr.kenv")
    elif slug == "furnace_techno_stab":
        formula("effect_2_moogladder2.xcf", "tone * (1 + env)",
                tone="furnace_tone.iout", env="amp_madsr.kenv")
    elif slug == "alloy_sequence_voice":
        fm_index("clang * (0.4 + 0.6 * env)", "ratio",
                clang="alloy_clang.iout", env="amp_madsr.kenv", ratio="alloy_ratio.iout")
    elif slug == "undertow_motion_pad":
        graph["nodes"].insert(-2, dict(id="undertow_lfo", opcode="lfo",
            params=dict(kamp=1, kcps=.13, itype=0), position=dict(x=700, y=700)))
        graph = apply_performance_controllers(graph, [control("undertow_motion", "undertow_lfo.kcps",
            "Motion (Hz)", .02, 1.5, .13)])
        formula("pulse_vco2.kpw", "0.5 + 0.18 * motion", motion="undertow_lfo.kout")
        formula("effect_2_moogladder2.xcf", "tone * (1 + 0.3 * motion)",
                tone="undertow_tone.iout", motion="undertow_lfo.kout")
        # Rack order follows the node list, so put Motion between Tone and Release.
        motion = next(n for n in graph["nodes"] if n["id"] == "undertow_motion")
        graph["nodes"].remove(motion)
        release_index = next(i for i, n in enumerate(graph["nodes"]) if n["id"] == "undertow_release")
        graph["nodes"].insert(release_index, motion)

    formula("output_pan2.asig", "signal * 0.85", signal=next(
        f"{c['from_node_id']}.{c['from_port_id']}" for c in graph["connections"]
        if c["to_node_id"] == "output_pan2" and c["to_port_id"] == "asig"))
    graph = apply_input_formulas(graph, formulas)
    # Remove constants superseded by rack controls, leaving a readable graph.
    used = {c["from_node_id"] for c in graph["connections"]}
    graph["nodes"] = [n for n in graph["nodes"] if not
                      (n["opcode"].startswith("const_") and n["id"] not in used)]
    layout_graph(graph)
    validate_graph_invariants(graph)
    assert len([n for n in graph["nodes"] if n["opcode"] == "perf_controller"]) == 3
    payload["graph"] = graph
    return payload


def layout_graph(graph):
    """Deterministic dependency columns with ample spacing and outlets last."""
    depths = {}
    incoming = {n["id"]: [] for n in graph["nodes"]}
    for c in graph["connections"]:
        incoming[c["to_node_id"]].append(c["from_node_id"])

    def depth(id):
        if id not in depths:
            depths[id] = 1 + max((depth(p) for p in incoming[id]), default=-1)
        return depths[id]

    rows = {}
    for node in graph["nodes"]:
        column = depth(node["id"])
        row = rows.get(column, 0)
        node["position"] = dict(x=40 + column * 300, y=40 + row * 230)
        rows[column] = row + 1


def build():
    payloads = {}
    for slug, spec in specifications().items():
        write_json(HERE / "specs" / f"{slug}.json", spec)
        payload = extend_graph(slug, build_patch_payload(spec))
        write_json(HERE / "graphs" / f"{slug}.patch.json", payload)
        payloads[slug] = payload
    return payloads


def fingerprint(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def compile_all(client, payloads):
    results = {}
    for slug, payload in payloads.items():
        compiled = compile_payload_preflight(client, payload)
        if compiled.get("state") != "compiled":
            raise RuntimeError(f"{slug}: {compiled}")
        path = HERE / "validation" / f"{slug}.orc"
        path.parent.mkdir(exist_ok=True)
        path.write_text(compiled["orc"] + "\n")
        results[slug] = dict(state=compiled["state"], diagnostics=compiled["diagnostics"],
                             payload_sha256=fingerprint(payload))
        print(f"Compiled {payload['name']}", flush=True)
    write_json(HERE / "validation" / "compile_results.json", results)
    return results


def install(client, payloads):
    report = json.loads((HERE / "validation" / "audio_report.json").read_text())
    compiled = json.loads((HERE / "validation" / "compile_results.json").read_text())
    for slug, payload in payloads.items():
        if not report[slug]["passed"] or report[slug]["payload_sha256"] != fingerprint(payload):
            raise RuntimeError(f"Audio validation is missing or stale: {slug}")
        if compiled[slug]["payload_sha256"] != fingerprint(payload):
            raise RuntimeError(f"Compile validation is stale: {slug}")
    manifest_path = HERE / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    existing = client.get("/patches")
    existing_by_id = {p["id"]: p for p in existing}
    for slug, payload in payloads.items():
        previous = manifest.get(slug)
        if previous and previous["patch_id"] in existing_by_id:
            saved = client.get(f"/patches/{previous['patch_id']}")
            # A repeat install never overwrites a saved patch, including user edits.
            print(f"Already installed {saved['name']} ({saved['id']})", flush=True)
            continue
        if any(p["name"] == payload["name"] for p in existing):
            raise RuntimeError(f"Name already exists without this pack's manifest: {payload['name']}")
        saved = client.post("/patches", payload)
        native = dict(sourcePatchId=saved["id"], name=saved["name"],
            description=saved["description"], isTemplate=False, alwaysOn=False,
            schema_version=saved["schema_version"], graph=saved["graph"])
        write_json(HERE / f"{slug}.orch.instrument.json", native)
        manifest[slug] = dict(patch_id=saved["id"], name=saved["name"],
            payload_sha256=fingerprint(payload),
            controllers=[dict(node_id=n["id"], **n["params"]) for n in saved["graph"]["nodes"]
                         if n["opcode"] == "perf_controller"])
        write_json(manifest_path, manifest)
        print(f"Installed {saved['name']} ({saved['id']})", flush=True)


def verify_install(client, payloads):
    sys.path.insert(0, str(ROOT))
    from backend.app.models.patch import PatchGraph

    manifest = json.loads((HERE / "manifest.json").read_text())
    listed = {p["id"]: p for p in client.get("/patches")}
    results = {}
    for slug, payload in payloads.items():
        entry = manifest[slug]
        saved = client.get(f"/patches/{entry['patch_id']}")
        native = json.loads((HERE / f"{slug}.orch.instrument.json").read_text())
        normalized = PatchGraph.model_validate(payload["graph"]).model_dump(mode="json", by_alias=True)
        assert normalized == saved["graph"] == native["graph"], f"Graph mismatch: {slug}"
        assert saved["name"] == native["name"] == payload["name"]
        assert native["sourcePatchId"] == saved["id"]
        assert len(listed[saved["id"]]["performance_controllers"]) == 3
        assert listed[saved["id"]]["audio_outlet_names"] == ["left", "right"]
        assert not saved["always_on"] and not saved["is_template"]
        session = client.post("/sessions", {"instruments": [
            {"id": f"pack-check-{extreme}", "patch_id": saved["id"], "midi_channel": channel,
             "performance_controller_values": {c["node_id"]: c[extreme] for c in entry["controllers"]}}
            for channel, extreme in enumerate(("min", "max"), start=1)]})
        try:
            compiled = client.post(f"/sessions/{session['session_id']}/compile")
            assert compiled["state"] == "compiled", compiled["diagnostics"]
            instances = compiled["manifest"]["performanceControllers"]
            for c in entry["controllers"]:
                a = instances["pack-check-min"][c["node_id"]]
                b = instances["pack-check-max"][c["node_id"]]
                assert a["value"] == c["min"] and b["value"] == c["max"]
                assert a["channel"] != b["channel"]
            results[slug] = dict(patch_id=saved["id"], native_export_matches=True,
                                independent_instance_controls=True, diagnostics=compiled["diagnostics"], passed=True)
        finally:
            client.delete(f"/sessions/{session['session_id']}")
        print(f"Verified saved graph and independent rack instances: {saved['name']}", flush=True)
    write_json(HERE / "validation" / "installed_report.json", results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "compile", "install", "verify"])
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    args = parser.parse_args()
    payloads = build()
    if args.action == "compile":
        compile_all(ApiClient(args.api_url, timeout=60), payloads)
    elif args.action == "install":
        install(ApiClient(args.api_url, timeout=60), payloads)
    elif args.action == "verify":
        verify_install(ApiClient(args.api_url, timeout=60), payloads)
    else:
        print(f"Built {len(payloads)} validated graphs")


if __name__ == "__main__":
    try:
        main()
    except PatchCliError as exc:
        print(json.dumps(exc.to_json(debug=True), indent=2), file=sys.stderr)
        sys.exit(1)
