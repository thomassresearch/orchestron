"""Extend the preserved five-voice exports without replacing their existing graph.

Run from the repository root: .venv/bin/python examples/instruments/analog_drumkit/build_analog_drumkit.py
The native library export and raw starter retain their respective original sound.
No backend or library writes are performed here.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService

HERE = Path(__file__).resolve().parent
TOMS = [
    (41, "Low floor tom", 82, .48), (43, "High floor tom", 98, .43),
    (45, "Low tom", 123, .38), (47, "Low-mid tom", 147, .34),
    (48, "High-mid tom", 175, .30), (50, "High tom", 220, .26),
]


def extend(original):
    patch = copy.deepcopy(original)
    graph = patch["graph"]
    nodes, edges = graph["nodes"], graph["connections"]
    formulas = graph["ui_layout"].setdefault("input_formulas", {})
    cases = graph["control_flow"]["kit"]["cases"]
    assert [case["value"] for case in cases] == [35, 36, 46, 42, 38, None]
    by_id = {node["id"]: node for node in nodes}

    def node(key, opcode, params=None, x=-1100, y=0):
        assert key not in by_id, key
        item = dict(id=key, opcode=opcode, params=params or {}, position=dict(x=x, y=y))
        nodes.append(item)
        by_id[key] = item
        return key

    def wire(source, target):
        src, port = source.split(".")
        dst, inlet = target.split(".")
        edge = dict(from_node_id=src, from_port_id=port, to_node_id=dst, to_port_id=inlet)
        if edge not in edges:
            edges.append(edge)

    def formula(target, expression, **bindings):
        dst, port = target.split(".")
        edges[:] = [e for e in edges if (e["to_node_id"], e["to_port_id"]) != (dst, port)]
        by_id[dst]["params"].pop(port, None)
        for source in bindings.values():
            wire(source, target)
        formulas[f"{dst}::{port}"] = dict(expression=expression, inputs=[
            dict(token=token, from_node_id=source.split(".")[0], from_port_id=source.split(".")[1])
            for token, source in bindings.items()
        ])

    def controller(key, label, low, high, default=1, scale="logarithmic"):
        # Root-level controls can feed several cases; their IDs are permanent.
        return node(key, "perf_controller", dict(label=label, min=low, max=high,
                    default=default, scale=scale), y=400 + 330 * sum(n["opcode"] == "perf_controller" for n in nodes)) + ".iout"

    snap = controller("bd_snappiness", "BD snappiness", .25, 2)
    for prefix in ("bass_drum", "bass_drum_distorted"):
        formula(prefix + "_click.amp", "click * 0.14 * snap", click=prefix + "_click_env.kenv", snap=snap)
        formula(prefix + "_pitch.idur1", "0.026 / snap", snap=snap)

    hat = controller("hihat_tuning", "Hi-hat tuning", .7, 1.3)
    for prefix in ("hihat_open", "hihat_closed"):
        for index in range(1, 7):
            key = f"{prefix}_metal_{index}"
            formula(key + ".kcps", f"{by_id[key]['params']['kcps']} * tuning", tuning=hat)
        for suffix in ("highpass", "lowpass"):
            key = f"{prefix}_{suffix}"
            formula(key + ".xfreq", f"{by_id[key]['params']['xfreq']} * tuning", tuning=hat)

    snare = controller("snare_tuning", "Snare tuning", .65, 1.5)
    formula("snare_body.freq", "pitch * tuning", pitch="snare_pitch.kenv", tuning=snare)
    formula("snare_overtone.freq", "330 * tuning", tuning=snare)
    for suffix in ("highpass", "lowpass"):
        key = f"snare_{suffix}"
        formula(key + ".xfreq", f"{by_id[key]['params']['xfreq']} * tuning", tuning=snare)

    def voice(prefix, name, note, duration, control=None):
        start = len(nodes)
        tail = node(prefix + "_tail", "xtratim", dict(iextradur=duration + .03))
        gate = node(prefix + "_gate", "linseg", dict(ia=0, idur1=.001, ib=1,
                    idur2=duration - .009, ic=1, idur3=.008, id=0))
        env = node(prefix + "_envelope", "expseg", dict(ia=1, idur1=duration * .3,
                    ib=.16, idur2=duration * .7, ic=.0001))
        if control:
            formula(tail + ".iextradur", "decay + 0.03", decay=control)
            formula(gate + ".idur2", "decay - 0.009", decay=control)
            formula(env + ".idur1", "decay * 0.3", decay=control)
            formula(env + ".idur2", "decay * 0.7", decay=control)
        return dict(prefix=prefix, name=name, note=note, start=start, gate=gate + ".kenv", env=env + ".kenv")

    def sine(key, freq, amp, tuning=None, motion=None):
        node(key, "oscili", dict(amp=amp, ifn=-1))
        bindings = {}
        expression = str(freq)
        if tuning:
            expression += " * tuning"
            bindings["tuning"] = tuning
        if motion:
            expression += " * motion"
            bindings["motion"] = motion
        if bindings:
            formula(key + ".freq", expression, **bindings)
        else:
            by_id[key]["params"]["freq"] = freq
        return key + ".asig"

    def noise(key, amp, high, low):
        node(key, "noise", dict(amp=amp, beta=0))
        node(key + "_hp", "butterhp", dict(xfreq=high))
        node(key + "_lp", "butterlp", dict(xfreq=low))
        wire(key + ".aout", key + "_hp.asig")
        wire(key + "_hp.aout", key + "_lp.asig")
        return key + "_lp.aout"

    def finish(v, signals, level=.18, pan=.5, custom_envelope=None):
        prefix = v["prefix"]
        node(prefix + "_amplitude", "upsamp")
        formula(prefix + "_amplitude.ksig", f"decay * gate * velocity * {level}",
                decay=custom_envelope or v["env"], gate=v["gate"], velocity="velocity.iamp")
        node(prefix + "_pan", "pan2", dict(xp=pan))
        bindings = {f"s{i}": signal for i, signal in enumerate(signals)}
        expression = "(" + " + ".join(bindings) + ") * amplitude"
        formula(prefix + "_pan.asig", expression, **bindings, amplitude=prefix + "_amplitude.aout")
        node(prefix + "_result", "CaseResult")
        for channel, outlet in (("left", "aleft"), ("right", "aright")):
            wire(prefix + "_pan." + outlet, prefix + "_result." + channel)
        members = nodes[v["start"]:]
        # Arrange each added case in columns; the editor stacks case frames.
        base_y = 12000 + (len(cases) - 6) * 1900
        for index, item in enumerate(members):
            item["position"] = dict(x=450 + (index % 5) * 360, y=base_y + (index // 5) * 400)
        cases.insert(-1, dict(id=prefix, name=v["name"], value=v["note"],
            node_ids=[item["id"] for item in members], result_node_id=prefix + "_result", silence=False))

    stick = controller("side_stick_tuning", "Side stick tuning", .65, 1.5)
    v = voice("side_stick", "Side stick", 37, .075)
    signals = [sine("side_stick_mode_" + str(i), freq, amp, stick)
               for i, (freq, amp) in enumerate([(1650, .7), (2378, .3), (3211, .18)])]
    signals.append(noise("side_stick_noise", .18, 1500, 8000))
    finish(v, signals, .21)

    clap = controller("clap_decay", "Clap decay (s)", .07, .45, .18)
    v = voice("hand_clap", "Hand clap", 39, .18, clap)
    burst_outputs = []
    for i, delay in enumerate((.0005, .0105, .021)):
        key = node(f"hand_clap_burst_{i}", "expseg", dict(ia=.0001, idur1=delay,
                   ib=.0001, idur2=.0007, ic=1, idur3=.006, id=.0001))
        burst_outputs.append(key + ".kenv")
    node("hand_clap_diffuse", "expseg", dict(ia=.0001, idur1=.028, ib=.0001,
         idur2=.001, ic=.65, id=.0001))
    formula("hand_clap_diffuse.idur3", "decay - 0.029", decay=clap)
    node("hand_clap_bursts", "k_mul", dict(b=1))
    formula("hand_clap_bursts.a", "b0 + b1 + b2 + tail", **{f"b{i}": s for i, s in enumerate(burst_outputs)}, tail="hand_clap_diffuse.kenv")
    signal = noise("hand_clap_noise", 1, 850, 7800)
    finish(v, [signal], .31, custom_envelope="hand_clap_bursts.kout")

    electric = controller("electric_snare_snap", "Electric snare snap", .25, 2)
    v = voice("electric_snare", "Electric snare", 40, .24)
    node("electric_snare_pitch", "expseg", dict(ia=1.65, idur1=.012, ib=1))
    signals = [sine("electric_snare_body", 195, .65, motion="electric_snare_pitch.kenv"),
               sine("electric_snare_ring", 390, .22)]
    signals.append(noise("electric_snare_noise", 1, 1800, 10000))
    formula("electric_snare_noise.amp", "0.7 * snap", snap=electric)
    finish(v, signals, .22)

    for note, name, freq, duration in TOMS:
        prefix = f"tom_{note}"
        tuning = controller(prefix + "_tuning", name + " tuning", .7, 1.4)
        v = voice(prefix, name, note, duration)
        node(prefix + "_pitch", "expseg", dict(ia=1.48, idur1=.018, ib=1.04, idur2=.12, ic=1))
        node(prefix + "_strike", "expseg", dict(ia=1, idur1=.018, ib=.0001))
        signals = [sine(prefix + "_body", freq, .85, tuning, prefix + "_pitch.kenv"),
                   sine(prefix + "_ring", freq * 1.59, .20, tuning)]
        signals.append(noise(prefix + "_noise", .20, 700, 6000))
        formula(prefix + "_noise.amp", "strike * 0.20", strike=prefix + "_strike.kenv")
        finish(v, signals, .23, pan=.38 + (note - 41) / 9 * .24)

    crash = controller("crash_decay", "Crash decay (s)", .35, 2.6, 1.4)
    v = voice("crash", "Crash cymbal 1", 49, 1.4, crash)
    metal = []
    for i, freq in enumerate((317, 491, 683, 997, 1471, 2017)):
        key = node(f"crash_metal_{i}", "vco2", dict(kamp=.16, kcps=freq, imode=2, kpw=.5, kphs=.137 * (i + 1)))
        metal.append(key + ".asig")
    metal.append(noise("crash_air", .55, 1800, 14500))
    node("crash_hp", "butterhp", dict(xfreq=1800))
    formula("crash_hp.asig", " + ".join(f"s{i}" for i in range(len(metal))), **{f"s{i}": s for i, s in enumerate(metal)})
    node("crash_lp", "butterlp", dict(xfreq=14500))
    wire("crash_hp.aout", "crash_lp.asig")
    finish(v, ["crash_lp.aout"], .28, .4)

    ride = controller("ride_brightness", "Ride brightness", .5, 1.5)
    v = voice("ride", "Ride cymbal 1", 51, 1.1)
    signals = []
    for i, (freq, amp) in enumerate(((570, .35), (845, .28), (1193, .24), (1697, .20), (2389, .16), (3571, .12), (5417, .08))):
        key = f"ride_mode_{i}"
        signals.append(sine(key, freq, amp))
        if i >= 3:
            formula(key + ".amp", f"{amp} * brightness", brightness=ride)
    signals.append(noise("ride_air", .13, 3200, 12000))
    node("ride_filter", "butterlp")
    formula("ride_filter.asig", " + ".join(f"s{i}" for i in range(len(signals))), **{f"s{i}": s for i, s in enumerate(signals)})
    formula("ride_filter.xfreq", "8000 * brightness", brightness=ride)
    finish(v, ["ride_filter.aout"], .20, .62)

    tamb = controller("tambourine_decay", "Tambourine decay (s)", .07, .55, .22)
    v = voice("tambourine", "Tambourine", 54, .22, tamb)
    signals = [sine(f"tambourine_jingle_{i}", freq, .13)
               for i, freq in enumerate((2300, 2873, 3511, 4259, 5171, 6271))]
    signals.append(noise("tambourine_air", .6, 3500, 13500))
    finish(v, signals, .24, .55)

    # Preserve all pre-existing controller IDs, memberships, output gain and layout.
    # Keep the output pair last for the standard patch representation.
    nodes[:] = [n for n in nodes if n["id"] not in ("output_left", "output_right")] + [by_id["output_left"], by_id["output_right"]]
    patch["description"] = (
        "17 velocity-sensitive, sample-free analog percussion voices. GM notes: "
        "35 kick, 36 distorted kick, 37 side stick, 38 snare, 39 clap, 40 electric snare, "
        "41/43/45/47/48/50 low-to-high toms, 42 closed hat, 46 open hat, 49 crash, 51 ride, 54 tambourine. "
        "Existing sounds and settings retained. BD snappiness, shared hat tuning and snare tuning default to 1 (original sound). "
        "Each added voice has its own characteristic control. Finite one-shot tails survive short note-offs; unmapped notes are silent. Stereo output."
    )
    # Backend validation is authoritative for custom one-shot Switch graphs.
    doc = PatchDocument.model_validate({**patch, "instrument_type": "percussion"})
    CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch=doc, midi_channel=1)], midi_input="0", rtmidi_module="none")
    return patch


if __name__ == "__main__":
    for source, destination in [
        (HERE / "Analog_Drumkit.original.orch.instrument.json", HERE.parent / "Analog_Drumkit.orch.instrument.json"),
        (HERE / "analog_drumkit.original.patch.json", HERE.parent / "template/analog_drumkit.patch.json"),
    ]:
        result = extend(json.loads(source.read_text()))
        destination.write_text(json.dumps(result, indent=2) + "\n")
        print(f"{destination}: {len(result['graph']['nodes'])} nodes, 17 voices")
