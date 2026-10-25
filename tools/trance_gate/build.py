"""Reproduce Trance Gate's editable graph and native export without library writes.

Run from the repository root: .venv/bin/python tools/trance_gate/build.py
Tests use separately versioned snapshots, never this builder or its outputs.
"""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# These imports follow the path bootstrap so this script also works directly.
from backend.app.models.export import ExportedPatchDefinition  # noqa: E402
from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.app.services.compiler_service import CompilerService  # noqa: E402
from backend.app.services.opcode_service import OpcodeService  # noqa: E402

PATCH_ID = "46336034-3d43-4b9d-af44-ce2715ed747b"
DESCRIPTION = (
    "Continuous stereo Trance Gate. CH16 CC24 sets amplitude to CC/127. "
    "CH16 CC29: 127 starts a triangle LFO at Start frequency; 0 sweeps back and stops. "
    "Repeated 127 holds; other values leave the switch unchanged. On retrigger, frequency "
    "and phase restart. Sweep time is the full linear start-to-end duration; early release "
    "returns proportionally sooner. The 0–1 triangle starts at zero rising and opens above "
    "Threshold. Either CC24 or the LFO can open the gate. Shared Attack/Release half-times "
    "(defaults 5/10 ms) smooth the combined gain. Starts closed and never resets shared CC "
    "state. Use as a serial mixer insert with CH16 controller Step lanes and Reset Value 0. "
    "Leave CC24 at 0 for LFO-only gating. Restart the rack after changing performance controls."
    " Stereo (0–1, default 0) scales channel balance: the current triangle while the LFO "
    "runs (including return), otherwise a held noise sample on each CC24 zero-to-positive "
    "opening. Repeated positive CC24 values hold the position. Pan holds through release."
)


def build_patch() -> PatchDocument:
    nodes, connections, formulas = [], [], {}

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def wire(source, port, target, inlet):
        connections.append(dict(from_node_id=source, from_port_id=port,
                                to_node_id=target, to_port_id=inlet))

    settings = [
        ("tg_attack", "Attack half-time (ms)", 1, 500, 5, "logarithmic"),
        ("tg_release", "Release half-time (ms)", 1, 1000, 10, "logarithmic"),
        ("tg_lfo_start", "Start frequency (Hz)", .1, 40, 2, "logarithmic"),
        ("tg_lfo_end", "End frequency (Hz)", .1, 40, 16, "logarithmic"),
        ("tg_lfo_time", "Sweep time (s)", .01, 60, 4, "logarithmic"),
        ("tg_lfo_threshold", "Threshold", 0, 1, .5, "linear"),
        ("tg_stereo", "Stereo", 0, 1, 0, "linear"),
    ]
    for index, (identity, label, minimum, maximum, default, scale) in enumerate(settings):
        node(identity, "perf_controller", (index % 4) * 360, -1000 + (index // 4) * 350,
             label=label, min=minimum, max=maximum, default=default, scale=scale)
    node("tg_cc", "ctrl7", 0, 0, ichan=16, ictlno=24, kmin=0, kmax=1, ifn=0)
    node("tg_target_audio", "upsamp", 360, 0)
    wire("tg_cc", "kout", "tg_target_audio", "ksig")
    node("tg_stereo_audio", "upsamp", 1080, 350)
    wire("tg_stereo", "iout", "tg_stereo_audio", "ksig")
    node("tg_lfo_cc", "ctrl7", 0, 350, ichan=16, ictlno=29, kmin=0, kmax=127, ifn=0)
    node("tg_lfo", "swept_gate", 720, 350)
    wire("tg_lfo_cc", "kout", "tg_lfo", "kcommand")
    wire("tg_cc", "kout", "tg_lfo", "kmanual")
    for identity, inlet in [("tg_lfo_start", "istart"), ("tg_lfo_end", "iend"),
                            ("tg_lfo_time", "itime"), ("tg_lfo_threshold", "ithreshold")]:
        wire(identity, "iout", "tg_lfo", inlet)
    node("tg_envelope", "follow2", 1080, 0)
    wire("tg_target_audio", "aout", "tg_envelope", "asig")
    wire("tg_lfo", "agate", "tg_envelope", "asig")
    formulas["tg_envelope::asig"] = dict(
        expression="(manual + lfo + abs(manual - lfo)) * 0.5",
        inputs=[dict(token="manual", from_node_id="tg_target_audio", from_port_id="aout"),
                dict(token="lfo", from_node_id="tg_lfo", from_port_id="agate")])
    for identity, port in [("tg_attack", "katt"), ("tg_release", "krel")]:
        wire(identity, "iout", "tg_envelope", port)
        formulas["tg_envelope::" + port] = dict(
            expression="milliseconds * 0.009965784284662087",
            inputs=[dict(token="milliseconds", from_node_id=identity, from_port_id="iout")])
    for side, y in [("left", 850), ("right", 1150)]:
        node("tg_in_" + side, "inleta", 0, y, sname=side)
        node("tg_gain_" + side, "a_mul", 1440, y)
        wire("tg_in_" + side, "asignal", "tg_gain_" + side, "a")
        wire("tg_envelope", "aout", "tg_gain_" + side, "b")
        node("tg_pan_" + side, "a_mul", 1800, y)
        wire("tg_gain_" + side, "aout", "tg_pan_" + side, "a")
        wire("tg_lfo", "apan", "tg_pan_" + side, "b")
        wire("tg_stereo_audio", "aout", "tg_pan_" + side, "b")
        formulas["tg_pan_" + side + "::b"] = dict(
            expression="1 - depth * " + ("pan" if side == "left" else "(1 - pan)"),
            inputs=[dict(token="pan", from_node_id="tg_lfo", from_port_id="apan"),
                    dict(token="depth", from_node_id="tg_stereo_audio", from_port_id="aout")])
    for side, y in [("left", 850), ("right", 1150)]:
        node("tg_out_" + side, "outleta", 2160, y, sname=side)
        wire("tg_pan_" + side, "aout", "tg_out_" + side, "asignal")
    return PatchDocument.model_validate(dict(
        id=PATCH_ID, name="Trance Gate", description=DESCRIPTION, is_template=False,
        always_on=True, instrument_type="continuous", schema_version=1,
        graph=dict(nodes=nodes, connections=connections, control_flow={},
                   ui_layout=dict(input_formulas=formulas, audio_blocks=dict(tg_input=True, tg_output=True)),
                   engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                                      software_buffer=128, hardware_buffer=512, **{"0dbfs": 1}),
                   audio_interface=dict(role="effect", groups=[
                       dict(id="tg_input", name="Stereo Input", direction="input", layout="stereo",
                            ports=["left", "right"], purpose="main"),
                       dict(id="tg_output", name="Stereo Output", direction="output", layout="stereo",
                            ports=["left", "right"], purpose="main")],
                       mainInput="tg_input", mainOutput="tg_output", guided=False))))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "examples/instruments/trance-gate")
    args = parser.parse_args()
    patch = build_patch()
    CompilerService(OpcodeService("/static/icons")).compile_patch(patch, "0", "none")
    payload = patch.model_dump(mode="json", by_alias=True, exclude={"id", "created_at", "updated_at"})
    native = ExportedPatchDefinition(sourcePatchId=PATCH_ID, **payload).model_dump(mode="json", by_alias=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for path, data in [(args.out_dir / "trance_gate.patch.json", payload),
                       (args.out_dir / "trance_gate.graph.json", payload["graph"]),
                       (args.out_dir / "Trance_Gate.orch.instrument.json", native)]:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    (ROOT / "examples/instruments/Trance_Gate.orch.instrument.json").write_text(
        json.dumps(native, indent=2, ensure_ascii=False) + "\n")
    print(f"Compiled and wrote Trance Gate to {args.out_dir}")


if __name__ == "__main__":
    main()
