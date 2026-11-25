"""Dry six-operator PM synthesis, with private sample-local phase and feedback."""

from hashlib import sha256
from math import isfinite

from backend.app.services.compiler_formula import formula_target_key, lookup_input_formula_config
from backend.app.models.fm6 import (
    FM6_DATA, FM6_FIELDS, FM6_INPUT_RANGES, FM6_KEYS, FM6_PRESETS, fm6_voice, packed_voice, validate_fm6_value,
)
from backend.app.services.compiler_common import CompilationError


def validate_fm6_target(target):
    if not any(n.opcode == "fm6_voice" for n in target.patch.graph.nodes):
        return
    if target.always_on or target.patch.always_on:
        raise CompilationError(["FM6 requires a note-activated instrument, not Continuous."])
    if any(n.opcode == "midi_legato" for n in target.patch.graph.nodes):
        raise CompilationError(["FM6 currently supports polyphonic notes, not midi_legato phrases."])


def preview_values(patch):
    """Only literal socket defaults can be changed independently of their graph."""
    connected = {(link.to_node_id, link.to_port_id) for link in patch.graph.connections}
    nodes = {}
    for node in patch.graph.nodes:
        if node.opcode != "fm6_voice":
            continue
        values = fm6_voice(node.params)
        for key, (_, _, default) in FM6_INPUT_RANGES.items():
            if ((node.id, key) in connected or lookup_input_formula_config(
                    patch.graph.ui_layout, formula_target_key(node.id, key)) is not None):
                continue
            try:
                value = float(node.params.get(key, default))
            except (TypeError, ValueError):
                continue
            if isfinite(value):
                values[key] = value
        nodes[node.id] = values
    return nodes


def preview_channel(assignment, node, key):
    identity = sha256(f"{len(assignment)}:{assignment}{node}".encode()).hexdigest()[:24]
    return f"fm6_{identity}_{key}"


def preview_writes(assignment, node, initial, changes):
    writes = {}
    for key, value in changes.items():
        if key not in initial:
            raise ValueError(f"FM6 field {key} is not editable in this preview.")
        # Old scalar defaults can lie outside the editor range. Allow an exact restoration.
        if value != initial[key]:
            validate_fm6_value(key, value)
        writes[preview_channel(assignment, node, key)] = value
    return writes


def fm6_node_lines(node, env, preview, assignment, header):
    try:
        voice = fm6_voice(node.params)
    except ValueError as exc:
        raise CompilationError([str(exc)]) from exc
    custom = "i" + env["aout"][1:] + "_voice"
    packed = packed_voice(voice)
    if preview:
        # Each note takes one init-rate snapshot. Existing voices own their array and envelopes.
        inputs = {}
        for key, value in preview.items():
            channel = preview_channel(assignment, node.id, key)
            header.append(f'chnset {value:.17g}, "{channel}"')
            inputs[key] = f'chnget:i("{channel}")'
        packed = ", ".join(inputs[key] for key in FM6_KEYS)
        env = env | {key: inputs[key] for key in FM6_INPUT_RANGES if key in inputs}
    return [
        f"{custom}[] fillarray {packed}",
        f"{env['aout']} vcs_fm6_voice " + ", ".join(env[key] for key in (
            "kfreq", "ivelocity", "ipreset", "ibrightness", "ifeedback", "iattack_scale",
            "irelease_scale", "ivibrato_rate", "ivibrato_depth", "igain",
        )) + f", {custom}",
    ]


def fm6_header(targets):
    return [FM6_OPCODE] if any(n.opcode == "fm6_voice" for t in targets for n in t.patch.graph.nodes) else []


def _build_opcode():
    lines = [
        "opcode vcs_fm6_voice, a, k" + "i" * 9 + "i[]",
        " setksmps 1",
        " kFreq, iVelocityIn, iPresetIn, iBrightIn, iFeedbackIn, iAttackIn, iReleaseIn, iVRateIn, iVDepthIn, iGainIn, iCustom[] xin",
        f" iPreset = int(limit(iPresetIn, 0, {len(FM6_PRESETS)}))",
    ]
    for preset in FM6_PRESETS:
        lines += [f" {'if' if preset['id'] == 1 else 'elseif'} iPreset == {preset['id']} then",
                  f"  iVoice[] fillarray {packed_voice(preset['voice'])}"]
    lines += [" else", "  iVoice[] = iCustom", " endif",
              " iAlgorithm = int(iVoice[0])",
              " iFeedback = (iFeedbackIn < 0 ? iVoice[1] : limit(iFeedbackIn, 0, 100)) / 100",
              " iBrightness = limit(iBrightIn, 0, 200) / 100",
              " iVelocity = limit(iVelocityIn, 0, 1)",
              " iAttackScale = limit(iAttackIn, .25, 4)",
              " iReleaseScale = limit(iReleaseIn, .25, 4)",
              " iGain = ampdb(limit(iGainIn, -36, 0)) / 6",
              " kLfo phasor limit(iVRateIn, .1, 12)",
              " kPitch = max(.01, kFreq) * pow(2, sin(2 * $M_PI * kLfo) * limit(iVDepthIn, 0, 100) / 1200)",
              " kLast init 0", " kPrevious init 0"]
    # The fields are shared with the editor; every operator owns its ADSR and phase.
    for op in range(1, 7):
        offset = 2 + (op - 1) * len(FM6_FIELDS)
        f = {key: f"iVoice[{offset + j}]" for j, key in enumerate(FM6_FIELDS)}
        lines += [
            f" iLevel{op} = {f['enabled']} * {f['level']} / 100 * (1 - {f['velocity']} / 100 * (1 - iVelocity))",
            f" iFreq{op} = {f['ratio']} * pow(2, {f['detune']} / 1200)",
            f" iRelease{op} = {f['release']} * iReleaseScale",
            f" kEnv{op} madsr {f['attack']} * iAttackScale, {f['decay']}, {f['sustain']} / 100, iRelease{op}, 0, iRelease{op}",
            f" kPhase{op} phasor kPitch * iFreq{op}",
        ]
    for alg in FM6_DATA["algorithms"]:
        lines.append(f" {'if' if alg['id'] == 1 else 'elseif'} iAlgorithm == {alg['id']} then")
        for op in range(6, 0, -1):
            upstream = [f"kOp{source}" for source, dest in alg["edges"] if dest == op]
            modulation = f"8 * iBrightness * ({' + '.join(upstream)})" if upstream else "0"
            if op == 6:
                modulation += " + 4 * iFeedback * (kLast + kPrevious) / 2"
            lines.append(f"  kOp{op} = sin(2 * $M_PI * kPhase{op} + {modulation}) * kEnv{op} * iLevel{op}")
        lines.append("  kSum = " + " + ".join(f"kOp{op}" for op in alg["outputs"]))
    lines += [" endif", " kPrevious = kLast", " kLast = kOp6", " aOutput = kSum * iGain",
              " xout aOutput", "endop"]
    return "\n".join(lines)


FM6_OPCODE = _build_opcode()
