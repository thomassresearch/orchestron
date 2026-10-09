"""Build the editable stereo Tube Overdrive example; run from the repository root."""

from pathlib import Path
import json

from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


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

    for identity, label, minimum, maximum, default, scale, x in [
        ("tube_drive_db", "Drive (dB)", 0, 24, 12, "linear", 990),
        ("tube_tone_hz", "Tone (Hz)", 2000, 12000, 6500, "logarithmic", 1650),
        ("tube_output_db", "Output (dB)", -18, 6, -3, "linear", 2310),
    ]:
        node(identity, "perf_controller", x, -310,
             label=label, min=minimum, max=maximum, default=default, scale=scale)

    # outleta accepts audio only: promote the shared I-rate gain after computing it.
    node("tube_gain", "upsamp", 1980, -310)
    formula("tube_gain", "ksig", "ampdb(level - drive / 2)",
            level=("tube_output_db", "iout"), drive=("tube_drive_db", "iout"))

    for side, y in [("left", 40), ("right", 390)]:
        source, hp, pre, shape, dc, tone, output = [f"tube_{step}_{side}" for step in
                                                   ("in", "hp", "pre", "shape", "dc", "tone", "out")]
        node(source, "inleta", 0, y, sname=side)
        node(hp, "atone", 330, y, khp=20, iskip=0)
        node(pre, "butterlp", 660, y, xfreq=12000, iskip=0)
        node(shape, "tanh", 990, y)
        node(dc, "atone", 1320, y, khp=10, iskip=0)
        node(tone, "butterlp", 1650, y, iskip=0)
        wire(source, "asignal", hp, "asig")
        wire(hp, "aout", pre, "asig")
        formula(shape, "xin", "signal * ampdb(drive) + 0.15",
                signal=(pre, "aout"), drive=("tube_drive_db", "iout"))
        formula(dc, "asig", "shaped - 0.148885033623318", shaped=(shape, "aout"))
        wire(dc, "aout", tone, "asig")
        wire("tube_tone_hz", "iout", tone, "xfreq")
        node(output, "outleta", 2310, y, sname=side)
        formula(output, "asignal", "signal * gain",
                signal=(tone, "aout"), gain=("tube_gain", "aout"))

    # Keep the main stereo output pair last, as in other authored instruments.
    nodes.sort(key=lambda item: item["opcode"] == "outleta")
    return PatchDocument.model_validate(dict(
        id="tube-overdrive-v1", name="Tube Overdrive", always_on=True, instrument_type="continuous",
        description=("Warm stereo tube-style saturation: biased tanh, input filtering, DC removal and tone control. "
                     "Drive (0–24 dB), Tone (2–12 kHz), Output (−18 to +6 dB). "
                     "Restart the rack after changing performance controls. Fully wet; use as an insert. "
                     "0 dB Drive is not bypass. No oversampling or cabinet simulation."),
        graph=dict(
            nodes=nodes, connections=connections,
            engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                               software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
            ui_layout=dict(input_formulas=formulas, audio_blocks={"tube_input": True, "tube_output": True}),
            audio_interface=dict(role="effect", guided=False, mainInput="tube_input", mainOutput="tube_output",
                                 groups=[dict(id=f"tube_{direction}", name=f"Stereo {direction.title()}",
                                              direction=direction, layout="stereo", ports=["left", "right"], purpose="main")
                                         for direction in ("input", "output")]),
        ),
    ))


if __name__ == "__main__":
    patch = build_patch()
    CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(patch, "0", "none")
    folder = Path(__file__).resolve().parent
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (folder / "tube_overdrive.patch.json").write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    native = {"sourcePatchId": raw.pop("id"), **raw}
    for source, target in [("is_template", "isTemplate"), ("always_on", "alwaysOn"), ("instrument_type", "instrumentType")]:
        native[target] = native.pop(source)
    (folder.parent / "Tube_Overdrive.orch.instrument.json").write_text(json.dumps(native, indent=2, ensure_ascii=False) + "\n")
    print("Compiled and wrote Tube_Overdrive.orch.instrument.json and tube_overdrive.patch.json")
