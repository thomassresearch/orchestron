"""Build the continuous stereo Autopanner and its native instrument export."""

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

    for index, (identity, label, minimum, maximum, default) in enumerate([
        ("tempo", "Tempo (BPM)", 40, 180, 120),
        ("beats", "Beats per cycle", 0.125, 16, 4),
        ("depth", "Depth", 0, 1, 1),
    ]):
        node(f"ap_{identity}", "perf_controller", index * 360, -400,
             label=label, min=minimum, max=maximum, default=default, scale="linear")

    node("ap_lfo", "poscil3", 360, 0, amp=1, ifn=-1, iphs=0)
    formula("ap_lfo", "freq", "tempo / (60 * beats)",
            tempo=("ap_tempo", "iout"), beats=("ap_beats", "iout"))
    # Audio formula sockets accept audio sources, so promote the fixed depth.
    node("ap_depth_audio", "upsamp", 720, 0)
    wire("ap_depth", "iout", "ap_depth_audio", "ksig")

    for side, y, sign in [("left", 360, "+"), ("right", 720, "-")]:
        source, gain, output = [f"ap_{step}_{side}" for step in ("in", "gain", "out")]
        node(source, "inleta", 0, y, sname=side)
        node(gain, "a_mul", 1080, y)
        wire(source, "asignal", gain, "a")
        formula(gain, "b", f"1 - depth * (1 {sign} wave) / 2",
                depth=("ap_depth_audio", "aout"), wave=("ap_lfo", "asig"))
        node(output, "outleta", 1440, y, sname=side)
        wire(gain, "aout", output, "asignal")

    nodes.sort(key=lambda item: item["opcode"] == "outleta")
    return PatchDocument.model_validate(dict(
        id="autopanner-v1", name="Autopanner", always_on=True, instrument_type="continuous",
        description=(
            "Continuous stereo Autopanner with separate left/right paths and a smooth sine sweep. "
            "Tempo (40–180 BPM, default 120), Beats per cycle (0.125–16, default 4), "
            "Depth (0–1, default 1). One cycle lasts 60 * Beats / Tempo seconds. "
            "Depth 0 passes audio unchanged; Depth 1 alternately attenuates each channel to silence. "
            "Gains never exceed unity. Starts centered, moving right; phase resets on rack start. "
            "Set tempo manually: no arranger synchronization. Use as a mixer insert. "
            "Restart the rack after changing settings."
        ),
        graph=dict(
            nodes=nodes, connections=connections,
            engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                               software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
            ui_layout=dict(input_formulas=formulas, audio_blocks={"ap_input": True, "ap_output": True}),
            audio_interface=dict(
                role="effect", guided=False, mainInput="ap_input", mainOutput="ap_output",
                groups=[dict(id=f"ap_{direction}", name=f"Stereo {direction.title()}",
                             direction=direction, layout="stereo",
                             ports=["left", "right"], purpose="main")
                        for direction in ("input", "output")],
            ),
        ),
    ))


if __name__ == "__main__":
    patch = build_patch()
    CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(patch, "0", "none")
    folder = Path(__file__).resolve().parent
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (folder / "autopanner.patch.json").write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    native = ExportedPatchDefinition(sourcePatchId=patch.id, **patch.model_dump(exclude={"id"}))
    (folder.parent / "Autopanner.orch.instrument.json").write_text(
        json.dumps(native.model_dump(mode="json", by_alias=True), indent=2, ensure_ascii=False) + "\n")
    print("Compiled and wrote Autopanner.orch.instrument.json and autopanner.patch.json")
