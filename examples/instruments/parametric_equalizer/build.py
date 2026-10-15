"""Extend the backed-up library EQ; compile and export without changing the library."""

import json
from pathlib import Path

from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


FOLDER = Path(__file__).resolve().parent
# Preserve the three existing controller/filter/frequency identities. Old amplitude
# overrides must be converted to dB when updating an existing library (see README).
BANDS = [
    (63, "63 Hz", "d4c20b81-8b7c-4312-91b6-8997156f2ca2",
     "39b6e5d1-96fc-4e39-be41-06f8b4aae181",
     "fa196f1a-efcc-4469-a21e-d5e0f0881b1b", "7cb2ae93-0239-48dd-ac83-f712e43945c6"),
    (160, "160 Hz", "eq_160_gain_db", "eq_160_hz", "eq_160_left", "eq_160_right"),
    (400, "400 Hz", "cded9f16-e830-42d7-964f-d9bce78a3cd8",
     "2ddcb719-d475-4827-9c7d-ed00ef84f444",
     "05383763-9072-456a-a494-14b651938d3f", "45af38c6-fd45-46f3-a525-bf0654bc16f5"),
    (1000, "1 kHz", "377a004c-dd56-4042-b647-29f60bc7880a",
     "f4220aa9-d2f0-47ac-a311-83a91729a713",
     "3a4409dd-bec4-4dd9-ae8e-f48a0ba75567", "7d5b71b2-e423-4c3c-98f8-cc7d60fba496"),
    (2500, "2.5 kHz", "eq_2500_gain_db", "eq_2500_hz", "eq_2500_left", "eq_2500_right"),
    (6300, "6.3 kHz", "eq_6300_gain_db", "eq_6300_hz", "eq_6300_left", "eq_6300_right"),
    (16000, "16 kHz", "eq_16000_gain_db", "eq_16000_hz", "eq_16000_left", "eq_16000_right"),
]


def build_patch():
    original = json.loads((FOLDER / "original_3_band.patch.json").read_text())
    nodes, connections, formulas = [], [], {}

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def wire(source, port, target, inlet):
        connections.append(dict(from_node_id=source, from_port_id=port, to_node_id=target, to_port_id=inlet))

    previous = {side: (f"input-{side}", "asignal") for side in ("left", "right")}
    for index, (hz, label, control, frequency, left, right) in enumerate(BANDS):
        x = index * 340
        node(control, "perf_controller", x, 0, min=-20, max=20, default=0,
             scale="linear", label=f"{label} (dB)")
        node(frequency, "const_i", x, 185, value=hz)
        for side, identity, y in [("left", left, -400), ("right", right, 350)]:
            node(identity, "pareq", x, y, kc=hz, kv=1, kq=1.05, imode=0, iskip=0)
            wire(*previous[side], identity, "asig")
            wire(frequency, "iout", identity, "kc")
            for port, expression in [("kv", "ampdb(db)"), ("kq", "1.05 * ampdb(db / 2)")]:
                wire(control, "iout", identity, port)
                formulas[f"{identity}::{port}"] = dict(
                    expression=expression,
                    inputs=[dict(token="db", from_node_id=control, from_port_id="iout")],
                )
            # pareq's denominator Q needs sqrt(linear gain) compensation to
            # implement the symmetric, constant-Q peaking convention (RBJ).
            previous[side] = identity, "ares"

    for side, y in [("left", -180), ("right", 0)]:
        node(f"input-{side}", "inleta", -390, y, sname=side)
        node(f"output-{side}", "outleta", 2420, y, sname=side)
        wire(*previous[side], f"output-{side}", "asignal")

    original["description"] = (
        "Seven-band stereo parametric equalizer: 63, 160, 400 Hz, 1, 2.5, 6.3 and 16 kHz. "
        "Linear gain controls: -20 to +20 dB, default 0 dB; ampdb converts to amplitude. "
        "Cascaded peaking filters, nominal Q 1.05 with gain compensation for symmetric boost/cut. "
        "Unity at neutral. Continuous insert: restart the rack after changing controls. "
        "Allow mixer headroom when boosting."
    )
    original["graph"].update(nodes=nodes, connections=connections,
                             ui_layout=dict(input_formulas=formulas,
                                            audio_blocks={"main-input": True, "main-output": True}))
    return PatchDocument.model_validate(original)


if __name__ == "__main__":
    patch = build_patch()
    CompilerService(OpcodeService("/static/icons")).compile_patch(patch, "0", "none")
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (FOLDER / "parametric_equalizer.patch.json").write_text(json.dumps(raw, indent=2) + "\n")
    native = ExportedPatchDefinition(sourcePatchId=patch.id, **patch.model_dump(exclude={"id"}))
    (FOLDER.parent / "Parametric_Equalizer.orch.instrument.json").write_text(
        json.dumps(native.model_dump(mode="json", by_alias=True), indent=2) + "\n")
    print("Compiled and wrote seven-band Parametric Equalizer raw/native exports")
