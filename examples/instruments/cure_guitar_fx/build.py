"""Build a stereo Cure-inspired modulation/delay insert using existing opcodes."""

import json
from pathlib import Path

from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


# Stable node IDs are also the keys used by per-instance rack settings.
CONTROLS = [
    ("chorus_mix", "Chorus Mix (%)", 0, 100, 32, "linear"),
    ("chorus_rate", "Chorus Rate (Hz)", 0.05, 3, 0.7, "logarithmic"),
    ("chorus_depth", "Chorus Depth (ms)", 0, 8, 2.5, "linear"),
    ("flanger_mix", "Flanger Mix (%)", 0, 100, 20, "linear"),
    ("flanger_rate", "Flanger Rate (Hz)", 0.02, 2, 0.18, "logarithmic"),
    ("flanger_depth", "Flanger Depth (ms)", 0, 3, 2, "linear"),
    ("flanger_feedback", "Flanger Feedback (%)", 0, 65, 25, "linear"),
    ("delay_mix", "Delay Mix (%)", 0, 100, 22, "linear"),
    ("delay_time", "Delay Time (ms)", 40, 1000, 350, "logarithmic"),
    ("delay_feedback", "Delay Feedback (%)", 0, 75, 35, "linear"),
    ("output_level", "Output (dB)", -18, 0, -3, "linear"),
]


def build_patch() -> PatchDocument:
    nodes, connections, formulas = [], [], {}

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def wire(source, port, target, inlet):
        connections.append(dict(from_node_id=source, from_port_id=port, to_node_id=target, to_port_id=inlet))

    def formula(target, inlet, expression, **bindings):
        inputs = []
        for token, (source, port) in bindings.items():
            wire(source, port, target, inlet)
            inputs.append(dict(token=token, from_node_id=source, from_port_id=port))
        formulas[f"{target}::{inlet}"] = dict(expression=expression, inputs=inputs)

    for index, (identity, label, minimum, maximum, default, scale) in enumerate(CONTROLS):
        node(identity, "perf_controller", 360 * (index % 6), -850 + 320 * (index // 6),
             label=label, min=minimum, max=maximum, default=default, scale=scale)

    node("output_gain", "upsamp", 2700, -350)
    formula("output_gain", "ksig", "ampdb(level)", level=("output_level", "iout"))
    node("flanger_gain", "upsamp", 720, -350)
    formula("flanger_gain", "ksig", "1 - feedback / 100", feedback=("flanger_feedback", "iout"))

    for side, y, phase in [("left", 0, 0), ("right", 800, 0.25)]:
        source = f"input_{side}"
        node(source, "inleta", 0, y, sname=side)

        # Audio-rate sine modulation avoids stair-stepped delay-time changes.
        flfo, flange, fmix = (f"{part}_{side}" for part in ("flanger_lfo", "flanger", "flanger_blend"))
        node(flfo, "oscil3", 360, y - 300, amp=1, ifn=-1, iphs=phase)
        wire("flanger_rate", "iout", flfo, "freq")
        node(flange, "flanger", 720, y, imaxd=0.01)
        formula(flange, "asig", "dry * gain",
                dry=(source, "asignal"), gain=("flanger_gain", "aout"))
        formula(flange, "adel", "(3.5 + wave * depth) / 1000",
                wave=(flfo, "asig"), depth=("flanger_depth", "iout"))
        formula(flange, "kfeedback", "feedback / 100", feedback=("flanger_feedback", "iout"))
        node(fmix, "ntrpol", 1080, y)
        wire(source, "asignal", fmix, "asig1")
        wire(flange, "aout", fmix, "asig2")
        formula(fmix, "kpoint", "mix / 100", mix=("flanger_mix", "iout"))

        clfo, chorus, cmix = (f"{part}_{side}" for part in ("chorus_lfo", "chorus", "chorus_blend"))
        node(clfo, "oscil3", 1080, y - 300, amp=1, ifn=-1, iphs=phase)
        wire("chorus_rate", "iout", clfo, "freq")
        node(chorus, "vdelay3", 1440, y, imd=40, iws=0)
        wire(fmix, "aout", chorus, "asig")
        formula(chorus, "adel", "18 + wave * depth",
                wave=(clfo, "asig"), depth=("chorus_depth", "iout"))
        node(cmix, "ntrpol", 1800, y)
        wire(fmix, "aout", cmix, "asig1")
        wire(chorus, "aout", cmix, "asig2")
        formula(cmix, "kpoint", "mix / 100", mix=("chorus_mix", "iout"))

        delay, dmix, output = (f"{part}_{side}" for part in ("delay", "delay_blend", "output"))
        # An unmodulated flanger is a feedback delay; its internal loop needs
        # no cyclic graph connection. The main echoes have identical L/R timing.
        node(delay, "flanger", 2160, y, imaxd=1.1)
        wire(cmix, "aout", delay, "asig")
        formula(delay, "adel", "time / 1000", time=("delay_time", "iout"))
        formula(delay, "kfeedback", "feedback / 100", feedback=("delay_feedback", "iout"))
        node(dmix, "ntrpol", 2520, y)
        wire(cmix, "aout", dmix, "asig1")
        wire(delay, "aout", dmix, "asig2")
        formula(dmix, "kpoint", "mix / 100", mix=("delay_mix", "iout"))
        node(output, "outleta", 2880, y, sname=side)
        formula(output, "asignal", "signal * gain",
                signal=(dmix, "aout"), gain=("output_gain", "aout"))

    nodes.sort(key=lambda item: item["opcode"] == "outleta")
    return PatchDocument.model_validate(dict(
        id="cure-guitar-fx-v1", name="Cure Guitar FX", instrument_type="continuous", always_on=True,
        description=("Cure-inspired stereo guitar insert: slow flanger, lush chorus, then clean feedback delay. "
                     "Separate Mix, Rate and Depth controls for chorus/flanger; flanger feedback; delay Mix, Time and Feedback; "
                     "Output level. Defaults: chorus 32% / 0.7 Hz / 2.5 ms, flanger 20% / 0.18 Hz / 2 ms / 25% feedback, "
                     "delay 22% / 350 ms / 35% feedback, output -3 dB. No reverb, drive or amp simulation. "
                     "Place before your existing reverb. Each Mix at 0 bypasses that stage; all mixes 0 and Output 0 dB is dry unity. "
                     "Stereo channels remain separate, with 90-degree-offset modulation for width. "
                     "Restart the rack after changing controls. High feedback can boost peaks; Output is not a limiter."),
        graph=dict(
            nodes=nodes, connections=connections,
            engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                               software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
            ui_layout=dict(input_formulas=formulas, audio_blocks={"fx_input": True, "fx_output": True}),
            audio_interface=dict(role="effect", guided=False, mainInput="fx_input", mainOutput="fx_output",
                                 groups=[dict(id=f"fx_{direction}", name=f"Stereo {direction.title()}",
                                              direction=direction, layout="stereo", ports=["left", "right"], purpose="main")
                                         for direction in ("input", "output")]),
        ),
    ))


def main():
    patch = build_patch()
    CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(patch, "0", "none")
    folder = Path(__file__).resolve().parent
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (folder / "cure_guitar_fx.patch.json").write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    definition = ExportedPatchDefinition.model_validate(dict(sourcePatchId=raw.pop("id"), **raw))
    (folder.parent / "Cure_Guitar_FX.orch.instrument.json").write_text(
        definition.model_dump_json(by_alias=True, indent=2) + "\n")
    print(f"Compiled {patch.name}: {len(patch.graph.nodes)} nodes, {len(patch.graph.connections)} connections")


if __name__ == "__main__":
    main()
