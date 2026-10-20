"""Build, preflight and publish the editable expressive tenor saxophone."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))

from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    ApiClient, DEFAULT_API_URL, build_patch_payload, compile_payload_preflight, validate_graph_invariants,
)
from backend.app.models.patch import PatchCreateRequest, PatchGraph  # noqa: E402

NAME = "Tenor Saxophone — Expressive Legato"
STEM = "Tenor_Saxophone_Expressive_Legato"
CONTROLS = [("sax_tone", "Tone", .5), ("sax_growl", "Growl", .35),
            ("sax_squeal", "Squeal", .65), ("sax_vibrato", "Vibrato", .2)]


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def normalized_graph(graph):
    return PatchGraph.model_validate(graph).model_dump(mode="json")


def graph_hash(graph):
    return hashlib.sha256(json.dumps(normalized_graph(graph), sort_keys=True).encode()).hexdigest()


def build(presentation_graph=None):
    payload = build_patch_payload({
        "name": NAME,
        "description": (
            "Balanced acoustic-style, sample-free STK tenor with a fuller reed spectrum and velocity-sensitive "
            "excitation, concert pitch Ab2–E5 (MIDI 44–76). "
            "One legato voice: touching notes share a breath; newest held note wins and releasing it returns "
            "to the previous note and velocity. Gaps tongue again. Velocity 1–95 plays normally, 96–114 adds "
            "growl, and 115–127 introduces sustained overblown octave squeal. Tone, Growl, Squeal and Vibrato "
            "are per-instance controls read at phrase start; zero Growl/Squeal disables that effect. "
            "Dry centered Stereo Output: route to Master. Requires Csound STK and its rawwave data. "
            "Period-synchronous readout preserves the reed across legato notes; wide leaps can color the timbre."
        ),
        "family": "simple_osc", "envelope": {"attack": .01, "decay": .08, "sustain": 1, "release": .1},
        "layers": [{"id": "seed", "opcode": "oscili", "gain": .3, "table": -1}], "output": {"pan": .5},
    })
    payload["instrument_type"] = "melody"
    graph = payload["graph"]
    graph["engine_config"].update(sr=48000, ksmps=16, control_rate=3000)
    graph["nodes"] = [n for n in graph["nodes"] if not n["id"].startswith("seed_")]
    graph["connections"] = [e for e in graph["connections"]
                            if not any(e[k].startswith("seed_") for k in ("from_node_id", "to_node_id"))]
    nodes, edges = graph["nodes"], graph["connections"]
    formulas = graph["ui_layout"].setdefault("input_formulas", {})

    def node(identity, opcode, params=None, x=900, y=0):
        nodes.append(dict(id=identity, opcode=opcode, params=params or {}, position=dict(x=x, y=y)))

    def formula(target, expression, **sources):
        identity, port = target.split(".")
        edges[:] = [e for e in edges if (e["to_node_id"], e["to_port_id"]) != (identity, port)]
        bindings = []
        for token, source in sources.items():
            src, out = source.split(".")
            bindings.append(dict(token=token, from_node_id=src, from_port_id=out))
            edges.append(dict(from_node_id=src, from_port_id=out, to_node_id=identity, to_port_id=port))
        formulas[identity + "::" + port] = dict(expression=expression, inputs=bindings)
        next(n for n in nodes if n["id"] == identity)["params"].pop(port, None)

    for i, (identity, label, default) in enumerate(CONTROLS):
        node(identity, "perf_controller", dict(label=label, min=0, max=1, default=default, scale="linear"), -500, i * 240)
    node("sax_legato", "midi_legato", x=200, y=-500)
    node("sax_voices", "maxalloc", {"icount": 1}, 200, -740)
    node("sax_tongue", "linseg", {"ia": 0, "ib": 1, "idur2": .08, "ic": .95}, 200, 300)
    formula("sax_tongue.idur1", ".035 - .025 * vel * 128 / 127", vel="velocity_ampmidi.iamp")
    formula("amp_velocity_envelope.a", "vel * (.35 + .65 * vel) * tongue", vel="sax_legato.kvelocity",
            tongue="sax_tongue.kenv")
    node("sax_force", "k_mul", {"b": 1}, 550, -700)
    formula("sax_force.a", "(vel * 128 - 95 + abs(vel * 128 - 95)) / 64", vel="sax_legato.kvelocity")
    node("sax_overblow", "k_mul", {"b": 1}, 550, -450)
    formula("sax_overblow.a", "(vel * 128 - 114 + abs(vel * 128 - 114)) / 26", vel="sax_legato.kvelocity")
    node("sax_squeal_mix", "k_mul", {"b": 1}, 900, -450)
    formula("sax_squeal_mix.a", "q * q * amount", q="sax_overblow.kout", amount="sax_squeal.iout")
    node("sax_vibrato_bloom", "linseg", {"ia": 0, "idur1": .2, "ib": 0, "idur2": .35, "ic": 1}, 550, 300)
    node("sax_vibrato_wave", "lfo", {"kamp": 1, "kcps": 5.6, "itype": 0}, 550, 600)
    node("sax_pitch", "k_mul", {"b": 1}, 900, -750)
    formula("sax_pitch.a", "hz * ampdb(.0752575 * vibrato * bloom * wave)", hz="sax_legato.kfreq",
            vibrato="sax_vibrato.iout", bloom="sax_vibrato_bloom.kenv", wave="sax_vibrato_wave.kout")
    # Moving closer to the bridge adds reed edge. More extreme positions readily
    # jump registers; the aperture, stiffness and pressure below are tuned together.
    node("sax_reed", "STKSaxofony", {"iamplitude": .7, "kv3": 46, "kv5": 60}, 1250, -100)
    # One sample of empirical bore correction compensates the native model's flat upper register.
    formula("sax_reed.ifrequency", "hz / (1 - hz / sr)", hz="pitch_cpsmidi.kfreq")
    formula("sax_reed.kv1", "116 - 10 * vel + .4 * force * growl", vel="sax_legato.kvelocity",
            force="sax_force.kout", growl="sax_growl.iout")
    formula("sax_reed.kv2", "25 + .3 * squeal", squeal="sax_squeal_mix.kout")
    formula("sax_reed.kv4", "1.5 + 2 * vel + 5 * force * growl", vel="sax_legato.kvelocity",
            force="sax_force.kout", growl="sax_growl.iout")
    formula("sax_reed.kv6", "3 * vibrato * bloom", vibrato="sax_vibrato.iout", bloom="sax_vibrato_bloom.kenv")
    formula("sax_reed.kv7", "(86 + 6 * vel + .5 * squeal) * env * tongue", vel="sax_legato.kvelocity",
            squeal="sax_squeal_mix.kout", env="amp_madsr.kenv", tongue="sax_tongue.kenv")

    # Two cubic delay taps one bore period apart, complementary triangular windows.
    # The octave branch is the SAME reed signal, not another independently played voice.
    node("sax_zero", "k_to_a", {"kin": 0}, 1250, -800)
    for branch, ratio, y in [("normal", 1, -900), ("octave", 2, 700)]:
        prefix = "sax_" + branch
        node(prefix + "_phase", "syncphasor", {"iphs": .5}, 1600, y)
        formula(prefix + "_phase.asyncin", "zero", zero="sax_zero.aout")
        formula(prefix + "_phase.xcps", f"(source - {ratio} * destination) / 2",
                source="pitch_cpsmidi.kfreq", destination="sax_pitch.kout")
        node(prefix + "_offset", "a_mul", {"b": 1}, 1900, y)
        formula(prefix + "_offset.a", "phase + .5 - floor(phase + .5)", phase=prefix + "_phase.aphase")
        for i, phase in enumerate([prefix + "_phase.aphase", prefix + "_offset.aout"]):
            identity = prefix + f"_tap_{i}"
            node(identity, "vdelay3", {"imd": 300}, 2200, y + i * 230)
            formula(identity + ".asig", "reed", reed="sax_reed.asignal")
            formula(identity + ".adel", "2000 * phase / source", phase=phase, source="pitch_cpsmidi.kfreq")
        node(prefix + "_mix", "a_mul", {"b": 1}, 2500, y)
        formula(prefix + "_mix.a", "first * (1 - abs(2 * phase - 1)) + second * abs(2 * phase - 1)",
                first=prefix + "_tap_0.aout", second=prefix + "_tap_1.aout", phase=prefix + "_phase.aphase")
    node("sax_growl_wave", "oscili", {"amp": 1, "ifn": -1}, 1600, 200)
    formula("sax_growl_wave.freq", "47 + .015 * pitch", pitch="sax_legato.kfreq")
    node("sax_growl_depth", "k_to_a", x=1900, y=200)
    formula("sax_growl_depth.kin", ".5 * force * growl", force="sax_force.kout", growl="sax_growl.iout")
    node("sax_register_mix", "k_to_a", x=2500, y=350)
    formula("sax_register_mix.kin", "squeal", squeal="sax_squeal_mix.kout")
    node("sax_air", "noise", {"beta": 0}, 2200, 1400)
    formula("sax_air.amp", ".008 * amp", amp="amp_velocity_envelope.kout")
    node("sax_air_band", "butterbp", {"xfreq": 1800, "xband": 1800}, 2500, 1400)
    formula("sax_air_band.asig", "air", air="sax_air.aout")
    node("sax_mix", "a_mul", {"b": 1}, 2850, -100)
    formula("sax_mix.a", "(normal * (1 - squeal) + octave * squeal) * (1 + depth * wave)",
            normal="sax_normal_mix.aout", octave="sax_octave_mix.aout", squeal="sax_register_mix.aout",
            depth="sax_growl_depth.aout", wave="sax_growl_wave.asig")
    node("sax_body", "resonx", {"xcf": 850, "xbw": 600, "inumlayer": 1, "iscl": 1}, 3150, 150)
    formula("sax_body.asig", "reed", reed="sax_mix.aout")
    node("sax_presence", "resonx", {"xcf": 2400, "xbw": 1200, "inumlayer": 1, "iscl": 1}, 3150, 450)
    formula("sax_presence.asig", "reed", reed="sax_mix.aout")
    node("sax_lowpass", "butterlp", x=3450, y=-100)
    formula("sax_lowpass.asig", ".8 * reed + .3 * body + 1.5 * presence", reed="sax_mix.aout",
            body="sax_body.aout", presence="sax_presence.aout")
    formula("sax_lowpass.xfreq", "1000 + 6000 * tone + 1200 * vel + 1600 * squeal", tone="sax_tone.iout",
            vel="sax_legato.kvelocity", squeal="sax_squeal_mix.kout")
    node("sax_dc", "butterhp", {"xfreq": 65}, 3750, -100)
    formula("sax_dc.asig", "reed", reed="sax_lowpass.aout")
    node("sax_output_gain", "k_to_a", x=3750, y=350)
    formula("sax_output_gain.kin", ".21 * amp", amp="amp_velocity_envelope.kout")
    formula("output_pan2.asig", "reed * gain + air", reed="sax_dc.aout", gain="sax_output_gain.aout",
            air="sax_air_band.aout")
    for n in nodes:
        if n["id"].startswith("output_"):
            n["position"]["x"] = 4050 if n["id"] == "output_pan2" else 4400
    graph["nodes"] = [n for n in nodes if n["opcode"] != "outleta"] + [n for n in nodes if n["opcode"] == "outleta"]
    if presentation_graph is not None:
        # Rebuilding the sound must not reset the user's canvas arrangement.
        positions = {n["id"]: n["position"] for n in presentation_graph["nodes"]}
        for n in graph["nodes"]:
            if n["id"] in positions:
                n["position"] = {axis: int(value) if isinstance(value, float) and value.is_integer() else value
                                 for axis, value in positions[n["id"]].items()}
        graph["ui_layout"].update({k: v for k, v in presentation_graph["ui_layout"].items()
                                  if k != "input_formulas"})
    validate_graph_invariants(graph)
    PatchCreateRequest.model_validate(payload)
    return payload


def main(action, api_url):
    raw_path = HERE / f"{STEM}.patch.json"
    presentation = json.loads(raw_path.read_text())["graph"] if raw_path.exists() else None
    payload = build(presentation)
    dump(raw_path, payload)
    if action == "build":
        return
    client = ApiClient(api_url, timeout=120)
    compiled = compile_payload_preflight(client, payload)
    assert compiled["state"] == "compiled", compiled
    dump(HERE / "validation/compile.json", {k: v for k, v in compiled.items() if k not in ("orc", "session_id")})
    if action == "preflight":
        print("Compile preflight passed.")
        return
    checks = json.loads((HERE / "validation/audio.json").read_text())
    assert checks["passed"] and checks["spectrograms_inspected"]
    assert checks["graph_sha256"] == graph_hash(payload["graph"]), "Audio validation is stale."
    manifest_path = HERE / "library_manifest.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        current = client.get("/patches/" + previous["patch_id"])
        assert current["name"] == NAME and graph_hash(current["graph"]) == previous["graph_sha256"], "Preserve library edits."
        saved = client.put("/patches/" + previous["patch_id"], payload)
    else:
        assert not any(p["name"] == NAME for p in client.get("/patches")), "Same-name instrument already exists."
        saved = client.post("/patches", payload)
    verified = client.get("/patches/" + saved["id"])
    assert normalized_graph(verified["graph"]) == normalized_graph(payload["graph"])
    assert verified["instrument_type"] == "melody" and not verified["is_template"]
    manifest = dict(patch_id=saved["id"], name=NAME, graph_sha256=graph_hash(saved["graph"]))
    dump(manifest_path, manifest)
    bundle = dict(sourcePatchId=saved["id"], name=NAME, description=saved["description"], isTemplate=False,
                  alwaysOn=False, instrumentType="melody", schema_version=saved["schema_version"], graph=saved["graph"])
    exported = client.post("/bundles/export/patch", bundle)
    preview = client.post("/bundles/import/expand?preview=true", exported)
    assert normalized_graph(preview["graph"]) == normalized_graph(saved["graph"])
    dump(HERE / f"{STEM}.orch.instrument.json", exported)
    dump(HERE.parent / f"{STEM}.orch.instrument.json", exported)
    dump(HERE / "validation/library.json", dict(saved_and_read_back=True, native_import_preview=True, **manifest))
    print(NAME, saved["id"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "preflight", "publish"])
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    args = parser.parse_args()
    main(args.action, args.api_url)
