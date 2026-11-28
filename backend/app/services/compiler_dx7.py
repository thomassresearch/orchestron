"""Generate the DX7 UDO for stored voices or all routings during draft audition."""

from hashlib import sha256
import json
from pathlib import Path

from backend.app.models.dx7 import DX7, DX7_PRESETS, DX7_PREVIEW_KEYS, node_voice
from backend.app.services.compiler_fm6 import preview_channel
from backend.app.services.compiler_common import CompilationError

DATA = Path(__file__).resolve().parents[1] / "data"
ALGORITHMS = DX7["algorithms"]


def _voice_data(node):
    try:
        return node_voice(node.params)[:145]  # the final ten bytes are the display name
    except ValueError as exc:
        raise CompilationError([str(exc)]) from exc


def _voice_array(data):
    return "giDx7Voice_" + sha256(data).hexdigest()[:24]


def dx7_node_lines(node, env, preview, assignment, header):
    if preview:
        # chnget:i runs once per note. The engine applies each host update as a batch.
        array = "i" + env["aout"][1:] + "_dx7"
        reads = []
        for key in DX7_PREVIEW_KEYS:
            channel = preview_channel(assignment, node.id, key)
            header.append(f'chnset {preview[key]}, "{channel}"')
            reads.append(f'chnget:i("{channel}")')
        lines = [f"{array}[] fillarray " + ", ".join(reads)]
    else:
        array = _voice_array(_voice_data(node))
        lines = []
    args = (env["ikey"], env["ivelocity"], env["kbend"], env["igain"], array, env["ipreset"])
    return [*lines, f"{env['aout']} fm_dx7 " + ", ".join(args)]


def _feedback_loop(count):
    pairs = [v for i in range(count) for v in (f"aPhase{i}", f"aAmp{i}")]
    lines = [
        f"opcode vcs_dx7_fb{count}, a, i{'aa' * count}",
        "setksmps 1",
        "iScale, " + ", ".join(pairs) + " xin",
        "kPrev init 0",
        "kOlder init 0",
        "kMod = (kPrev + kOlder) * iScale * 0.5",
    ]
    for i in range(count):
        lines += [
            f"kPhase{i} downsamp aPhase{i}",
            f"kAmp{i} downsamp aAmp{i}",
            f"kMod = sin(2 * $M_PI * (kPhase{i} + kMod)) * kAmp{i}",
        ]
    return "\n".join([*lines, "kOlder = kPrev", "kPrev = kMod", "aOut = kMod", "xout aOut", "endop"])


def _route(algorithm):
    route = ALGORITHMS[algorithm - 1]
    loop_end, feedback = route["feedback"]
    count = feedback - loop_end + 1
    lines = []
    for op in range(6, 0, -1):
        if loop_end <= op <= feedback:
            if op == loop_end:
                args = ", ".join(f"aPhase{i}, aAmp{i}" for i in range(feedback, loop_end - 1, -1))
                scale = "iFeedback / 4" if algorithm in (4, 6, 32) else "iFeedback"
                lines.append("if iFeedback == 0 then")
                phase = f"aPhase{feedback}"
                for i in range(feedback, loop_end - 1, -1):
                    lines.append(f"aOp{i} = sin(2 * $M_PI * ({phase})) * aAmp{i}")
                    phase = f"aPhase{i - 1} + aOp{i}"
                lines += ["else", f"aOp{op} vcs_dx7_fb{count} {scale}, {args}", "endif"]
            continue
        phase = " + ".join([f"aPhase{op}", *(f"aOp{source}" for source, dest in route["edges"] if dest == op)])
        lines.append(f"aOp{op} = sin(2 * $M_PI * ({phase})) * aAmp{op}")
    return [*lines, "aMix = " + " + ".join(f"aOp{i}" for i in route["outputs"])]


def dx7_header(targets):
    voices = set()
    audition = False
    for target in targets:
        for node in target.patch.graph.nodes:
            if node.opcode == "fm_dx7":
                if (
                    target.always_on
                    or target.patch.always_on
                    or any(n.opcode == "midi_legato" for n in target.patch.graph.nodes)
                ):
                    raise CompilationError(["fm_dx7 requires a polyphonic note instrument."])
                voices.add(_voice_data(node))
                audition |= node.id in target.fm6_preview
    if not voices:
        return []
    voices.update(DX7_PRESETS.values())
    algorithms = range(1, 33) if audition else sorted({voice[134] + 1 for voice in voices})
    curves = json.loads((DATA / "dx7_curves.json").read_text())
    lines = [
        "/* MSFA calibration and numeric curves, adapted for Csound.\n"
        + (DATA / "dx7-apache-license.txt").read_text()
        + "*/"
    ]
    lines += [f"giDx7_{name}[] fillarray " + ", ".join(map(str, values)) for name, values in curves.items()]
    lines += [f"{_voice_array(v)}[] fillarray " + ", ".join(map(str, v)) for v in sorted(voices)]
    lines.append(f"giDx7Presets[][] init {len(DX7_PRESETS)}, {len(DX7_PREVIEW_KEYS)}")
    for slot, voice in DX7_PRESETS.items():
        lines.append(f"giDx7Presets setrow {_voice_array(voice)}, {slot - 1}")
    feedback_routes = (ALGORITHMS[a - 1]["feedback"] for a in algorithms)
    loop_lengths = {end - start + 1 for start, end in feedback_routes}
    lines += [_feedback_loop(n) for n in sorted(loop_lengths)]
    lines += [(DATA / "fm_dx7.orc").read_text()]
    for op in range(6, 0, -1):
        lines.append(
            f"aPhase{op}, aAmp{op}, iTail{op} vcs_dx7_operator iVoice, {(6 - op) * 21}, iKey, iVelocity, kPitch, kBend, kAM, kGate, iStart"
        )
    for index, algorithm in enumerate(algorithms):
        lines.append(f"{'if' if index == 0 else 'elseif'} iAlgorithm == {algorithm} then")
        lines += _route(algorithm)
        carriers = ALGORITHMS[algorithm - 1]["outputs"]
        lines.append("iTail = max(" + ", ".join(["0.005", *(f"iTail{i}" for i in carriers)]) + ")")
    lines += [
        "endif",
        "xtratim iTail",
        "aFade linsegr 1, 0.001, 1, iTail, 0",
        # Only taper the last few milliseconds, including patches with nonzero L4.
        "xout aMix * iGain * limit(aFade * iTail * 200, 0, 1)",
        "endop",
    ]
    return ["\n".join(lines)]
