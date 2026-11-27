"""Generate the portable DX7 UDO, including only algorithms used by the orchestra."""

from hashlib import sha256
import json
from pathlib import Path

from backend.app.models.dx7 import node_voice
from backend.app.services.compiler_common import CompilationError

DATA = Path(__file__).resolve().parents[1] / "data"
MULTI_OPERATOR_LOOPS = {4: 3, 6: 2}

# Each row describes incoming modulators for OP6..OP1, carriers, and feedback input.
# Loops in algorithms 4 and 6 return from OP4 and OP5 respectively.
ROUTES = (
    ("- 6 5 4 - 2", "31", 6),  # 1
    ("- 6 5 4 - 2", "31", 2),  # 2
    ("- 6 5 - 3 2", "41", 6),  # 3
    ("- 6 5 - 3 2", "41", 6),  # 4
    ("- 6 - 4 - 2", "531", 6),  # 5
    ("- 6 - 4 - 2", "531", 6),  # 6
    ("- 6 - 54 - 2", "31", 6),  # 7
    ("- 6 - 54 - 2", "31", 4),  # 8
    ("- 6 - 54 - 2", "31", 2),  # 9
    ("- - 65 - 3 2", "41", 3),  # 10
    ("- - 65 - 3 2", "41", 6),  # 11
    ("- - - 654 - 2", "31", 2),  # 12
    ("- - - 654 - 2", "31", 6),  # 13
    ("- - 65 4 - 2", "31", 6),  # 14
    ("- - 65 4 - 2", "31", 2),  # 15
    ("- 6 - 4 - 532", "1", 6),  # 16
    ("- 6 - 4 - 532", "1", 2),  # 17
    ("- 6 5 - - 432", "1", 3),  # 18
    ("- 6 6 - 3 2", "541", 6),  # 19
    ("- - 65 - 3 3", "421", 3),  # 20
    ("- 6 6 - 3 3", "5421", 3),  # 21
    ("- 6 6 6 - 2", "5431", 6),  # 22
    ("- 6 6 - 3 -", "5421", 6),  # 23
    ("- 6 6 6 - -", "54321", 6),  # 24
    ("- 6 6 - - -", "54321", 6),  # 25
    ("- - 65 - 3 -", "421", 6),  # 26
    ("- - 65 - 3 -", "421", 3),  # 27
    ("- - 5 4 - 2", "631", 5),  # 28
    ("- 6 - 4 - -", "5321", 6),  # 29
    ("- - 5 4 - -", "6321", 5),  # 30
    ("- 6 - - - -", "54321", 6),  # 31
    ("- - - - - -", "654321", 6),  # 32
)


def _voice_data(node):
    try:
        return node_voice(node.params)[:145]  # the final ten bytes are the display name
    except ValueError as exc:
        raise CompilationError([str(exc)]) from exc


def _voice_array(data):
    return "giDx7Voice_" + sha256(data).hexdigest()[:24]


def dx7_node_lines(node, env):
    array = _voice_array(_voice_data(node))
    return [f"{env['aout']} fm_dx7 {env['ikey']}, {env['ivelocity']}, {env['kbend']}, {env['igain']}, {array}"]


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
    sources, outputs, feedback = ROUTES[algorithm - 1]
    count = MULTI_OPERATOR_LOOPS.get(algorithm, 1)
    loop_end = feedback - count + 1
    lines = []
    for op, inputs in zip(range(6, 0, -1), sources.split(), strict=True):
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
        phase = " + ".join([f"aPhase{op}", *(f"aOp{i}" for i in inputs if i != "-")])
        lines.append(f"aOp{op} = sin(2 * $M_PI * ({phase})) * aAmp{op}")
    return [*lines, "aMix = " + " + ".join(f"aOp{i}" for i in outputs)]


def dx7_header(targets):
    voices = set()
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
    if not voices:
        return []
    algorithms = sorted({voice[134] + 1 for voice in voices})
    curves = json.loads((DATA / "dx7_curves.json").read_text())
    lines = [
        "/* MSFA calibration and numeric curves, adapted for Csound.\n"
        + (DATA / "dx7-apache-license.txt").read_text()
        + "*/"
    ]
    lines += [f"giDx7_{name}[] fillarray " + ", ".join(map(str, values)) for name, values in curves.items()]
    lines += [f"{_voice_array(v)}[] fillarray " + ", ".join(map(str, v)) for v in sorted(voices)]
    loop_lengths = {MULTI_OPERATOR_LOOPS.get(a, 1) for a in algorithms}
    lines += [_feedback_loop(n) for n in sorted(loop_lengths)]
    lines += [(DATA / "fm_dx7.orc").read_text()]
    for op in range(6, 0, -1):
        lines.append(
            f"aPhase{op}, aAmp{op}, iTail{op} vcs_dx7_operator iVoice, {(6 - op) * 21}, iKey, iVelocity, kPitch, kBend, kAM, kGate, iStart"
        )
    for index, algorithm in enumerate(algorithms):
        lines.append(f"{'if' if index == 0 else 'elseif'} iAlgorithm == {algorithm} then")
        lines += _route(algorithm)
        carriers = ROUTES[algorithm - 1][1]
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
