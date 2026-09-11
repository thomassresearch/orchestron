#!/usr/bin/env python3
"""Build six new, self-contained Goa/Psy patches without updating old instruments."""
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


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def control(id, target, label, low, high, default, scale="linear"):
    return dict(id=id, target=target, label=label, min=low, max=high, default=default, scale=scale)


def designs():
    def fm(gain, ratio=2, index=2):
        return dict(id="voice", opcode="foscili", gain=gain, carrier_ratio=1,
                    mod_ratio=ratio, mod_index=index, table=1, phase=0)

    def item(name, description, family, adsr, layers, effects, controls, delay, taps, reverb, tail, gain=.65):
        envelope = dict(zip(("attack", "decay", "sustain", "release"), adsr))
        # Explicit source release prevents the FX lifetime extender from stretching it.
        envelope["release_time"] = adsr[3]
        spec = dict(name=name, description=description +
            " Built-in filtered echoes and reverb; no global FX needed. "
            "Velocity-sensitive, polyphonic, three per-instance controls read on new notes. "
            "Route Stereo Output through the mixer to Master.", family=family,
            envelope=envelope, layers=layers, effects=effects, output={"pan": .5})
        return dict(spec=spec, controls=controls, delay=delay, taps=taps,
                    reverb=reverb, tail=tail, output_gain=gain)

    space = lambda prefix, default: control(prefix + "_space", "space_amount.a", "Space", 0, 1, default)
    return {
        "mandala_acid_lead": item("Mandala Acid Lead",
            "Goa acid lead: driven saw, resonant envelope sweep, dotted-eighth echoes. "
            "Echo BPM is manual tempo, not host sync. MIDI 43–79.", "subtractive",
            (.004, .22, .45, .055),
            [dict(id="voice", opcode="vco2", gain=.55, mode=0, phase=0)],
            [dict(opcode="distort1", pre_gain=2.3, post_gain=.26, shape1=0, shape2=0, mode=1),
             dict(opcode="moogladder2", cutoff=750, resonance=.56), dict(opcode="butterhp", cutoff=85)],
            [control("mandala_squelch", "effect_2_moogladder2.xcf", "Squelch (Hz)", 180, 3600, 750, "logarithmic"),
             control("mandala_tempo", "echo_1.idlt", "Echo BPM", 110, 175, 145), space("mandala", .35)],
            45/145, 4, .85, 4, .8),
        "orbit_fm_bleeps": item("Orbit FM Bleeps",
            "Short FM chirps with six fading echoes and an orbiting pan. Chirp sets the upward "
            "pitch excursion at the onset. MIDI 48–84.", "fm_pad", (.0015, .075, 0, .025),
            [fm(.24, 1.414, 1.8)], [dict(opcode="butterhp", cutoff=170), dict(opcode="butterlp", cutoff=9000)],
            [control("orbit_chirp", "voice_foscili.kcps", "Chirp", 0, 3, .8),
             control("orbit_delay", "echo_1.idlt", "Echo (ms)", 90, 480, 210, "logarithmic"), space("orbit", .65)],
            .21, 6, .8, 4.6, .75),
        "chakra_vowel_talker": item("Chakra Vowel Talker",
            "Talking pulse voice with two animated formant bands, a little fundamental, "
            "filtered dotted-eighth repeats and a chamber tail. MIDI 43–76.", "subtractive",
            (.008, .24, .65, .09),
            [dict(id="voice", opcode="vco2", gain=.26, mode=2, pulse_width=.31, phase=0)],
            [dict(opcode="butterhp", cutoff=100)],
            [control("chakra_vowel", "formant_low.xfreq", "Vowel", 0, 1, .35),
             control("chakra_talk", "talk_lfo.kcps", "Talk (Hz)", 1, 14, 4.7, "logarithmic"), space("chakra", .42)],
            45/145, 4, 1.1, 4, .5),
        "astral_laser_zaps": item("Astral Laser Zaps",
            "Descending FM laser with an exponential pitch sweep, clustered 75 ms echoes "
            "and a bright room tail. Sweep is the starting pitch multiplier. MIDI 36–76.", "fm_pad",
            (.001, .12, 0, .025), [fm(.24, 1, 1.2)],
            [dict(opcode="butterhp", cutoff=100), dict(opcode="butterlp", cutoff=9500)],
            [control("astral_sweep", "voice_foscili.kcps", "Sweep", 1, 24, 8, "logarithmic"),
             control("astral_decay", "amp_madsr.idec", "Decay (s)", .04, .45, .12, "logarithmic"), space("astral", .65)],
            .075, 8, 1.4, 3.6, .65),
        "mycelium_stepped_bubbles": item("Mycelium Stepped Bubbles",
            "Deterministic stepped pitch/filter motion makes burbling alien sequences from held notes. "
            "Two unsynchronized LFOs produce the step pattern; repeatable, not random. MIDI 36–76.", "fm_pad",
            (.008, .18, .7, .075), [fm(.22, 2.71, 2.2)],
            [dict(opcode="moogladder2", cutoff=2200, resonance=.28), dict(opcode="butterhp", cutoff=100)],
            [control("mycelium_rate", "step_lfo_a.kcps", "Steps (Hz)", 2, 24, 7, "logarithmic"),
             control("mycelium_mutation", "voice_foscili.kcps", "Mutation", 0, 1, .55), space("mycelium", .5)],
            .21, 4, 1.8, 4.8, .65),
        "event_horizon_riser": item("Event Horizon Riser",
            "Hold a note for a rising FM/noise swell; release it into a diffuse echo and reverb cloud. "
            "Rise controls time to peak. MIDI 36–72.", "fm_pad",
            (2.4, .3, .85, .18), [fm(.14, 2, 2), dict(id="air", opcode="noise", gain=.13, color=.15)],
            [dict(opcode="butterhp", cutoff=200), dict(opcode="butterlp", cutoff=7000)],
            [control("horizon_rise", "amp_madsr.iatt", "Rise (s)", .3, 6, 2.4, "logarithmic"),
             control("horizon_tension", "voice_foscili.kndx", "Tension", 0, 1, .6), space("horizon", .72)],
            .29, 4, 3.2, 7.2, .58),
    }


class Graph:
    def __init__(self, graph):
        self.graph = graph
        self.formulas = []

    def add(self, id, opcode, **params):
        self.graph["nodes"].insert(-2, dict(id=id, opcode=opcode, params=params, position={"x": 0, "y": 0}))
        return id

    def connect(self, source, target):
        sn, sp = source.split(".")
        tn, tp = target.split(".")
        self.graph["connections"].append(dict(from_node_id=sn, from_port_id=sp, to_node_id=tn, to_port_id=tp))

    def formula(self, target, expression, **sources):
        tn, tp = target.split(".")
        self.graph["connections"] = [c for c in self.graph["connections"]
            if (c["to_node_id"], c["to_port_id"]) != (tn, tp)]
        next(n for n in self.graph["nodes"] if n["id"] == tn)["params"].pop(tp, None)
        for source in sources.values():
            self.connect(source, target)
        self.formulas.append(dict(target=target, expression=expression,
            inputs=[dict(token=k, source=v) for k, v in sources.items()]))

    def source(self, target):
        tn, tp = target.split(".")
        c = next(c for c in self.graph["connections"] if (c["to_node_id"], c["to_port_id"]) == (tn, tp))
        return c["from_node_id"] + "." + c["from_port_id"]

    def finish(self):
        graph = apply_input_formulas(self.graph, self.formulas)
        used = {c["from_node_id"] for c in graph["connections"]}
        graph["nodes"] = [n for n in graph["nodes"] if not (n["opcode"].startswith("const_") and n["id"] not in used)]
        parents = {n["id"]: [] for n in graph["nodes"]}
        for c in graph["connections"]:
            parents[c["to_node_id"]].append(c["from_node_id"])
        depths, rows = {}, {}
        def depth(id):
            if id not in depths:
                depths[id] = 1 + max((depth(p) for p in parents[id]), default=-1)
            return depths[id]
        for n in graph["nodes"]:
            d = depth(n["id"])
            row = rows.get(d, 0)
            n["position"] = dict(x=40 + d * 300, y=40 + row * 220)
            rows[d] = row + 1
        validate_graph_invariants(graph)
        assert sum(n["opcode"] == "perf_controller" for n in graph["nodes"]) == 3
        return graph


def make_payload(slug, design):
    payload = build_patch_payload(design["spec"])
    g = Graph(payload["graph"])
    dry = g.source("output_pan2.asig")
    if slug == "chakra_vowel_talker":
        g.add("talk_lfo", "lfo", kamp=1, kcps=4.7, itype=0)
        g.add("formant_low", "butterbp", xfreq=600, xband=220)
        g.add("formant_high", "butterbp", xfreq=1800, xband=380)
        g.connect(dry, "formant_low.asig")
        g.connect(dry, "formant_high.asig")
        g.add("vowel_mix", "mix2", b=0)
        g.formula("vowel_mix.a", "0.16 * dry + 2.8 * low + 1.7 * high",
                  dry=dry, low="formant_low.aout", high="formant_high.aout")
        dry = "vowel_mix.aout"
    if slug == "astral_laser_zaps":
        g.add("laser_sweep_env", "expseg", ia=1, idur1=.12, ib=.0001)
    if slug == "mycelium_stepped_bubbles":
        g.add("step_lfo_a", "lfo", kamp=1, kcps=7, itype=0)
        g.add("step_lfo_b", "lfo", kamp=1, kcps=5.11, itype=0)
        g.add("stepped_value", "k_mul", b=1)
        g.formula("stepped_value.a", "floor((first + second + 2) * 2)",
                  first="step_lfo_a.kout", second="step_lfo_b.kout")
    if slug == "event_horizon_riser":
        g.add("rise_ramp", "linseg", ia=0, idur1=2.4, ib=1)
    is_fm = design["spec"]["family"] == "fm_pad"
    if is_fm:
        g.add("voice_pitch", "k_mul", b=1)

    g.add("space_amount", "k_mul", b=1)
    g.add("space_audio", "k_to_a")
    g.connect("space_amount.kout", "space_audio.kin")
    g.add("echo_filter", "butterlp", xfreq=4200)
    g.connect(dry, "echo_filter.asig")
    last = "echo_filter.aout"
    taps = {}
    for number in range(1, design["taps"] + 1):
        id = f"echo_{number}"
        g.add(id, "delay", idlt=design["delay"], iskip=0)
        g.connect(last, id + ".asig")
        last = id + ".aout"
        taps[f"tap{number}"] = last
    g.add("echo_sum", "mix2", b=0)
    g.formula("echo_sum.a", " + ".join(f"{.62 ** number:.8f} * tap{number}" for number in range(1, design["taps"] + 1)), **taps)
    g.add("local_reverb", "reverb2", krvt=design["reverb"], khf=.55, iskip=0)
    g.formula("local_reverb.asig", "0.45 * dry + 0.55 * echoes", dry=dry, echoes="echo_sum.aout")
    g.add("fx_mix", "mix2", b=0)
    g.formula("fx_mix.a", "dry + space * (0.75 * echoes + 0.38 * reverb)",
              dry=dry, space="space_audio.aout", echoes="echo_sum.aout", reverb="local_reverb.aout")
    g.add("fx_tail_guard", "linsegr", ia=1, idur1=.001, ib=1, irel=design["tail"], iz=0)
    g.add("tail_audio", "k_to_a")
    g.connect("fx_tail_guard.kenv", "tail_audio.kin")
    g.add("orbit_pan_lfo", "lfo", kamp=1, kcps=.37, itype=0)
    g.formula("output_pan2.asig", f"{design['output_gain']} * audio * tail",
              audio="fx_mix.aout", tail="tail_audio.aout")
    g.formula("output_pan2.xp", "0.5 + 0.22 * motion", motion="orbit_pan_lfo.kout")
    g.graph = apply_performance_controllers(g.graph, design["controls"])

    env = "amp_madsr.kenv"
    if slug == "mandala_acid_lead":
        g.formula("effect_2_moogladder2.xcf", "tone + 4200 * env * env", tone="mandala_squelch.iout", env=env)
        for number in range(1, design["taps"] + 1):
            g.formula(f"echo_{number}.idlt", "45 / tempo", tempo="mandala_tempo.iout")
    elif slug == "orbit_fm_bleeps":
        g.formula("voice_pitch.a", "pitch * (1 + chirp * env * env)",
                  pitch="pitch_cpsmidi.kfreq", chirp="orbit_chirp.iout", env=env)
        for number in range(1, design["taps"] + 1):
            g.formula(f"echo_{number}.idlt", "milliseconds * 0.001", milliseconds="orbit_delay.iout")
    elif slug == "chakra_vowel_talker":
        g.formula("formant_low.xfreq", "400 + vowel * 650 + 130 * motion",
                  vowel="chakra_vowel.iout", motion="talk_lfo.kout")
        g.formula("formant_high.xfreq", "1100 + vowel * 1600 - 220 * motion",
                  vowel="chakra_vowel.iout", motion="talk_lfo.kout")
    elif slug == "astral_laser_zaps":
        g.formula("laser_sweep_env.idur1", "decay", decay="astral_decay.iout")
        g.formula("voice_pitch.a", "pitch * (1 + (sweep - 1) * movement)",
                  pitch="pitch_cpsmidi.kfreq", sweep="astral_sweep.iout", movement="laser_sweep_env.kenv")
    elif slug == "mycelium_stepped_bubbles":
        g.formula("step_lfo_b.kcps", "rate * 0.731", rate="mycelium_rate.iout")
        g.formula("voice_pitch.a", "pitch * (1 + mutation * (step * 0.375 - 0.75))",
                  pitch="pitch_cpsmidi.kfreq", mutation="mycelium_mutation.iout", step="stepped_value.kout")
        g.formula("effect_1_moogladder2.xcf", "700 + step * 600", step="stepped_value.kout")
        g.formula("voice_foscili.xamp", "amplitude * (0.25 + 0.75 * abs(motion))",
                  amplitude="voice_amp.kout", motion="step_lfo_a.kout")
    elif slug == "event_horizon_riser":
        g.formula("rise_ramp.idur1", "rise", rise="horizon_rise.iout")
        g.formula("voice_pitch.a", "pitch * (0.5 + (1 + 2.5 * tension) * ramp)",
                  pitch="pitch_cpsmidi.kfreq", tension="horizon_tension.iout", ramp="rise_ramp.kenv")
        g.formula("effect_2_butterlp.xfreq", "700 + ramp * (2000 + 8000 * tension)",
                  ramp="rise_ramp.kenv", tension="horizon_tension.iout")
        g.formula("air_noise.amp", "amplitude * (0.1 + 0.9 * tension)",
                  amplitude="air_amp.kout", tension="horizon_tension.iout")

    if is_fm:
        # Bound the carrier and FM spread for extreme sweeps in the high register.
        g.formula("voice_foscili.kcps", "0.5 * (pitch + 12000 - abs(pitch - 12000))", pitch="voice_pitch.kout")
        ratio = next(layer["mod_ratio"] for layer in design["spec"]["layers"] if layer["opcode"] == "foscili")
        pitch = "(0.5 * (pitch + 12000 - abs(pitch - 12000)))"
        ceiling = f"((0.4 * sr / {pitch} - 1) / {ratio} - 1)"
        ceiling = f"(0.5 * ({ceiling} + abs({ceiling})))"
        index = {"orbit_fm_bleeps": "(0.3 + 1.5 * env)", "astral_laser_zaps": "(0.2 + env)",
                 "mycelium_stepped_bubbles": "(0.5 + 2.5 * mutation)",
                 "event_horizon_riser": "(0.2 + 6 * tension * ramp)"}[slug]
        sources = {"pitch": "voice_pitch.kout"}
        if "env" in index:
            sources["env"] = env
        if "mutation" in index:
            sources["mutation"] = "mycelium_mutation.iout"
        if "tension" in index:
            sources.update(tension="horizon_tension.iout", ramp="rise_ramp.kenv")
        g.formula("voice_foscili.kndx", f"0.5 * ({index} + {ceiling} - abs({index} - {ceiling}))", **sources)
    payload["graph"] = g.finish()
    return payload


def build():
    payloads = {}
    for slug, design in designs().items():
        write_json(HERE / "specs" / f"{slug}.json", design["spec"])
        payloads[slug] = make_payload(slug, design)
        write_json(HERE / "graphs" / f"{slug}.patch.json", payloads[slug])
    return payloads


def compile_all(client, payloads):
    report_path = HERE / "validation/compile_results.json"
    results = json.loads(report_path.read_text()) if report_path.exists() else {}
    for slug, payload in payloads.items():
        compiled = compile_payload_preflight(client, payload)
        if compiled["state"] != "compiled":
            raise RuntimeError(compiled)
        path = HERE / "validation" / f"{slug}.orc"
        path.parent.mkdir(exist_ok=True)
        path.write_text(compiled["orc"] + "\n")
        results[slug] = dict(payload_sha256=fingerprint(payload), state=compiled["state"], diagnostics=compiled["diagnostics"])
        print("Compiled", payload["name"], flush=True)
    write_json(report_path, results)


def check_existing(client):
    before_install = HERE / "validation/library_before_install.json"
    baseline_path = before_install if before_install.exists() else HERE / "validation/library_before.json"
    baseline = json.loads(baseline_path.read_text())
    for id, item in baseline.items():
        if fingerprint(client.get("/patches/" + id)) != item["sha256"]:
            raise RuntimeError("Existing instrument changed since snapshot: " + item["name"])
    return len(baseline)


def prepare_install_baseline(client):
    """Preserve concurrent user edits; audit the state immediately before our creates."""
    path = HERE / "validation/library_before_install.json"
    if path.exists():
        return
    original = json.loads((HERE / "validation/library_before.json").read_text())
    current, concurrent = {}, []
    for item in client.get("/patches"):
        saved = client.get("/patches/" + item["id"])
        digest = fingerprint(saved)
        current[item["id"]] = dict(name=saved["name"], sha256=digest)
        if item["id"] in original and original[item["id"]]["sha256"] != digest:
            concurrent.append(dict(id=item["id"], name=saved["name"], updated_at=saved["updated_at"],
                                   original_sha256=original[item["id"]]["sha256"], preserved_sha256=digest))
    write_json(HERE / "validation/concurrent_updates.json", concurrent)
    write_json(path, current)


def install(client, payloads):
    prepare_install_baseline(client)
    check_existing(client)
    audio = json.loads((HERE / "validation/audio_report.json").read_text())
    compiled = json.loads((HERE / "validation/compile_results.json").read_text())
    for slug, payload in payloads.items():
        assert audio[slug]["passed"] and audio[slug]["payload_sha256"] == fingerprint(payload)
        assert compiled[slug]["payload_sha256"] == fingerprint(payload)
    path = HERE / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    existing = client.get("/patches")
    existing_ids = {p["id"] for p in existing}
    for slug, payload in payloads.items():
        if slug in manifest and manifest[slug]["patch_id"] in existing_ids:
            print("Already installed", payload["name"], flush=True)
            continue
        if any(p["name"] == payload["name"] for p in existing):
            raise RuntimeError("Name conflict; no existing instrument will be modified: " + payload["name"])
        saved = client.post("/patches", payload)
        native = dict(sourcePatchId=saved["id"], name=saved["name"], description=saved["description"],
            isTemplate=False, alwaysOn=False, schema_version=saved["schema_version"], graph=saved["graph"])
        write_json(HERE / f"{slug}.orch.instrument.json", native)
        manifest[slug] = dict(patch_id=saved["id"], name=saved["name"], payload_sha256=fingerprint(payload),
            controllers=[dict(node_id=n["id"], **n["params"]) for n in saved["graph"]["nodes"] if n["opcode"] == "perf_controller"])
        write_json(path, manifest)
        print("Installed", saved["name"], saved["id"], flush=True)


def verify(client, payloads):
    sys.path.insert(0, str(ROOT))
    from backend.app.models.patch import PatchGraph
    manifest = json.loads((HERE / "manifest.json").read_text())
    results = {}
    for slug, payload in payloads.items():
        entry = manifest[slug]
        saved = client.get("/patches/" + entry["patch_id"])
        native = json.loads((HERE / f"{slug}.orch.instrument.json").read_text())
        expected = PatchGraph.model_validate(payload["graph"]).model_dump(mode="json", by_alias=True)
        assert expected == saved["graph"] == native["graph"]
        session = client.post("/sessions", {"instruments": [dict(id=f"verify-{extreme}", patch_id=saved["id"],
            midi_channel=channel, performance_controller_values={c["node_id"]: c[extreme] for c in entry["controllers"]})
            for channel, extreme in enumerate(("min", "max"), start=1)]})
        try:
            compiled = client.post(f"/sessions/{session['session_id']}/compile")
            assert compiled["state"] == "compiled"
            bindings = compiled["manifest"]["performanceControllers"]
            for c in entry["controllers"]:
                a, b = bindings["verify-min"][c["node_id"]], bindings["verify-max"][c["node_id"]]
                assert a["value"] == c["min"] and b["value"] == c["max"] and a["channel"] != b["channel"]
        finally:
            client.delete(f"/sessions/{session['session_id']}")
        results[slug] = dict(patch_id=saved["id"], export_matches=True, independent_controls=True, passed=True)
    results["existing_library"] = dict(unchanged_count=check_existing(client), passed=True)
    write_json(HERE / "validation/installed_report.json", results)
    print("Verified six new instruments;", results["existing_library"]["unchanged_count"], "existing entries unchanged")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "compile", "install", "verify"])
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    parser.add_argument("--instrument", help="Compile only this instrument slug")
    args = parser.parse_args()
    payloads = build()
    if args.instrument:
        if args.action != "compile":
            parser.error("--instrument is only supported for compile")
        payloads = {args.instrument: payloads[args.instrument]}
    if args.action != "build":
        {"compile": compile_all, "install": install, "verify": verify}[args.action](ApiClient(args.api_url, timeout=60), payloads)
    else:
        print("Built six validated graphs")


if __name__ == "__main__":
    try:
        main()
    except PatchCliError as exc:
        print(json.dumps(exc.to_json(debug=True), indent=2), file=sys.stderr)
        sys.exit(1)
