"""Reproduce the Stereo Auto Wah Wah graph and native instrument."""

import json
from pathlib import Path

from backend.app.models.export import ExportedPatchDefinition
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from examples.instruments.continuous_effects.build import Effect, OCTAVE_DB


def build():
    effect = Effect("Stereo Auto Wah Wah", "saw", [
        ("base", "Base cutoff (Hz)", 50, 2000, 200),
        ("range", "Sweep range (octaves)", 0, 6, 4),
        ("sensitivity", "Sensitivity", .25, 32, 8),
        ("integration", "RMS integration time (ms)", 1, 1000, 30),
        ("resonance", "Resonance", 0, .95, .65),
        ("quantization", "Quantization step (semitones)", 0, 24, 0),
        ("transition", "Transition half-time (ms)", 1, 100, 5),
        ("link", "Stereo Link", 0, 1, 1),
    ], "Stereo RMS-driven auto wah using two moogvcf filters. Stereo Link combines channel "
       "energy without phase cancellation; Off follows each channel independently. "
       "Quantization 0 is continuous; positive values set musical cutoff steps relative to "
       "Base cutoff. Transition half-time softens the jumps independently of RMS integration. "
       "Fully wet output; use mixer level and insert bypass. No MIDI notes or CCs required.")
    logarithmic = {"base", "sensitivity", "integration", "transition"}
    for index, node in enumerate(effect.nodes[:8]):
        key = node["id"].removeprefix("saw_")
        node["params"]["scale"] = "logarithmic" if key in logarithmic else "linear"
        node["params"]["controller_group"] = (
            "Filter" if key in {"base", "range", "resonance"} else
            "Envelope" if key in {"sensitivity", "integration", "link"} else "Cutoff steps")
        node["position"] = dict(x=(index % 4) * 360, y=-1000 + (index // 4) * 500)
        if key == "link":
            node["params"]["controller_type"] = "bool"

    def control(key, expression, x, y, **bindings):
        effect.node(key, "k_mul", x, y, b=1)
        effect.formula(key, "a", expression, **bindings)
        return key, "kout"

    for side, y in (("left", 200), ("right", 1100)):
        effect.node("rms_" + side, "rms", 350, y, iskip=0)
        effect.wire(("in_" + side, "asignal"), "rms_" + side, "asig")
        effect.formula("rms_" + side, "ihp", "1000 / (6.283185307179586 * time)",
                       time=("integration", "iout"))

    power = control("linked_power", "(left * left + right * right) / 2", 700, 650,
                    left=("rms_left", "krms"), right=("rms_right", "krms"))
    # The formula language has no sqrt. Adding 1e-24 protects dbamp at zero;
    # subtracting its square root preserves an exact zero envelope in silence.
    linked = control("linked_envelope",
                     "ampdb(dbamp(power + 0.000000000000000000000001) / 2) - 0.000000000001",
                     1050, 650, power=power)
    outputs = []
    for side, y in (("left", 200), ("right", 1100)):
        envelope = control("envelope_" + side,
                           "sensitivity * (link * linked + (1 - link) * own)", 1400, y,
                           sensitivity=("sensitivity", "iout"), link=("link", "iout"),
                           linked=linked, own=("rms_" + side, "krms"))
        offset = control("offset_" + side, "12 * span * (abs(env) - abs(env - 1) + 1) / 2",
                         1750, y, span=("range", "iout"), env=envelope)
        # ceil(q/24) is exactly 0 at q=0 and 1 throughout the positive range.
        # The denominator becomes 1 at zero, so bypass never divides by zero.
        quantized = control("quantized_" + side,
                            "(1 - ceil(q / 24)) * offset + "
                            "q * floor(offset / (q + 1 - ceil(q / 24)) + 0.5)",
                            2100, y, q=("quantization", "iout"), offset=offset)
        effect.node("smooth_" + side, "portk", 2450, y, isig=0)
        effect.formula("smooth_" + side, "ksig", "(step + 12 * span - abs(step - 12 * span)) / 2",
                       step=quantized, span=("range", "iout"))
        effect.formula("smooth_" + side, "khtim", "time / 1000", time=("transition", "iout"))
        effect.node("interpolate_" + side, "k_to_a", 2800, y)
        effect.wire(("smooth_" + side, "kout"), "interpolate_" + side, "kin")
        effect.node("filter_" + side, "moogvcf", 3150, y, iscale=1, iskip=0)
        effect.wire(("in_" + side, "asignal"), "filter_" + side, "asig")
        effect.wire(("resonance", "iout"), "filter_" + side, "xres")
        frequency = f"base * ampdb({OCTAVE_DB} * offset / 12)"
        ceiling = "((18000 + 0.4 * sr - abs(18000 - 0.4 * sr)) / 2)"
        effect.formula("filter_" + side, "xfco",
                       f"(abs({frequency} - 20) - abs({frequency} - {ceiling}) + {ceiling} + 20) / 2",
                       base=("base", "iout"), offset=("interpolate_" + side, "aout"))
        outputs.append(("filter_" + side, "aout"))
    patch = effect.finish(*outputs)
    for node in patch.graph.nodes:
        if node.opcode == "outleta":
            node.position.x = 3500
            node.position.y = 200 if node.params["sname"] == "left" else 1100
        elif node.id == "saw_in_right":
            node.position.y = 1100
    return patch


def main():
    patch = build()
    CompilerService(OpcodeService("/static/icons")).compile_patch(patch, "0", "none")
    folder = Path(__file__).resolve().parent
    raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
    (folder / "stereo_auto_wah_wah.patch.json").write_text(json.dumps(raw, indent=2) + "\n")
    native = ExportedPatchDefinition(sourcePatchId=patch.id, **patch.model_dump(exclude={"id"}))
    (folder.parent / "Stereo_Auto_Wah_Wah.orch.instrument.json").write_text(
        json.dumps(native.model_dump(mode="json", by_alias=True), indent=2) + "\n")
    print("Compiled and exported", patch.name)


if __name__ == "__main__":
    main()
