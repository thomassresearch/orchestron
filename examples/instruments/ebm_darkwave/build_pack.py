#!/usr/bin/env python3
"""Reproduce, audition, and import the EBM / Dark Wave instrument collection.

Uses the patch skill's spec builder, graph invariants, API client and compile
preflight. No SQLite access. Run from the repository with its Python environment.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
import time
from pathlib import Path

PACK = Path(__file__).resolve().parent
ROOT = PACK.parents[2]
SKILL = ROOT / "integrations/skills/orchestron-patch-creator"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SKILL / "src"))
from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    ApiClient,
    DEFAULT_API_URL,
    build_patch_payload,
    compile_payload_preflight,
    validate_graph_invariants,
)
from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.app.services.compiler_service import CompilerService  # noqa: E402
from backend.app.services.opcode_service import OpcodeService  # noqa: E402

PITCH = "pitch_cpsmidi.kfreq"
AMP = "amp_velocity_envelope.kout"
VELOCITY = "velocity_ampmidi.iamp"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class Voice:
    def __init__(self, spec):
        self.spec = spec
        self.design = spec["design"]
        self.slug = self.design["slug"]
        self.payload = build_patch_payload(spec)
        self.payload.update(instrument_type=self.design["instrument_type"], always_on=False)
        self.payload["description"] += (
            f" Suggested MIDI {self.design['register'][0]}–{self.design['register'][1]}. "
            "Velocity-sensitive; settings apply to new notes. Motion rates are Hz; echoes are fixed time. "
            "Route Stereo Output through the mixer to Master."
        )
        self.graph = self.payload["graph"]
        self.nodes = {n["id"]: n for n in self.graph["nodes"]}
        self.controls = {}
        for key, params in self.design["controls"].items():
            self.controls[key] = self.add("ctl_" + key, "perf_controller", params) + ".iout"
        self.bind("amp_madsr.iatt", self.controls["attack"])
        self.bind("amp_madsr.irel", self.controls["release"])
        if "decay" in self.controls:
            self.bind("amp_madsr.idec", self.controls["decay"])
        if self.slug == "sequencer_bass":
            self.nodes["env_sustain_const"]["params"]["value"] = 0.08

    def add(self, id, opcode, params=None):
        if id in self.nodes:
            raise ValueError("Duplicate node: " + id)
        n = dict(id=id, opcode=opcode, params=params or {}, position={"x": 0, "y": 0})
        self.graph["nodes"].insert(-2, n)
        self.nodes[id] = n
        return id

    def bind(self, target, source=None, expression=None, **bindings):
        node, port = target.split(".")
        self.nodes[node]["params"].pop(port, None)
        self.graph["connections"] = [
            c for c in self.graph["connections"] if (c["to_node_id"], c["to_port_id"]) != (node, port)
        ]
        formulas = self.graph["ui_layout"].setdefault("input_formulas", {})
        formulas.pop(node + "::" + port, None)
        if source:
            bindings = {"signal": source}
        for ref in dict.fromkeys(bindings.values()):
            src, output = ref.split(".")
            self.graph["connections"].append(
                dict(from_node_id=src, from_port_id=output, to_node_id=node, to_port_id=port)
            )
        if expression is not None:
            formulas[node + "::" + port] = {
                "expression": expression,
                "inputs": [
                    {"token": token, "from_node_id": ref.split(".")[0], "from_port_id": ref.split(".")[1]}
                    for token, ref in bindings.items()
                ],
            }

    def expr(self, id, expression, **bindings):
        self.add(id, "k_mul", {"b": 1})
        self.bind(id + ".a", expression=expression, **bindings)
        return id + ".kout"

    def mix(self, id, expression, **bindings):
        for token, ref in list(bindings.items()):
            node, port = ref.split(".")
            if port not in ("aout", "asig", "aleft", "aright"):
                converted = "audio_" + node + "_" + port
                if converted not in self.nodes:
                    self.add(converted, "k_to_a")
                    self.bind(converted + ".kin", ref)
                bindings[token] = converted + ".aout"
        self.add(id, "mix2", {"b": 0})
        self.bind(id + ".a", expression=expression, **bindings)
        return id + ".aout"

    def effect(self, id, opcode, source, params=None, input="asig"):
        self.add(id, opcode, params)
        self.bind(id + "." + input, source)
        return id + ".aout"

    def lfo(self, id, rate):
        self.add(id, "lfo", {"kamp": 1, "kcps": rate if isinstance(rate, (float, int)) else 0.1, "itype": 0})
        if isinstance(rate, str):
            self.bind(id + ".kcps", rate)
        return id + ".kout"

    def decay(self, id, seconds):
        self.add(id, "linseg", {"ia": 1, "idur1": seconds if isinstance(seconds, (float, int)) else 0.2, "ib": 0})
        if isinstance(seconds, str):
            self.bind(id + ".idur1", seconds)
        return id + ".kenv"

    def ctrl(self, key):
        return self.controls[key]

    def osc(self, layer):
        opcode = next(item["opcode"] for item in self.spec["layers"] if item["id"] == layer)
        return layer + "_" + opcode

    def source(self, layer):
        node = self.osc(layer)
        return node + (".aout" if node.endswith("_noise") else ".asig")

    def tune(self, layer, spread=0, vibrato=None):
        node = self.osc(layer)
        args = {"pitch": PITCH}
        expression = "pitch"
        if spread:
            if "detune" in self.controls:
                args["detune"] = self.ctrl("detune")
                expression += f" * (1 + {spread} * detune * 0.0005777895)"
            else:
                expression += f" * {1 + spread * 0.0035}"
        if vibrato:
            args["vibrato"] = vibrato
            expression += " * (1 + vibrato * 0.0005777895)"
        self.bind(node + (".freq" if node.endswith("_oscili") else ".kcps"), expression=expression, **args)

    def source_gain(self, layer, expression, **bindings):
        # Scale velocity/envelope before oscillation, retaining the skill's gain stage.
        self.bind(layer + "_amp.a", expression=expression, envelope=AMP, **bindings)

    def finish(self, source, chorus=0, echo=0, reverb=0, reverb_time=1.8):
        source = self.effect("dc_filter", "butterhp", source, {"xfreq": 22})
        # Bass is centered. All other stereo width comes from actual channel processing.
        self.bind("output_pan2.asig", source)
        channels = ["output_pan2.aleft", "output_pan2.aright"]
        if any(isinstance(v, str) or v > 0 for v in (chorus, echo, reverb)):
            # Keep effect processors alive beyond the *source* release. xtratim does not
            # multiply the amplitude envelope or turn the source into an always-on patch.
            self.add("effect_tail", "xtratim")
            tail = max(2, reverb_time * 4) if reverb else 2
            self.bind("effect_tail.iextradur", expression=f"release + {tail}", release=self.ctrl("release"))
            self.design["effect_tail_seconds"] = tail
        else:
            self.design["effect_tail_seconds"] = 0
        for i, side in enumerate(("left", "right")):
            dry = channels[i]
            sig = dry
            if isinstance(chorus, str) or chorus:
                motion = self.lfo("chorus_" + side + "_lfo", 0.23 if i == 0 else 0.31)
                wet = self.effect("chorus_" + side, "vdelay3", dry, {"imd": 35})
                self.bind("chorus_" + side + ".adel", expression=f"{14 + i * 5} + 3 * motion", motion=motion)
                if isinstance(chorus, str):
                    sig = self.mix(
                        "chorus_mix_" + side,
                        "dry * (1 - .25 * amount) + wet * .5 * amount",
                        dry=dry,
                        wet=wet,
                        amount=chorus,
                    )
                else:
                    sig = self.mix(
                        "chorus_mix_" + side, f"dry * {1 - 0.25 * chorus} + wet * {0.5 * chorus}", dry=dry, wet=wet
                    )
            if isinstance(echo, str) or echo:
                echoes = []
                for tap in range(1, 4):
                    delayed = self.effect(
                        f"echo_{side}_{tap}", "delay", sig, {"idlt": (0.27 if i == 0 else 0.36) * tap}
                    )
                    echoes.append(
                        self.effect(f"echo_tone_{side}_{tap}", "butterlp", delayed, {"xfreq": 3400 - tap * 500})
                    )
                bindings = dict(dry=sig, tap1=echoes[0], tap2=echoes[1], tap3=echoes[2])
                amount = "amount" if isinstance(echo, str) else str(echo)
                if isinstance(echo, str):
                    bindings["amount"] = echo
                sig = self.mix(
                    "echo_mix_" + side, f"dry + {amount} * (.5 * tap1 + .25 * tap2 + .125 * tap3)", **bindings
                )
            if isinstance(reverb, str) or reverb:
                pre = self.effect("room_predelay_" + side, "delay", sig, {"idlt": 0.017 if i == 0 else 0.029})
                wet = self.effect(
                    "room_" + side,
                    "reverb2",
                    pre,
                    {"krvt": reverb_time * (1 if i == 0 else 0.93), "khf": 0.45, "iskip": 0},
                )
                bindings = dict(dry=sig, wet=wet)
                amount = "amount" if isinstance(reverb, str) else str(reverb)
                if isinstance(reverb, str):
                    bindings["amount"] = reverb
                sig = self.mix("room_mix_" + side, f"dry + {amount} * wet", **bindings)
            if sig != dry:
                # Level formulas live upstream of outlet ports (Csound 6.18 compatibility).
                sig = self.mix("final_level_" + side, f"audio * {self.design['output_gain']}", audio=sig)
                self.bind("output_" + side + ".asignal", sig)
        if channels == [
            next(
                (
                    c["from_node_id"] + "." + c["from_port_id"]
                    for c in self.graph["connections"]
                    if c["to_node_id"] == "output_" + side
                ),
                "",
            )
            for side in ("left", "right")
        ]:
            self.bind("output_pan2.asig", expression=f"audio * {self.design['output_gain']}", audio=source)
        self.layout_and_prune()
        validate_graph_invariants(self.graph)
        return self.payload

    def layout_and_prune(self):
        # Remove unused template constants/mixers; retain initialization controllers and tail opcode.
        inbound = {}
        for c in self.graph["connections"]:
            inbound.setdefault(c["to_node_id"], []).append(c["from_node_id"])
        used = {"output_left", "output_right"} | {
            n["id"] for n in self.graph["nodes"] if n["opcode"] in ("perf_controller", "xtratim", "cpsmidi")
        }

        def visit(node):
            for src in inbound.get(node, []):
                if src not in used:
                    used.add(src)
                    visit(src)

        for n in list(used):
            visit(n)
        self.graph["nodes"] = [n for n in self.graph["nodes"] if n["id"] in used]
        self.graph["connections"] = [
            c for c in self.graph["connections"] if c["to_node_id"] in used and c["from_node_id"] in used
        ]
        formulas = self.graph["ui_layout"].get("input_formulas", {})
        self.graph["ui_layout"]["input_formulas"] = {k: v for k, v in formulas.items() if k.split("::")[0] in used}
        depths = {}

        def depth(node):
            if node not in depths:
                depths[node] = 0 if not inbound.get(node) else 1 + max(depth(s) for s in inbound[node])
            return depths[node]

        columns = {}
        for n in self.graph["nodes"]:
            d = depth(n["id"])
            row = columns.get(d, 0)
            columns[d] = row + 1
            n["position"] = {"x": 40 + d * 310, "y": 40 + row * 230}
        # Outlet pair stays last and grouped, as required by the patch skill.


def make_voice(spec):
    v = Voice(copy.deepcopy(spec))
    key = v.slug
    c = v.controls
    vibrato = None
    if "vibrato" in c:
        vibrato = v.expr("vibrato_depth", "motion * amount", motion=v.lfo("vibrato_lfo", 5.2), amount=c["vibrato"])
    for layer in spec["layers"]:
        if layer["opcode"] == "vco2":
            id = layer["id"]
            spread = -1 if id.endswith("_a") else (1 if id.endswith("_b") else 0)
            v.tune(id, spread, vibrato)
    if "sub" in c:
        v.bind("sub_oscili.freq", expression=".5 * pitch", pitch=PITCH)
        v.source_gain("sub", "envelope * amount", amount=c["sub"])
    motion = None
    if "motion_rate" in c or key == "choir_drone":
        motion = v.lfo("motion_lfo", c.get("motion_rate", 0.11))
    if key == "pwm_lead":
        v.bind(
            "pulse_vco2.kpw",
            expression="width + depth * motion",
            width=c["pulse_width"],
            depth=c["pwm_depth"],
            motion=motion,
        )
    if key == "dark_pwm_pad":
        v.bind("pulse_vco2.kpw", expression=".5 + .2 * depth * motion", depth=c["motion_depth"], motion=motion)
        v.source_gain("pulse", "envelope * blend", blend=c["pulse_blend"])
        v.source_gain("triangle", "envelope * (1 - .6 * blend)", blend=c["pulse_blend"])
    sources = [v.source(layer["id"]) for layer in spec["layers"]]
    source = (
        sources[0]
        if len(sources) == 1
        else v.mix(
            "source_sum",
            " + ".join(f"s{i}" for i in range(len(sources))),
            **{f"s{i}": s for i, s in enumerate(sources)},
        )
    )
    if key in ("fm_bass", "glass_bell", "industrial_stab", "noise_metal_fx"):
        amount = c.get("fm_depth", c.get("clang"))
        fmdecay = c.get("fm_decay", c.get("decay", 0.5))
        if key == "noise_metal_fx":
            v.bind("fm_foscili.kndx", expression="2.5 + 1.5 * depth * motion", depth=c["sweep_depth"], motion=motion)
            v.source_gain("fm", "envelope * blend", blend=c["metal_blend"])
            v.source_gain("air", "envelope * (1 - blend)", blend=c["metal_blend"])
        else:
            env = v.decay("fm_decay_envelope", fmdecay)
            v.bind("fm_foscili.kndx", expression="depth * (.04 + .96 * sweep)", depth=amount, sweep=env)
        if "ratio" in c:
            v.bind("fm_foscili.xmod", c["ratio"])
        if key == "industrial_stab":
            noiseenv = v.decay("noise_transient", 0.055)
            v.source_gain("air", "envelope * amount * transient", amount=c["noise"], transient=noiseenv)
    if key == "choir_drone":
        for id in ("pulse_a", "pulse_b"):
            v.bind(id + "_vco2.kpw", expression=".45 + .08 * depth * motion", depth=c["motion"], motion=motion)
        voice = v.mix("voiced_mix", "a + b", a=v.source("pulse_a"), b=v.source("pulse_b"))
        formants = []
        for i, (lo, hi, band) in enumerate(((320, 800, 130), (800, 1200, 180), (2300, 2800, 250))):
            id = "formant_" + str(i)
            formants.append(v.effect(id, "butterbp", voice, {"xband": band}))
            v.bind(
                id + ".xfreq",
                expression=f"({lo} + {hi - lo} * vowel) * (1 + .025 * depth * motion)",
                vowel=c["vowel"],
                depth=c["motion"],
                motion=motion,
            )
        v.source_gain("air", "envelope * amount", amount=c["breath"])
        breath = v.effect("breath_filter", "butterhp", v.source("air"), {"xfreq": 2200})
        source = v.mix(
            "vowel_mix",
            "1.8 * f0 + 1.3 * f1 + .8 * f2 + air",
            f0=formants[0],
            f1=formants[1],
            f2=formants[2],
            air=breath,
        )
    # Separate filter contours make the brass, bass and pluck genuinely distinct.
    source = v.effect("voice_filter", "moogladder2", source, {"xcf": 2400, "xres": 0.18}, input="ain")
    if "resonance" in c:
        v.bind("voice_filter.xres", c["resonance"])
    tone = c.get("tone", c.get("cutoff", c.get("color")))
    if key in ("analog_brass", "ebm_analog_bass", "sequencer_bass", "resonant_pluck"):
        env = v.decay("filter_decay_envelope", c.get("filter_decay", c.get("decay")))
        if key == "analog_brass":
            # A 15 ms rise followed by independent decay gives brass its opening bite.
            n = v.nodes["filter_decay_envelope"]["params"]
            n.update(ia=0, idur1=0.015, ib=1, ic=0.12)
            v.bind("filter_decay_envelope.idur1", expression=".015")
            v.bind("filter_decay_envelope.idur2", c["filter_decay"])
        bindings = dict(tone=tone, sweep=env)
        amount = c.get("filter_envelope")
        if amount:
            bindings["amount"] = amount
            expr = "tone + amount * sweep"
        elif key == "sequencer_bass":
            bindings.update(velocity=VELOCITY, accent=c["accent"])
            expr = "tone + 2600 * sweep * (.2 + .8 * velocity * accent)"
        else:
            expr = "tone + 2300 * sweep"
        v.bind("voice_filter.xcf", expression=expr, **bindings)
    elif key == "dark_pwm_pad":
        v.bind(
            "voice_filter.xcf",
            expression="tone * (1 + .45 * depth * motion)",
            tone=tone,
            depth=c["motion_depth"],
            motion=motion,
        )
    elif key == "noise_metal_fx":
        v.bind(
            "voice_filter.xcf",
            expression="tone * (1 + .65 * depth * motion)",
            tone=tone,
            depth=c["sweep_depth"],
            motion=motion,
        )
    elif tone:
        v.bind("voice_filter.xcf", tone)
    else:
        v.nodes["voice_filter"]["params"]["xcf"] = 6500
    if "drive" in c:
        # Symmetrical waveshaping with compensation, not an output-normalizing limiter.
        source = v.effect("saturation", "distort1", source, {"kshape1": 0, "kshape2": 0, "imode": 1})
        v.bind("saturation.kpregain", expression="drive * 3", drive=c["drive"])
        v.bind("saturation.kpostgain", expression="1 / (1 + .55 * (drive - 1))", drive=c["drive"])
    if key == "dark_saw_lead":
        return v.finish(source, chorus=c["chorus"], echo=c["echo"])
    if key == "pwm_lead":
        return v.finish(source, chorus=0.25, echo=c["space"])
    if key == "string_ensemble":
        return v.finish(source, chorus=c["chorus"], reverb=c["reverb"], reverb_time=2.3)
    if key == "dark_pwm_pad":
        return v.finish(source, chorus=0.35, reverb=c["space"], reverb_time=2.5)
    if key == "analog_brass":
        return v.finish(source, reverb=c["space"], reverb_time=0.8)
    if key == "resonant_pluck":
        return v.finish(source, echo=c["echo"])
    if key == "glass_bell":
        return v.finish(source, echo=c["space"], reverb=c["space"], reverb_time=2.2)
    if key == "choir_drone":
        return v.finish(source, chorus=0.25, reverb=c["reverb"], reverb_time=2.8)
    if key == "industrial_stab":
        return v.finish(source, reverb=c["space"], reverb_time=0.65)
    if key == "noise_metal_fx":
        return v.finish(source, echo=c["space"], reverb=c["space"], reverb_time=2.7)
    return v.finish(source)


def specifications(only=None):
    return [json.loads(p.read_text()) for p in sorted((PACK / "specs").glob("*.json")) if not only or p.stem in only]


def build(only=None):
    payloads = {}
    compiler = CompilerService(OpcodeService("/static/icons"))
    for spec in specifications(only):
        slug = spec["design"]["slug"]
        payload = make_voice(spec)
        patch = PatchDocument.model_validate(payload)
        artifact = compiler.compile_patch(patch, "internal:loopback", "null")
        if artifact.diagnostics:
            raise RuntimeError(artifact.diagnostics)
        write_json(PACK / "graphs" / f"{slug}.patch.json", payload)
        (PACK / "graphs" / f"{slug}.orc").write_text(artifact.orc)
        payloads[slug] = payload
        print(f"Built {slug}: {len(payload['graph']['nodes'])} nodes", flush=True)
    return payloads


def bundle(saved):
    return dict(
        sourcePatchId=saved["id"],
        name=saved["name"],
        description=saved["description"],
        isTemplate=saved["is_template"],
        alwaysOn=saved["always_on"],
        instrumentType=saved["instrument_type"],
        schema_version=saved["schema_version"],
        graph=saved["graph"],
    )


def import_pack(api_url, only=None):
    manifest_path = PACK / "library_manifest.json"
    manifest = (
        json.loads(manifest_path.read_text()) if manifest_path.exists() else {"api_url": api_url, "instruments": {}}
    )
    if manifest["api_url"] != api_url:
        raise ValueError("Manifest belongs to another backend; use a separate pack checkout.")
    client = ApiClient(api_url, timeout=120)
    baseline_path = PACK / "validation" / "library_before.json"
    if not baseline_path.exists():
        write_json(baseline_path, client.get("/patches"))
    for spec in specifications(only):
        slug = spec["design"]["slug"]
        payload = json.loads((PACK / "graphs" / f"{slug}.patch.json").read_text())
        report = json.loads((PACK / "validation" / f"{slug}.json").read_text())
        if report["graph_sha256"] != digest(payload) or not report["passed"]:
            raise RuntimeError(f"{slug}: validation is missing, stale or failed")
        preflight = compile_payload_preflight(client, payload)
        if preflight.get("state") == "error" or preflight.get("diagnostics"):
            raise RuntimeError(preflight)
        previous = manifest["instruments"].get(slug)
        if previous:
            existing = client.get("/patches/" + previous["id"])
            if existing["name"] != payload["name"]:
                raise RuntimeError("Recorded patch was renamed; refusing to overwrite: " + slug)
            saved = client.put("/patches/" + previous["id"], payload)
        else:
            saved = client.post("/patches", payload)
        exported = bundle(saved)
        # Record ownership before any further request can fail, so retries never
        # create an untracked duplicate after a successful POST.
        manifest["instruments"][slug] = {
            "id": saved["id"],
            "name": saved["name"],
            "graph_sha256": digest(payload),
            "native_roundtrip": "pending",
            "backend_compile": "passed",
        }
        write_json(manifest_path, manifest)
        write_json(PACK / "exports" / f"{slug}.orch.instrument.json", exported)
        # Actual API round trip for import shape, followed by cleanup of only our temporary copy.
        restored = dict(
            name=exported["name"],
            description=exported["description"],
            is_template=exported["isTemplate"],
            always_on=exported["alwaysOn"],
            instrument_type=exported["instrumentType"],
            schema_version=exported["schema_version"],
            graph=exported["graph"],
        )
        restored["name"] = "__ebm_roundtrip__ " + slug
        tmp = client.post("/patches", restored)
        try:
            reread = client.get("/patches/" + tmp["id"])
            for field in ("graph", "instrument_type", "is_template", "always_on", "schema_version"):
                if reread[field] != saved[field]:
                    raise RuntimeError("Bundle round trip changed " + field)
        finally:
            client.delete("/patches/" + tmp["id"])
        manifest["instruments"][slug]["native_roundtrip"] = "passed"
        write_json(manifest_path, manifest)
        print("Imported " + saved["name"], flush=True)
        # Pace compile sessions to avoid exhausting the backend's burst allowance.
        time.sleep(6.1)
    before = {p["id"]: p for p in json.loads(baseline_path.read_text())}
    after = {p["id"]: p for p in client.get("/patches")}
    changed = [id for id, p in before.items() if id not in after or after[id] != p]
    if changed:
        raise RuntimeError("Existing library entries changed during import: " + str(changed))
    write_json(
        PACK / "validation" / "library_preservation.json",
        {"existing_count": len(before), "unchanged": True, "added_count": len(set(after) - set(before))},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "import"])
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--only", nargs="+")
    args = parser.parse_args()
    if args.command == "build":
        build(args.only)
    else:
        import_pack(args.api_url, args.only)


if __name__ == "__main__":
    main()
