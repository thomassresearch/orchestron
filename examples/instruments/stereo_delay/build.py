"""Build Stereo Delay's editable graph and native export, without changing the library."""

import json
from pathlib import Path

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

    for index, (identity, label, minimum, maximum, default) in enumerate([
        ("tempo", "Tempo (BPM)", 40, 180, 120),
        ("beats", "Beats", 1, 16, 4),
        ("feedback", "Feedback", 0, 0.9, 0.5),
        ("stereo", "Stereo", 0, 1, 0.5),
    ]):
        node(f"sd_{identity}", "perf_controller", index * 360, -350,
             label=label, min=minimum, max=maximum, default=default, scale="linear")

    # Audio-only sockets require explicit promotion, including formula bindings.
    for identity, x in [("feedback", 720), ("stereo", 1440)]:
        node(f"sd_{identity}_audio", "upsamp", x, -40)
        wire(f"sd_{identity}", "iout", f"sd_{identity}_audio", "ksig")

    interval = "floor(sr * 60 * beats / tempo + 0.5) / sr"
    timing = dict(beats=("sd_beats", "iout"), tempo=("sd_tempo", "iout"))
    gain = ("sd_feedback_audio", "aout")
    width = ("sd_stereo_audio", "aout")

    for side, y in [("left", 270), ("right", 700)]:
        source, seed, even, odd, mix, output = [f"sd_{step}_{side}" for step in
                                                ("in", "seed", "even", "odd", "mix", "out")]
        node(source, "inleta", 0, y, sname=side)
        node(seed, "delay", 360, y, iskip=0)
        formula(seed, "idlt", "1 / sr")
        node(even, "flanger", 720, y)
        node(odd, "delay", 1080, y, iskip=0)
        node(mix, "mix2", 1440, y)
        node(output, "outleta", 1800, y, sname=side)
        wire(source, "asignal", seed, "asig")
        wire(seed, "aout", even, "asig")
        # flanger adds one sample inside its feedback loop. Compensate its delay
        # and seed the input one sample later so ALL echoes fall on n * interval.
        formula(even, "adel", f"2 * ({interval}) - 1 / sr", **timing)
        formula(even, "imaxd", f"2 * ({interval}) + 64 / sr", **timing)
        formula(even, "kfeedback", "feedback * feedback", feedback=("sd_feedback", "iout"))
        formula(odd, "asig", "(dry + even * gain * gain) * gain",
                dry=(source, "asignal"), even=(even, "aout"), gain=gain)
        formula(odd, "idlt", interval, **timing)
        wire(source, "asignal", mix, "a")
        # The stereo-preserving branch and the alternating mono-average branch
        # share the same echo streams, so overlapping input retains echo parity.
        if side == "left":
            formula(mix, "b", "(1 - width) * (odd + gain * gain * even) + width * (odd + other) / 2",
                    odd=(odd, "aout"), even=(even, "aout"), other=("sd_odd_right", "aout"),
                    gain=gain, width=width)
        else:
            formula(mix, "b", "(1 - width) * (odd + gain * gain * even) + width * gain * gain * (even + other) / 2",
                    odd=(odd, "aout"), even=(even, "aout"), other=("sd_even_left", "aout"),
                    gain=gain, width=width)
        wire(mix, "aout", output, "asignal")

    nodes.sort(key=lambda item: item["opcode"] == "outleta")
    return PatchDocument.model_validate(dict(
        id="stereo-delay-v1", name="Stereo Delay", always_on=True, instrument_type="continuous",
        description=("Tempo-synced stereo delay with unity dry signal. Tempo (40–180 BPM, default 120), "
                     "Beats (1–16, default 4): echo interval = 60 * Beats / Tempo seconds. "
                     "Feedback (0–0.9, default 0.5) scales every echo; zero is dry only. "
                     "Stereo (0–1, default 0.5) blends preserved stereo with alternating mono-average echoes, "
                     "first left, then right. Use as an insert. Set tempo manually; restart the rack after "
                     "changing controls. Dry plus echoes can exceed full scale."),
        graph=dict(
            nodes=nodes, connections=connections,
            engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                               software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
            ui_layout=dict(input_formulas=formulas, audio_blocks={"sd_input": True, "sd_output": True}),
            audio_interface=dict(role="effect", guided=False, mainInput="sd_input", mainOutput="sd_output",
                                 groups=[dict(id=f"sd_{direction}", name=f"Stereo {direction.title()}",
                                              direction=direction, layout="stereo", ports=["left", "right"], purpose="main")
                                         for direction in ("input", "output")]),
        ),
    ))


if __name__ == "__main__":
    patch = build_patch()
    CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(patch, "0", "none")
    folder = Path(__file__).resolve().parent
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (folder / "stereo_delay.patch.json").write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    native = {"sourcePatchId": raw.pop("id"), **raw}
    for source, target in [("is_template", "isTemplate"), ("always_on", "alwaysOn"), ("instrument_type", "instrumentType")]:
        native[target] = native.pop(source)
    (folder.parent / "Stereo_Delay.orch.instrument.json").write_text(json.dumps(native, indent=2, ensure_ascii=False) + "\n")
    print("Compiled and wrote Stereo_Delay.orch.instrument.json and stereo_delay.patch.json")
