"""Generate the DX7 UDO for stored voices or all routings during draft audition."""

from hashlib import sha256
import json
from pathlib import Path

from backend.app.models.dx7 import DX7, DX7_PRESETS, DX7_PREVIEW_KEYS, node_voice, read_sysex
from backend.app.models.opcode import SignalType
from backend.app.services.compiler_formula import formula_target_key, lookup_input_formula_config
from backend.app.services.compiler_fm6 import preview_channel
from backend.app.services.compiler_common import CompilationError

DATA = Path(__file__).resolve().parents[1] / "data"
ALGORITHMS = DX7["algorithms"]
# OPS COM ROM, in eighths of a base-two logarithm, indexed by carrier count - 1.
_CARRIER_ATTENUATION = (0, 8, 13, 16, 19, 21)
DX7_LIVE_VOICES = 16


def _voice_data(node):
    try:
        return node_voice(node.params)[:145]  # the final ten bytes are the display name
    except ValueError as exc:
        raise CompilationError([str(exc)]) from exc


def _voice_array(data):
    return "giDx7Voice_" + sha256(data).hexdigest()[:24]


def can_retire_dx7_instrument(context, layout):
    """Only end the parent early when every audio path follows the DX7 envelopes."""
    for compiled in context.compiled_nodes.values():
        spec, node = compiled.spec, compiled.node
        if spec.name == "fm_dx7":
            continue
        if any(p.signal_type == SignalType.AUDIO for p in spec.outputs) and spec.name not in {"pan2", "If", "Switch"}:
            return False  # Another generator or a processor with its own tail.
        for port in spec.inputs:
            if port.signal_type != SignalType.AUDIO:
                continue
            if lookup_input_formula_config(layout, formula_target_key(node.id, port.id)):
                return False
            inputs = context.inbound_index.get((node.id, port.id), [])
            if not inputs and node.params.get(port.id, port.default) not in (None, 0, "0"):
                return False
            for link in inputs:
                source = context.compiled_nodes[link.from_node_id].spec
                if not any(p.id == link.from_port_id and p.signal_type == SignalType.AUDIO for p in source.outputs):
                    return False
    return True


def dx7_lifetime_lines(instrument_number, limit, retire_when_silent, outlets, header):
    done = "(k_vcs_dx7_sounding == 0 ? 1 : 0)" if retire_when_silent else "0"
    lines = [f"k_vcs_dx7_done = {done}"]
    stop = "k_vcs_dx7_done"
    if limit is not None:
        header.append((DATA / "dx7_allocation.orc").read_text().replace("SCOPE", str(instrument_number)))
        lines.append("k_vcs_dx7_level = 0")
        for index, signal in enumerate(outlets):
            meter = f"k_vcs_dx7_rms_{index}"
            lines.extend([f"{meter} rms {signal}, 25", f"k_vcs_dx7_level = max(k_vcs_dx7_level, {meter})"])
        stop = "k_vcs_dx7_stop"
        lines.append(f"a_vcs_dx7_fade, {stop} vcs_dx7_allocation_{instrument_number} "
                     f"int({limit}), k_vcs_dx7_level, k_vcs_dx7_done")
        lines.extend(f"{out} = {signal} * a_vcs_dx7_fade" for signal, out in outlets.items())

    # Csound 6 turnoff honors xtratim and ignores an already-releasing voice.
    # Orchestron dispatches integer instrument references. Tag only this finished
    # instance for exact removal within the same pass, before publishing outlets.
    return [*lines, f"if {stop} == 1 then", " reinit VCS_DX7_FINISHED", " turnoff2 p1, 4, 0", "endif",
            "igoto VCS_DX7_END", "kgoto VCS_DX7_END", "VCS_DX7_FINISHED:", "p1 = int(p1) + 0.5",
            "rireturn", "VCS_DX7_END:"]


def dx7_node_lines(node, env, preview, assignment, header, banks, controllers):
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
    prefix = "i" + env["aout"][1:]
    program = None
    for controller in (controllers or {}).values():
        role = controller.get("dx7_role")
        if not role:
            continue
        channel = controller["channel"]
        header.append(f'chnset {controller["value"]:.17g}, "{channel}"')
        lines.append(f'{prefix}_{role} chnget "{channel}"')
        if role == "program":
            program = prefix + "_program"

    if program is not None:
        selected = prefix + "_voice"
        index = prefix + "_index"
        lines.extend([f"if {program} > 0 then", f" {index} = limit(round({program}), 1, 32) - 1"])
        for slot, bank in sorted((banks or {}).items()):
            lines.extend([f" if {prefix}_bank == {slot} then",
                          f"  {index} += giDx7Offset_{bank.digest}", " endif"])
        lines.extend([f" {selected}[] getrow giDx7Presets, {index}", "else", f" {selected}[] = {array}", "endif"])
        array = selected
    args = (env["ikey"], env["ivelocity"], env["kbend"], env["igain"], array, env["imaxrelease"])
    return [*lines, f"{env['aout']}, k_{env['aout']}_done fm_dx7 " + ", ".join(args)]


def _feedback_loop(count):
    """Generate the sample-by-sample loop with note-local signed feedback history."""
    pairs = [v for i in range(count) for v in (f"aPhase{i}", f"aAtten{i}")]
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
            f"kPhase downsamp aPhase{i}",
            f"kAtten downsamp aAtten{i}",
            "kAddress = floor((kPhase + kMod) * 4096) & 4095",
            "kLoss = giDx7LogSine[kAddress & 2047] + kAtten",
            "kMag = giDx7Magnitude[limit(kLoss, 0, 13312)]",
            "kMod = (kAddress < 2048 ? kMag : -kMag - 1) / 2048",
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
                loop_ops = range(feedback, loop_end - 1, -1)
                args = ", ".join(f"aPhase{i}, aAtten{i}" for i in loop_ops)
                scale = "iFeedback / 4" if algorithm in (4, 6, 32) else "iFeedback"
                lines.append("if iFeedback == 0 then")
                phase = f"aPhase{feedback}"
                for i in loop_ops:
                    lines.append(f"aOp{i} = sin(2 * $M_PI * ({phase})) * aAmp{i}")
                    phase = f"aPhase{i - 1} + aOp{i}"
                lines.append("else")
                for i in loop_ops:
                    lines.append(f"aAtten{i} = 2048 - floor(1024 * log2(limit(aAmp{i}, 1e-15, 4)))")
                lines += [f"aOp{op} vcs_dx7_fb{count} {scale}, {args}", "endif"]
            continue
        phase = " + ".join([f"aPhase{op}", *(f"aOp{source}" for source, dest in route["edges"] if dest == op)])
        lines.append(f"aOp{op} = sin(2 * $M_PI * ({phase})) * aAmp{op}")
    carriers = route["outputs"]
    mix = " + ".join(f"aOp{i}" for i in carriers)
    # Use all wired carriers, including silent ones. The return tap above
    # already has the calibrated feedback gain for loops ending in a carrier.
    gain = 2 ** (-_CARRIER_ATTENUATION[len(carriers) - 1] / 8)
    return [*lines, f"aMix = ({mix}) * {gain:.17g}"]


def dx7_header(targets, *, preallocate=False):
    voices = set()
    cartridges = {}
    audition = False
    for target in targets:
        if target.dx7_banks and not any(node.opcode == "fm_dx7" for node in target.patch.graph.nodes):
            raise CompilationError(["DX7 banks require an fm_dx7 instrument."])
        for bank in target.dx7_banks.values():
            if bank.digest not in cartridges:
                cartridges[bank.digest] = [voice[:145] for voice in read_sysex(bank.raw)]
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
    presets = list(DX7_PRESETS.values())
    offsets = []
    for digest, programs in sorted(cartridges.items()):
        offsets.append(f"giDx7Offset_{digest} init {len(presets)}")
        presets.extend(programs)
    voices.update(presets)
    algorithms = range(1, 33) if audition else sorted({voice[134] + 1 for voice in voices})
    curves = json.loads((DATA / "dx7_curves.json").read_text())
    lines = [
        "/* MSFA calibration and numeric curves, adapted for Csound.\n"
        + (DATA / "dx7-apache-license.txt").read_text()
        + "*/"
    ]
    lines += [f"giDx7_{name}[] fillarray " + ", ".join(map(str, values)) for name, values in curves.items()]
    lines += [f"{_voice_array(v)}[] fillarray " + ", ".join(map(str, v)) for v in sorted(voices)]
    lines.extend(offsets)
    lines.append(f"giDx7Presets[][] init {len(presets)}, {len(DX7_PREVIEW_KEYS)}")
    for slot, voice in enumerate(presets, 1):
        lines.append(f"giDx7Presets setrow {_voice_array(voice)}, {slot - 1}")
    feedback_routes = (ALGORITHMS[a - 1]["feedback"] for a in algorithms)
    loop_lengths = {end - start + 1 for start, end in feedback_routes}
    lines.append((DATA / "dx7_feedback.orc").read_text())
    lines += [_feedback_loop(n) for n in sorted(loop_lengths)]
    lines += [(DATA / "fm_dx7.orc").read_text()]
    for op in range(6, 0, -1):
        lines.append(
            f"aPhase{op}, aAmp{op}, iTail{op}, kSilent{op} vcs_dx7_operator iVoice, {(6 - op) * 21}, iKey, iVelocity, kPitch, kBend, kAM, kGate, kReleaseFloor, iStart"
        )
    for index, algorithm in enumerate(algorithms):
        lines.append(f"{'if' if index == 0 else 'elseif'} iAlgorithm == {algorithm} then")
        lines += _route(algorithm)
        carriers = ALGORITHMS[algorithm - 1]["outputs"]
        lines.append("iTail = max(" + ", ".join(["0.005", *(f"iTail{i}" for i in carriers)]) + ")")
        lines.append("kSilent = " + " * ".join(f"kSilent{i}" for i in carriers))
    lines += ["endif", (DATA / "dx7_release.orc").read_text()]
    if preallocate:
        # Csound's third prealloc argument selects a UDO by name. These pools
        # belong to this engine, shared across its rack instruments. Further
        # concurrent notes can still allocate normally.
        for name, per_voice in [("vcs_dx7_voice", 1), ("vcs_dx7_operator", 6), ("vcs_dx7_level", 12)]:
            lines.append(f'prealloc "{name}", {DX7_LIVE_VOICES * per_voice}, 1')
        lines.extend(f'prealloc "vcs_dx7_fb{n}", {DX7_LIVE_VOICES}, 1' for n in sorted(loop_lengths))
    return ["\n".join(lines)]
