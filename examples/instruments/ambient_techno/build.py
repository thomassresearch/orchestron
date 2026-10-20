"""Reproduce two sample-free Ambient Techno instruments using Patch Creator."""

import argparse
import json
from pathlib import Path
import sys
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))

from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    build_patch_payload, validate_graph_invariants,
)
from backend.app.models.export import ExportedPatchDefinition  # noqa: E402
from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.app.services.compiler_service import CompilerService  # noqa: E402
from backend.app.services.opcode_service import OpcodeService  # noqa: E402

# key, label, minimum, maximum, default, CC, mapping, effective maximum
SUB_CONTROLS = [
    ("body", "Body", 0, .5, .15, 24, "amount", .5),
    ("tone", "Tone (Hz)", 80, 2000, 280, 25, "frequency", 4000),
    ("warmth", "Warmth", 0, 1, .15, 26, "amount", 1),
    ("pulse_depth", "Pulse Depth", 0, .35, 0, 27, "amount", .35),
    ("pulse_rate", "Pulse Rate (Hz)", .02, 2, .15, 28, "frequency", 4),
]
CLOUD_CONTROLS = [
    ("position", "Wave Position", 0, 1, .3, 102, "amount", 1),
    ("scan", "Scan Depth", 0, .5, .15, 103, "amount", .5),
    ("motion", "Motion Rate (Hz)", .005, 1, .04, 104, "frequency", 2),
    ("drift", "Drift (cents)", 0, 8, 1.5, 105, "amount", 8),
    ("detune", "Detune (cents)", 0, 20, 5, 106, "amount", 20),
    ("width", "Stereo Width", 0, 1, .65, 107, "amount", 1),
    ("shimmer", "Shimmer", 0, .5, .1, 108, "amount", .5),
    ("tone", "Tone (Hz)", 200, 12000, 3500, 109, "frequency", 16000),
]
WAVES = [
    [1, 0, 0, 0, 0, 0, 0, 0],
    [1, .35, .15, .07, .03, .02, .01, 0],
    [1, 0, .55, 0, .22, 0, .1, 0],
    [.7, .2, .5, .15, .4, .1, .3, .08],
]


def clamp(expression, lo, hi):
    """Clamp with the graph formula language (no custom opcode required)."""
    return f"({lo} + {hi} + abs(({expression}) - {lo}) - abs(({expression}) - {hi})) / 2"


class Instrument:
    def __init__(self, cloud=False):
        self.cloud = cloud
        self.prefix = "awc" if cloud else "ars"
        name = "Ambient Wavetable Cloud" if cloud else "Ambient Rounded Sub"
        self.controls = CLOUD_CONTROLS if cloud else SUB_CONTROLS
        self.envelopes = (
            [("attack", .05, 12, 2), ("decay", .1, 12, 3), ("sustain", 0, 1, .85), ("release", .1, 20, 6)]
            if cloud else
            [("attack", .005, .25, .02), ("decay", .03, 2, .3), ("sustain", 0, 1, .85), ("release", .03, 3, .45)]
        )
        cc_text = ", ".join(f"CC{cc} {label}" for _, label, _, _, _, cc, _, _ in self.controls)
        self.payload = build_patch_payload({
            "name": name,
            "description": (
                ("Four-wave morphing synth with three detuned voices, slow scan/drift and an octave shimmer layer. "
                 "Suggested MIDI 36–84. Dry stereo output; add rack delay/reverb to taste. "
                 if cloud else
                 "Sine/triangle sub-bass with soft saturation, low-pass tone and optional amplitude pulse. "
                 "Suggested MIDI 24–55. Polyphonic, dry and centered. ")
                + "Velocity-sensitive. Performance controls apply to new notes; MIDI controls affect held notes and releases. "
                + f"Control channel defaults to 16 (independent of note channel). {cc_text}. "
                + "CC0 preserves the base setting; higher values add intensity, with 30 ms smoothing. "
                + "Use controller-sequencer Reset Value 0. Notes never reset CCs; instances sharing a control channel share automation. "
                + "Route Stereo Output through the mixer to Master."
            ),
            "family": "simple_osc",
            "layers": [{"id": "seed", "opcode": "oscili", "gain": .1}],
            "envelope": {key: default for key, _, _, default in self.envelopes},
            "output": {"pan": .5},
        })
        self.payload.update(
            id=str(uuid5(NAMESPACE_URL, "orchestron/ambient-techno/" + self.prefix)),
            instrument_type="melody" if cloud else "bass",
        )
        self.graph = self.payload["graph"]
        self.graph["engine_config"].update(sr=48000, ksmps=32, control_rate=1500)
        self.graph["nodes"] = [n for n in self.graph["nodes"] if not n["id"].startswith(("seed_", "env_"))]
        ids = {n["id"] for n in self.graph["nodes"]}
        self.graph["connections"] = [e for e in self.graph["connections"]
                                     if e["from_node_id"] in ids and e["to_node_id"] in ids]
        self.formulas = self.graph["ui_layout"].setdefault("input_formulas", {})
        self.control_count = 0
        for key, label, lo, hi, default, *_ in self.controls:
            self.control(key, label, lo, hi, default, "logarithmic" if lo > 0 else "linear")
        for key, lo, hi, default in self.envelopes:
            self.control(key, key.title() + ("" if key == "sustain" else " (s)"),
                         lo, hi, default, "linear" if key == "sustain" else "logarithmic")
            port = dict(attack="iatt", decay="idec", sustain="islev", release="irel")[key]
            self.formula("amp_madsr." + port, "setting", setting=self.ref(key, "iout"))
        self.control("output", "Output (dB)", -24, 0, -6)
        self.control("channel", "MIDI Control Channel", 1, 16, 16)
        for index, (key, _, _, _, _, cc, mapping, cap) in enumerate(self.controls):
            y = index * 260
            reader = self.node("cc_" + key, "ctrl7", 0, y, ictlno=cc, kmin=0, kmax=1)
            self.formula(reader + ".ichan", "floor(channel + .5)", channel=self.ref("channel", "iout"))
            smooth = self.node("smooth_" + key, "portk", 300, y, khtim=.03, isig=0)
            self.formula(smooth + ".ksig", clamp("cc", 0, 1), cc=reader + ".kout")
            effective = self.node("effective_" + key, "k_mul", 600, y, b=1)
            expression = (f"base + cc * ({cap} - base)" if mapping == "amount"
                          else clamp("base * ampdb(12.041199826559248 * cc)", 0, cap))
            self.formula(effective + ".a", expression, base=self.ref(key, "iout"), cc=smooth + ".kout")

    def ref(self, key, port="kout"):
        return self.prefix + "_" + key + "." + port

    def effective(self, key):
        return self.ref("effective_" + key)

    def node(self, key, opcode, x, y, **params):
        identity = self.prefix + "_" + key
        self.graph["nodes"].append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))
        return identity

    def control(self, key, label, lo, hi, default, scale="linear"):
        # Compact rows of controls above the signal path; stable IDs are instance keys.
        i = self.control_count
        self.node(key, "perf_controller", -1150 + (i % 4) * 285, -1200 + (i // 4) * 240,
                  label=label, min=lo, max=hi, default=default, scale=scale)
        self.control_count += 1

    def formula(self, target, expression, **sources):
        identity, port = target.split(".")
        edges = self.graph["connections"]
        edges[:] = [e for e in edges if (e["to_node_id"], e["to_port_id"]) != (identity, port)]
        bindings = []
        for token, source in sources.items():
            src, out = source.split(".")
            bindings.append(dict(token=token, from_node_id=src, from_port_id=out))
            edges.append(dict(from_node_id=src, from_port_id=out, to_node_id=identity, to_port_id=port))
        self.formulas[identity + "::" + port] = dict(expression=expression, inputs=bindings)
        next(n for n in self.graph["nodes"] if n["id"] == identity)["params"].pop(port, None)

    def table(self, key, harmonics, multiplier=1, x=1000, y=0):
        identity = self.node(key, "ftgenonce", x, y, ip1=0, ip2dummy=0, isize=16384, igen=10)
        for h, strength in enumerate(harmonics, 1):
            # Fixed safety margin includes maximum 28 cents of detune + drift.
            # Each coefficient has a finite binary mask, so ftgenonce reuses a
            # bounded set of tables across every pitch and instance.
            expression = str(strength) if h == 1 else (
                f"{strength} * ({clamp(f'floor(sr * .45 / ({h * multiplier} * 1.017 * hz))', 0, 1)})"
            )
            self.formula(identity + f".iarg{h}", expression,
                         **({"hz": "pitch_cpsmidi.kfreq"} if h != 1 else {}))
        return identity + ".ift"

    def oscillator(self, key, table, frequency, amplitude, phase, x, y):
        identity = self.node(key, "poscil3", x, y, iphs=phase)
        self.formula(identity + ".ifn", "table", table=table)
        self.formula(identity + ".freq", "hz", hz=frequency)
        self.formula(identity + ".amp", amplitude[0], **amplitude[1])
        return identity + ".asig"

    def finish(self):
        # The skill validates an explicit pan2 plus a final grouped Stereo Output.
        outlets = [n for n in self.graph["nodes"] if n["opcode"] == "outleta"]
        self.graph["nodes"] = [n for n in self.graph["nodes"] if n["opcode"] != "outleta"] + outlets
        validate_graph_invariants(self.graph)
        return PatchDocument.model_validate(self.payload)


def build_sub():
    b = Instrument()
    sine = b.table("sine_table", [1, 0, 0, 0, 0, 0, 0, 0])
    triangle = b.table("triangle_table", [1, 0, -1 / 9, 0, 1 / 25, 0, -1 / 49, 0], y=350)
    amp = ("amp", {"amp": "amp_velocity_envelope.kout"})
    b.oscillator("sine", sine, "pitch_cpsmidi.kfreq", amp, 0, 1400, 0)
    b.oscillator("triangle", triangle, "pitch_cpsmidi.kfreq", amp, 0, 1400, 350)
    body = b.node("body_audio", "k_to_a", 1400, 1000)
    b.formula(body + ".kin", "body", body=b.effective("body"))
    dry = b.node("dry", "a_mul", 1750, 1000, b=1)
    b.formula(dry + ".a", "sine * (1 - body) + triangle * body",
              sine=b.ref("sine", "asig"), triangle=b.ref("triangle", "asig"), body=body + ".aout")
    drive = b.node("drive", "k_mul", 1400, 700, b=1)
    b.formula(drive + ".a", "1 + 3 * warmth", warmth=b.effective("warmth"))
    saturator = b.node("saturator", "tanh", 1750, 100)
    b.formula(saturator + ".xin", "drive * audio", drive=drive + ".kout", audio=dry + ".aout")
    normalizer = b.node("normalizer", "tanh", 1750, 700)
    b.formula(normalizer + ".xin", "drive", drive=drive + ".kout")
    warmth = b.node("warmth_audio", "k_to_a", 2100, 1000)
    b.formula(warmth + ".kin", "warmth", warmth=b.effective("warmth"))
    tone = b.node("lowpass", "butterlp", 2100, 100)
    b.formula(tone + ".asig", "dry * (1 - warmth) + warmth * audio / norm",
              dry=dry + ".aout", warmth=warmth + ".aout",
              audio=saturator + ".aout", norm=normalizer + ".aout")
    b.formula(tone + ".xfreq", "tone", tone=b.effective("tone"))
    pulse = b.node("pulse", "lfo", 2100, 650, kamp=1, itype=0)
    b.formula(pulse + ".kcps", "rate", rate=b.effective("pulse_rate"))
    gain = b.node("gain", "k_to_a", 2450, 650)
    b.formula(gain + ".kin", ".12 * ampdb(output) * (1 - depth * (.5 + .5 * pulse))",
              output=b.ref("output", "iout"),
              depth=b.effective("pulse_depth"), pulse=pulse + ".kout")
    b.formula("output_pan2.asig", "audio * gain", audio=tone + ".aout", gain=gain + ".aout")
    return b.finish()


def build_cloud():
    b = Instrument(cloud=True)
    tables = [[b.table(f"table_{octave}_{i}", wave, multiplier=octave,
                       x=1000 + i * 280, y=2800 + (octave - 1) * 400)
               for i, wave in enumerate(WAVES)] for octave in (1, 2)]
    pans = []
    for voice, (octave, detune, phase, weight) in enumerate([
        (1, 0, 0, .5), (1, -1, .21, .25), (1, 1, .57, .25),
        (2, -1, .34, .5), (2, 1, .78, .5),
    ]):
        y = voice * 520
        slow = b.node(f"slow_{voice}", "lfo", 1050, y, kamp=1, itype=0)
        drift = b.node(f"drift_lfo_{voice}", "lfo", 1050, y + 210, kamp=1, itype=0)
        b.formula(slow + ".kcps", f"rate * {(.73, 1, 1.173, .53, 1.37)[voice]}",
                  rate=b.effective("motion"))
        b.formula(drift + ".kcps", f"rate * {(.317, .479, .613, .839, 1.071)[voice]}",
                  rate=b.effective("motion"))
        position = b.node(f"position_{voice}", "k_mul", 1350, y, b=1)
        b.formula(position + ".a", clamp("position + scan * (.7 * slow + .3 * drift)", 0, 1),
                  position=b.effective("position"), scan=b.effective("scan"),
                  slow=slow + ".kout", drift=drift + ".kout")
        pitch = b.node(f"pitch_{voice}", "k_mul", 1350, y + 210, b=1)
        b.formula(pitch + ".a", f"{octave} * hz * ampdb((detune * {detune} + drift * lfo) * .005017166594399686)",
                  hz="pitch_cpsmidi.kfreq", detune=b.effective("detune"),
                  drift=b.effective("drift"), lfo=drift + ".kout")
        oscillators = {}
        for i, table in enumerate(tables[octave - 1]):
            # Adjacent linear weights sum to one; aligned phases make this
            # equivalent to interpolating the waveform tables before playback.
            wave_weight = clamp(f"1 - abs(position * 3 - {i})", 0, 1)
            oscillators[f"wave{i}"] = b.oscillator(
                f"voice_{voice}_wave_{i}", table, pitch + ".kout",
                (f"amp * ({wave_weight})", {"amp": "amp_velocity_envelope.kout", "position": position + ".kout"}),
                phase, 1700 + i * 280, y,
            )
        tone = b.node(f"tone_{voice}", "butterlp", 2900, y)
        b.formula(tone + ".asig", "wave0 + wave1 + wave2 + wave3", **oscillators)
        b.formula(tone + ".xfreq", "tone", tone=b.effective("tone"))
        pan = "output_pan2" if voice == 0 else b.node(f"pan_{voice}", "pan2", 3250, y, imode=0)
        mix = "(1 - shimmer)" if octave == 1 else "shimmer"
        # Above the safe range the octave layer fades out while the base stays
        # playable. Its fundamental is retained in tables to avoid empty GEN10.
        guard = "1" if octave == 1 else f"({clamp('sr * .45 / (2 * 1.017 * hz) - 1', 0, 1)})"
        gain = b.node(f"gain_{voice}", "k_to_a", 2900, y + 210)
        b.formula(gain + ".kin", f".12 * {weight} * ampdb(output) * {mix} * {guard}",
                  output=b.ref("output", "iout"),
                  shimmer=b.effective("shimmer"), **({"hz": "pitch_cpsmidi.kfreq"} if octave == 2 else {}))
        b.formula(pan + ".asig", "audio * gain", audio=tone + ".aout", gain=gain + ".aout")
        b.formula(pan + ".xp", f".5 + {detune * .48} * width", width=b.effective("width"))
        pans.append(pan)
    for side, port in (("left", "aleft"), ("right", "aright")):
        # A dedicated sum ahead of each outlet avoids the known Csound outlet
        # formula/channel issue while retaining stereo routing.
        mix = b.node("mix_" + side, "a_mul", 3600, 600 if side == "left" else 1100, b=1)
        b.formula(mix + ".a", " + ".join(f"voice{i}" for i in range(5)),
                  **{f"voice{i}": pan + "." + port for i, pan in enumerate(pans)})
        b.formula("output_" + side + ".asignal", "audio", audio=mix + ".aout")
    return b.finish()


def build_all():
    return [build_sub(), build_cloud()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", action="store_true", help="Explicitly refresh independent test snapshots.")
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    for patch in build_all():
        CompilerService(OpcodeService("/static/icons")).compile_patch(patch, "0", "none")
        raw = patch.model_dump(mode="json", by_alias=True, exclude={"created_at", "updated_at"})
        name = patch.name.replace(" ", "_")
        (folder / f"{name}.patch.json").write_text(json.dumps(raw, indent=2) + "\n")
        native = ExportedPatchDefinition(sourcePatchId=patch.id, **patch.model_dump(exclude={"id"}))
        (folder.parent / f"{name}.orch.instrument.json").write_text(
            json.dumps(native.model_dump(mode="json", by_alias=True), indent=2) + "\n")
        if args.fixtures:
            (ROOT / "backend/tests/fixtures/patches" / f"{name.lower()}.patch.json").write_text(
                json.dumps(raw, indent=2) + "\n")
        print(f"Compiled {patch.name}: {len(patch.graph.nodes)} nodes")


if __name__ == "__main__":
    main()
