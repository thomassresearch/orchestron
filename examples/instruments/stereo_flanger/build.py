"""Build the continuous Stereo Flanger graph and native instrument export."""

import json
from pathlib import Path

from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


def build_patch() -> PatchDocument:
    nodes, connections, formulas = [], [], {}

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def wire(source, port, target, inlet):
        connections.append(dict(from_node_id=source, from_port_id=port,
                                to_node_id=target, to_port_id=inlet))

    def formula(target, inlet, expression, **bindings):
        inputs = []
        for token, (source, port) in bindings.items():
            wire(source, port, target, inlet)
            inputs.append(dict(token=token, from_node_id=source, from_port_id=port))
        formulas[f"{target}::{inlet}"] = dict(expression=expression, inputs=inputs)

    for index, (identity, label, minimum, maximum, default, scale) in enumerate([
        ("rate", "Rate (Hz)", 0.02, 5, 0.25, "logarithmic"),
        ("delay", "Delay (ms)", 0.2, 5, 1, "linear"),
        ("depth", "Depth (ms)", 0, 5, 2, "linear"),
        ("feedback", "Feedback", -0.9, 0.9, 0.5, "linear"),
        ("phase", "Stereo Phase (deg)", 0, 180, 90, "linear"),
        ("mix", "Mix", 0, 1, 0.5, "linear"),
    ]):
        node(f"sf_{identity}", "perf_controller", index * 320, -400,
             label=label, min=minimum, max=maximum, default=default, scale=scale)

    # Promote fixed settings for audio-only formula sockets. The delay bias
    # includes Depth, so the bipolar sine never produces a negative delay.
    node("sf_bias", "upsamp", 320, -50)
    formula("sf_bias", "ksig", "(delay + depth) * 0.001",
            delay=("sf_delay", "iout"), depth=("sf_depth", "iout"))
    node("sf_dry_gain", "upsamp", 960, -50)
    formula("sf_dry_gain", "ksig", "1 - mix", mix=("sf_mix", "iout"))
    node("sf_wet_gain", "upsamp", 1280, -50)
    formula("sf_wet_gain", "ksig", "mix * (1 - abs(feedback))",
            mix=("sf_mix", "iout"), feedback=("sf_feedback", "iout"))

    for side, y in [("left", 300), ("right", 750)]:
        source, lfo, delay, mix, output = [f"sf_{step}_{side}" for step in
                                         ("in", "lfo", "delay", "mix", "out")]
        node(source, "inleta", 0, y, sname=side)
        node(lfo, "poscil3", 320, y, ifn=-1, **({"iphs": 0} if side == "left" else {}))
        formula(lfo, "amp", "depth * 0.001", depth=("sf_depth", "iout"))
        wire("sf_rate", "iout", lfo, "freq")
        if side == "right":
            formula(lfo, "iphs", "phase / 360", phase=("sf_phase", "iout"))
        node(delay, "flanger", 640, y, imaxd=0.02)
        wire(source, "asignal", delay, "asig")
        formula(delay, "adel", "bias + wave", bias=("sf_bias", "aout"), wave=(lfo, "asig"))
        wire("sf_feedback", "iout", delay, "kfeedback")
        node(mix, "mix2", 1120, y)
        formula(mix, "a", "dry * gain", dry=(source, "asignal"), gain=("sf_dry_gain", "aout"))
        formula(mix, "b", "wet * gain", wet=(delay, "aout"), gain=("sf_wet_gain", "aout"))
        node(output, "outleta", 1600, y, sname=side)
        wire(mix, "aout", output, "asignal")

    nodes.sort(key=lambda item: item["opcode"] == "outleta")
    return PatchDocument.model_validate(dict(
        id="stereo-flanger-v1", name="Stereo Flanger", always_on=True, instrument_type="continuous",
        description=("Continuous stereo flanger with independent left/right audio paths. "
                     "Rate (0.02–5 Hz, default 0.25), Delay (0.2–5 ms, default 1), "
                     "Depth (0–5 ms, default 2), Feedback (-0.9–0.9, default 0.5), "
                     "Stereo Phase (0–180 degrees, default 90), Mix (0–1, default 0.5). "
                     "Delay sweeps from Delay to Delay + 2 * Depth; wet gain is compensated "
                     "by 1 - abs(Feedback). Mix 0 is dry, 1 is wet only. "
                     "Use as an insert, or set Mix to 1 for a send return. "
                     "Restart the rack after changing controls."),
        graph=dict(
            nodes=nodes, connections=connections,
            engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                               software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
            ui_layout=dict(input_formulas=formulas, audio_blocks={"sf_input": True, "sf_output": True}),
            audio_interface=dict(role="effect", guided=False, mainInput="sf_input", mainOutput="sf_output",
                                 groups=[dict(id=f"sf_{direction}", name=f"Stereo {direction.title()}",
                                              direction=direction, layout="stereo",
                                              ports=["left", "right"], purpose="main")
                                         for direction in ("input", "output")]),
        ),
    ))


if __name__ == "__main__":
    patch = build_patch()
    CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(patch, "0", "none")
    folder = Path(__file__).resolve().parent
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (folder / "stereo_flanger.patch.json").write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    native = ExportedPatchDefinition(sourcePatchId=patch.id, **patch.model_dump(exclude={"id"}))
    (folder.parent / "Stereo_Flanger.orch.instrument.json").write_text(
        json.dumps(native.model_dump(mode="json", by_alias=True), indent=2, ensure_ascii=False) + "\n")
    print("Compiled and wrote Stereo_Flanger.orch.instrument.json and stereo_flanger.patch.json")
