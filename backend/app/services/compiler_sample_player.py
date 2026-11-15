"""Lower Sample Player tables and the finite, fully routed patch voice."""
from __future__ import annotations

import json

from backend.app.models.sample_player import MAX_SAMPLE_TABLE_BYTES, SAMPLE_RATE, SAMPLE_BINDING_COMMENT
from backend.app.services.compiler_common import CompilationError

OPCODE = "sample_player"


def has_sample_player(patch):
    return any(node.opcode == OPCODE for node in patch.graph.nodes)


def validate_sample_target(target):
    patch = target.patch
    nodes = [node for node in patch.graph.nodes if node.opcode == OPCODE]
    if not nodes:
        if target.samples:
            raise CompilationError([f"'{patch.name}' has a sample map but no Sample Player. Restore the node or clear the map."])
        return
    if len(nodes) != 1 or target.always_on or patch.always_on or any(
        node.opcode == "midi_legato" for node in patch.graph.nodes
    ):
        raise CompilationError(["A MIDI-triggered patch may have one Sample Player and cannot combine it with MIDI Legato."])
    if patch.graph.control_flow and any(
        nodes[0].id in case.node_ids
        for block in patch.graph.control_flow.values() for case in block.cases
    ):
        raise CompilationError(["Sample Player must be outside If and Switch cases."])


def setup_sample_tables(targets, references, *, stored_filecode):
    """Deduplicate by playback content, not the source upload or display metadata."""
    tables = {}
    lines = []
    bindings = {}
    memory = 0
    for target, reference in zip(targets, references, strict=True):
        if not has_sample_player(target.patch):
            continue
        notes = {}
        for note, sample in sorted(target.samples.items()):
            table_key = sample.sha256, sample.frame_count, sample.channels
            index = tables.get(table_key)
            if index is None:
                index = len(tables)
                tables[table_key] = index
                # Allow for guard frames and conservatively budget double MYFLT.
                memory += (sample.frame_count + 2) * sample.channels * 8
                if memory > MAX_SAMPLE_TABLE_BYTES:
                    raise CompilationError(["Sample Player tables exceed the 256 MiB engine limit."])
                code = target.sample_filecodes.get(sample.stored_name)
                if code is None:
                    try:
                        code = stored_filecode(sample.stored_name)
                    except (ValueError, OSError) as exc:
                        raise CompilationError([f"Could not preload Sample Player audio: {exc}"]) from exc
                lines.append(f"gi_vcs_sample_{index} ftgen 0, 0, 0, -1, {code}, 0, 0, 0")
            notes[note] = (index, sample.channels, sample.frame_count)
        if target.midi_channel > 0:
            bindings[target.midi_channel] = (int(reference), notes)
            lines.append(SAMPLE_BINDING_COMMENT + json.dumps([target.midi_channel, int(reference), notes], separators=(",", ":")))
    if tables:
        lines.append("gi_vcs_sample_tables[] fillarray " + ", ".join(f"gi_vcs_sample_{i}" for i in range(len(tables))))
    return lines, bindings


def voice_prefix(has_samples: bool) -> list[str]:
    if not has_samples:
        return ["turnoff"]
    return [
        f"i_vcs_sample_length = p9 / {SAMPLE_RATE}",
        "i_vcs_sample_table = gi_vcs_sample_tables[int(p7)]",
        "a_vcs_sample_age line 0, 1, 1",
        "k_vcs_sample_age = (timeinstk() - 1) / kr",
        "k_vcs_sample_cut init p11",
        "if p10 >= 0 then",
        '  S_vcs_sample_slot sprintf "vcs_sample_stop_%d", p10',
        "  k_vcs_sample_cancel chnget S_vcs_sample_slot",
        "  if k_vcs_sample_cancel > 0 && k_vcs_sample_cut < 0 then",
        "    k_vcs_sample_cut = k_vcs_sample_age",
        "  endif",
        "endif",
        "a_vcs_sample_cancel_gain = 1",
        "if k_vcs_sample_cut >= 0 then",
        "  a_vcs_sample_cancel_gain limit (k_vcs_sample_cut + 0.005 - a_vcs_sample_age) / 0.005, 0, 1",
        "endif",
        # Downstream envelopes can request extra release time; sampler p3 is
        # bounded even in that case.
        "if k_vcs_sample_age + 0.00000001 >= p3 || (k_vcs_sample_cut >= 0 && k_vcs_sample_age >= k_vcs_sample_cut + 0.005) then",
        "  turnoff",
        "endif",
    ]


def sample_node_lines(left: str, right: str, *, mapped: bool) -> list[str]:
    if not mapped:
        return [f"{left} = 0", f"{right} = 0"]
    return [
        "i_vcs_sample_attack = min(0.0005, i_vcs_sample_length * 0.5)",
        "i_vcs_sample_release = min(0.002, i_vcs_sample_length * 0.5)",
        "a_vcs_sample_in limit a_vcs_sample_age / i_vcs_sample_attack, 0, 1",
        "a_vcs_sample_out limit (i_vcs_sample_length - a_vcs_sample_age) / i_vcs_sample_release, 0, 1",
        "a_vcs_sample_gain = (p5 / 128) * a_vcs_sample_in * a_vcs_sample_out",
        "if p8 == 1 then",
        f"  {left} loscil3 a_vcs_sample_gain, 1, i_vcs_sample_table, 1, 0, 0, p9, 0, 0, p9",
        f"  {right} = {left}",
        "else",
        f"  {left}, {right} loscil3 a_vcs_sample_gain, 1, i_vcs_sample_table, 1, 0, 0, p9, 0, 0, p9",
        "endif",
    ]
