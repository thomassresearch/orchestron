"""Lossless SCORE compaction: branch observations and reusable numeric fields."""

from collections import defaultdict

from backend.app.models.patch import PatchGraph
from backend.app.services.performance_export_curves import is_curve_score_line


def controller_note_filters(graph: PatchGraph) -> dict[str, frozenset[int] | None]:
    """Restrict reads only when every consumer belongs to a literal note Switch.

    Shared/root computations, If blocks and calculated selectors conservatively
    observe every note. Include formula bindings as well as visible connections;
    a knob's name or instrument type never determines which notes use it.
    """
    nodes = {node.id: node for node in graph.nodes}
    formulas = graph.ui_layout.get("input_formulas", {})
    if not isinstance(formulas, dict):
        return {}  # Optional/legacy editor metadata need not be a formula map.
    consumers = defaultdict(set)
    for link in graph.connections:
        consumers[link.from_node_id].add(link.to_node_id)
    for key, formula in formulas.items():
        if isinstance(formula, dict):
            bindings = formula.get("inputs", [])
            if not isinstance(key, str) or not isinstance(bindings, list) or any(
                not isinstance(binding, dict) for binding in bindings
            ):
                return {}
            for binding in bindings:
                consumers[binding.get("from_node_id")].add(key.split("::", 1)[0])

    case_notes = {}
    for block_id, block in graph.control_flow.items():
        selector = [link for link in graph.connections
                    if link.to_node_id == block_id and link.to_port_id == "selector"]
        literal_note_switch = (
            block.kind == "switch" and len(selector) == 1
            and nodes[selector[0].from_node_id].opcode == "notnum"
            and selector[0].from_port_id == "inote"
            and f"{block_id}::selector" not in formulas
        )
        explicit_notes = {case.value for case in block.cases[:-1]}
        for case in block.cases:
            notes = None
            if literal_note_switch:
                notes = frozenset(note for note in range(128)
                                  if (note not in explicit_notes if case.value is None else note == case.value))
            for node_id in case.node_ids:
                case_notes[node_id] = notes

    result = {}
    for node in graph.nodes:
        if node.opcode != "perf_controller":
            continue
        if node.id in case_notes:
            result[node.id] = case_notes[node.id]
            continue
        observed = set()
        for consumer in consumers[node.id]:
            notes = case_notes.get(consumer)
            if notes is None:
                result[node.id] = None
                break
            observed.update(notes)
        else:
            result[node.id] = frozenset(observed)
    return result


def compact_score_macros(lines: list[str]) -> list[str]:
    """Share exact repeated setter/linseg p-fields using native score macros.

    Csound expands these before parsing/sorting: instrument numbers, event order,
    timing, numeric precision and linseg arguments are identical. Keep short or
    unique field groups inline when a definition would increase the file size.
    This operates only on generated numeric score lines, never instrument code.
    """
    groups = defaultdict(list)
    for index, line in enumerate(lines):
        if line.startswith("i 1 ") or is_curve_score_line(line):
            # p2 stays at each occurrence; p3 onward includes the full duration,
            # destination and value/shape, so no normalization changes rounding.
            fields = line.split(maxsplit=3)
            if len(fields) == 4:
                groups[fields[3]].append((index, " ".join(fields[:3])))
    definitions = []
    result = list(lines)
    for fields, occurrences in groups.items():
        name = f"VCS{len(definitions)}"
        reference = f"${name}"
        definition = f"#define {name} # {fields} #"
        savings = len(occurrences) * (len(fields) - len(reference))
        if savings <= len(definition) + 1:
            continue
        definitions.append(definition)
        for index, prefix in occurrences:
            result[index] = f"{prefix} {reference}"
    return [*definitions, *result]
