"""Build the editable Enough and Logan ports; no library writes.

Run from the repository root: .venv/bin/python tools/altamax/build.py
Source: joel / ebmtranceboy, https://ide.csound.com/editor/pXPRc5Y1vALtxqgszdhI
Tests use independently versioned fixtures, never these generated examples.
"""

import argparse
import json
from pathlib import Path
import sys
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))

from backend.app.models.export import ExportedPatchDefinition  # noqa: E402
from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.app.services.compiler_service import CompilerService  # noqa: E402
from backend.app.services.opcode_service import OpcodeService  # noqa: E402
from orchestron_patch.cli.orchestron_patch_cli import validate_graph_invariants  # noqa: E402

SOURCE = "https://ide.csound.com/editor/pXPRc5Y1vALtxqgszdhI"


class Builder:
    def __init__(self, name):
        self.name = name
        self.prefix = name.lower()
        self.nodes, self.connections, self.formulas = [], [], {}
        self.catalog = OpcodeService("/static/icons")

    def node(self, identity, opcode, x, y, **params):
        self.nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))
        spec = self.catalog.get_opcode(opcode)
        return identity + "." + spec.outputs[0].id if spec.outputs else identity

    def wire(self, source, target):
        node, port = source.split(".")
        dest, inlet = target.split(".")
        self.connections.append(dict(from_node_id=node, from_port_id=port, to_node_id=dest, to_port_id=inlet))

    def formula(self, target, expression, **bindings):
        inputs = []
        for token, source in bindings.items():
            self.wire(source, target)
            node, port = source.split(".")
            inputs.append(dict(token=token, from_node_id=node, from_port_id=port))
        self.formulas[target.replace(".", "::")] = dict(expression=expression, inputs=inputs)

    def expression(self, identity, x, y, expression, **bindings):
        out = self.node(identity, "a_mul", x, y, b=1)
        self.formula(identity + ".a", expression, **bindings)
        return out

    def control(self, key, x, low, high, default, scale="linear"):
        return self.node(self.prefix + "_" + key, "perf_controller", x, -700,
                         label=key.title(), min=low, max=high, default=default, scale=scale,
                         controller_group=self.name)

    def spine(self):
        self.pitch = self.node("pitch", "cpsmidi", 0, 0)
        velocity = self.node("velocity_ampmidi", "ampmidi", 0, 850)
        scale = self.node("velocity_scale", "const_i", 0, 1150, value=1)
        self.wire(scale, "velocity_ampmidi.iscal")
        self.timbre = self.control("timbre", 0, *( (0, 2, 1) if self.name == "Enough" else (.05, .97, .93)))
        self.evolution = self.control("evolution", 400, *( (.25, 4, 1) if self.name == "Enough" else (.1, 20, 5)), "logarithmic")
        self.release = self.control("release", 800, .01, 3, .2 if self.name == "Enough" else .5, "logarithmic")
        self.level = self.control("level", 1200, 0, 1 if self.name == "Enough" else .25, .5 if self.name == "Enough" else .06)
        envelope = self.node("amp_madsr", "madsr", 800, 850)
        for index, (port, value) in enumerate([("iatt", .001), ("idec", .001), ("islev", 1)]):
            source = self.node("amp_" + port, "const_i", 400, 850 + 250 * index, value=value)
            self.wire(source, "amp_madsr." + port)
        self.wire(self.release, "amp_madsr.irel")
        amp = self.node("note_gain", "k_mul", 1200, 850)
        self.wire(envelope, "note_gain.a")
        self.formula("note_gain.b", "velocity * level", velocity=velocity, level=self.level)
        self.gain = self.node("smooth_gain", "k_to_a", 1600, 850)
        self.wire(amp, "smooth_gain.kin")

    def finish(self, signal, x, y):
        gain = self.node("output_gain", "a_mul", x, y)
        self.wire(signal, "output_gain.a")
        self.wire(self.gain, "output_gain.b")
        self.node("output_pan2", "pan2", x + 400, y, xp=.5, imode=0)
        self.formula("output_pan2.asig", "signal * 1.4142135623730951", signal=gain)
        for side, port in [("left", "aleft"), ("right", "aright")]:
            self.node("output_" + side, "outleta", x + 800, y, sname=side)
            self.wire("output_pan2." + port, "output_" + side + ".asignal")
        description = (
            "Dry polyphonic MIDI port of " + self.name + " from joel / ebmtranceboy's altamax (" + SOURCE + "). "
            "Four per-instance controls: Timbre, Evolution, Release, Level. Velocity controls output gain only. "
            "1 ms MIDI attack/decay, full sustain; no source mixer effects. "
            + ("Five editable oscil3 operators preserve the 20:4:9:3:1 network and evolving depths. "
               "The original 0.0001 self-feedback is omitted; cubic lookup and oscillator phase differ from its sample loop."
               if self.name == "Enough" else
               "Audio-rate phasors and mirror/limit formulas preserve the alternating cubic phase-shaping network. "
               "Timbre sets the initial shape; it sweeps to 0.03 over Evolution seconds.")
        )
        graph = dict(nodes=self.nodes, connections=self.connections,
                     ui_layout=dict(input_formulas=self.formulas, audio_blocks={"main-output": True}),
                     engine_config=dict(sr=48000, ksmps=32, control_rate=1500, nchnls=2,
                                        software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
                     audio_interface=dict(role="instrument", groups=[dict(
                         id="main-output", name="Stereo Output", direction="output", layout="stereo",
                         ports=["left", "right"], purpose="main")], mainOutput="main-output", guided=False))
        validate_graph_invariants(graph)
        return PatchDocument.model_validate(dict(id=str(uuid5(NAMESPACE_URL, SOURCE + "#" + self.name)),
            name=self.name, description=description, instrument_type="melody", is_template=False,
            always_on=False, schema_version=1, graph=graph))


def enough():
    b = Builder("Enough")
    b.spine()
    depth2 = b.node("depth2", "linseg_a", 400, 0, ia=9, ib=6, ic=2)
    b.formula("depth2.idur1", "time * 0.1", time=b.evolution)
    b.formula("depth2.idur2", "time * 0.5", time=b.evolution)
    depthr = b.node("depthr", "linseg_a", 800, 0, ia=1, ib=0)
    depth1 = b.node("depth1", "linseg_a", 1200, 0, ia=2, ib=0)
    for node in ["depthr", "depth1"]:
        b.formula(node + ".idur1", "time * 2", time=b.evolution)
    op3 = b.node("operator3", "oscil3", 400, 400, amp=1, ifn=-1)
    b.formula("operator3.freq", "20 * pitch", pitch=b.pitch)
    op2 = b.node("operator2", "oscil3", 800, 400, amp=1, ifn=-1)
    b.formula("operator2.freq", "4 * pitch * (1 + mod)", pitch=b.pitch, mod=op3)
    opr = b.node("operatorr", "oscil3", 800, -350, amp=1, ifn=-1)
    b.formula("operatorr.freq", "9 * pitch", pitch=b.pitch)
    op1 = b.node("operator1", "oscil3", 1600, 0, amp=1, ifn=-1)
    b.formula("operator1.freq", "3 * pitch * (1 + d2 * mod2 + dr * modr)",
              pitch=b.pitch, d2=depth2, mod2=op2, dr=depthr, modr=opr)
    carrier = b.node("carrier", "oscil3", 2000, 0, amp=1, ifn=-1)
    b.formula("carrier.freq", "pitch * (1 + timbre * depth * mod)",
              pitch=b.pitch, timbre=b.timbre, depth=depth1, mod=op1)
    return b.finish(carrier, 2400, 0)


def logan():
    b = Builder("Logan")
    b.spine()
    wet = b.node("shape_sweep", "linseg_a", 400, 0, ib=.03)
    b.wire(b.timbre, "shape_sweep.ia")
    b.wire(b.evolution, "shape_sweep.idur1")
    phase = b.node("phase_double", "phasor", 400, 400)
    b.formula("phase_double.xcps", "2 * pitch", pitch=b.pitch)
    half = b.node("phase_fundamental", "phasor", 0, 400)
    b.wire(b.pitch, "phase_fundamental.xcps")
    pulse = b.expression("alternate", 800, 800, "2 * half - phase", half=half, phase=phase)
    ramp = b.node("ramp_fold", "mirror", 800, -400, klow=0, khigh=1)
    b.formula("ramp_fold.asig", "(2 - wet) * (1 - phase)", wet=wet, phase=phase)
    saw = b.expression("saw_shape", 1200, -400,
        "-(2 - wet) * (wet * (1 - phase) - fold) / (1 - wet) / 2 * (1 / (2 - wet) - 0.5)",
        wet=wet, phase=phase, fold=ramp)
    limited = b.node("pick_limit", "limit", 800, 0, xmin=0, xmax=1)
    b.formula("pick_limit.xin", "(1 + 1 / (1 - wet)) * phase", wet=wet, phase=phase)
    pick = b.node("pick_fold", "mirror", 1200, 0, klow=0, khigh=1)
    b.formula("pick_fold.asig", "2 * value", value=limited)
    buzz = b.expression("buzz_shape", 1600, 400,
        "pick * (0.5 - (1 - wet) / (2 - wet))", pick=pick, wet=wet)
    waves = []
    for identity, shape, y in [("one", buzz, 400), ("two", saw, -400)]:
        folded = b.node("wave_" + identity, "mirror", 2000, y, klow=-.5, khigh=.5)
        b.formula("wave_" + identity + ".asig", "2 * (phase + shape) - 0.5", phase=phase, shape=shape)
        waves.append(b.expression("cubic_" + identity, 2400, y, "value * (4 * value * value - 3)", value=folded))
    signal = b.expression("alternate_mix", 2800, 0, "(1 - pulse) * one + pulse * two",
                          pulse=pulse, one=waves[0], two=waves[1])
    return b.finish(signal, 3200, 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "examples/instruments/altamax")
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    compiler = CompilerService(OpcodeService("/static/icons"))
    for patch in [enough(), logan()]:
        compiler.compile_patch(patch, "0", "none")
        payload = patch.model_dump(mode="json", by_alias=True, exclude={"id", "created_at", "updated_at"})
        native = ExportedPatchDefinition(sourcePatchId=patch.id, **payload).model_dump(mode="json", by_alias=True)
        (args.out_dir / (patch.name.lower() + ".patch.json")).write_text(json.dumps(payload, indent=2) + "\n")
        (args.out_dir.parent / (patch.name + ".orch.instrument.json")).write_text(json.dumps(native, indent=2) + "\n")
        print(f"Compiled {patch.name}: {len(patch.graph.nodes)} nodes")


if __name__ == "__main__":
    main()
