"""Static controller definitions and instance-scoped Csound software channels."""

from __future__ import annotations

import hashlib
import json
import math
from functools import cache

from pydantic import ValidationError

from backend.app.models.performance_controller import PerformanceControllerDefinition, is_safe_integer
from backend.app.models.opcode import SignalType
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_control_flow import resolve_control_flow_spec
from backend.app.services.compiler_graph import is_compatible_type
from backend.app.services.opcode_service import OpcodeService


@cache
def _default_opcodes():
    return OpcodeService(icon_prefix="/static/icons")


def controller_update_modes(graph, opcode_service=None) -> dict[str, str]:
    """Conservative capability analysis, including connections used by input formulas.

    Each input is an evaluation boundary: a K-rate destination may change live;
    an I-rate destination (including branch selectors) must retain initialization.
    Unknown/incomplete destinations never authorize promotion. Formula bindings
    resolve only connected sources, so checking every wire also covers formulas
    without guessing which expressions will actually use a connected value.
    """
    consumers = {node.id: set() for node in graph.nodes if node.opcode == "perf_controller"}
    if not consumers:
        return {}
    opcodes = opcode_service or _default_opcodes()
    nodes = {node.id: node for node in graph.nodes}
    for link in graph.connections:
        if link.from_node_id not in consumers:
            continue
        node = nodes.get(link.to_node_id)
        spec = resolve_control_flow_spec(graph, node.id, opcodes.get_opcode(node.opcode)) if node else None
        port = next((p for p in spec.inputs if p.id == link.to_port_id), None) if spec else None
        accepts_k = bool(port and is_compatible_type(SignalType.CONTROL, port.signal_type, port.accepted_signal_types))
        consumers[link.from_node_id].add(accepts_k)
    return {node: "unused" if not rates else "live" if rates == {True} else "init" if rates == {False} else "mixed"
            for node, rates in consumers.items()}


def controller_definitions(graph, *, strict=True, opcode_service=None) -> list[PerformanceControllerDefinition]:
    result = []
    modes = controller_update_modes(graph, opcode_service)
    for node in graph.nodes:
        if node.opcode != "perf_controller":
            continue
        try:
            definition = PerformanceControllerDefinition.model_validate({
                "node_id": node.id,
                **{key: node.params[key] for key in ("controller_type", "min", "max", "default", "scale", "label", "controller_group") if key in node.params},
                "update_mode": modes[node.id],
            })
        except ValidationError as exc:
            message = f"perf_controller '{node.id}': " + "; ".join(e["msg"] for e in exc.errors())
            if strict:
                raise CompilationError([message]) from exc
            definition = PerformanceControllerDefinition(node_id=node.id, error=message)
        result.append(definition)
    return result


def validate_controller_values(definitions, values: dict[str, float]) -> dict[str, float]:
    by_id = {definition.node_id: definition for definition in definitions}
    for node_id, value in values.items():
        definition = by_id.get(node_id)
        if definition is None:
            raise CompilationError([f"Unknown performance controller '{node_id}'."])
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or not definition.min <= value <= definition.max:
            raise CompilationError([f"Performance controller '{node_id}' value must be within {definition.min}–{definition.max}."])
        if definition.controller_type == "integer" and not is_safe_integer(value):
            raise CompilationError([f"Performance controller '{node_id}' value must be a safe integer."])
        if definition.controller_type == "bool" and value not in (0, 1):
            raise CompilationError([f"Performance controller '{node_id}' value must be 0 or 1."])
    return dict(values)


def controller_bindings(target, fallback_identity: str, opcode_service=None) -> dict:
    definitions = controller_definitions(target.patch.graph, opcode_service=opcode_service)
    values = validate_controller_values(definitions, target.performance_controller_values)
    validate_controller_midi_ccs(definitions, target.performance_controller_midi_ccs, target.midi_channel)
    identity = target.assignment_id or fallback_identity
    return {
        definition.node_id: {
            **definition.model_dump(exclude={"error"}),
            "channel": "__vcs_perf_" + hashlib.sha256(json.dumps([identity, definition.node_id]).encode()).hexdigest(),
            "value": values.get(definition.node_id, definition.default),
        }
        for definition in definitions
    }


def validate_controller_midi_ccs(definitions, bindings: dict[str, int], midi_channel: int) -> dict[str, int]:
    by_id = {definition.node_id for definition in definitions}
    for node_id, cc in bindings.items():
        if node_id not in by_id:
            raise CompilationError([f"Unknown performance controller '{node_id}'."])
        if type(cc) is not int or not 1 <= cc <= 50 or not 1 <= midi_channel <= 16:
            raise CompilationError(["Performance controller MIDI CC requires 1–50 and an instrument MIDI channel."])
    return dict(bindings)


def controller_midi_value(value: int, definition) -> float:
    """The same seven-bit mapping is used by live delivery and offline capture."""
    if definition.controller_type == "bool":
        return float(value >= 64)
    if value <= 0:
        return definition.min
    if value >= 127:
        return definition.max
    t = value / 127
    if definition.scale == "logarithmic":
        result = math.exp((1 - t) * math.log(definition.min) + t * math.log(definition.max))
    else:
        result = (1 - t) * definition.min + t * definition.max
    if definition.controller_type == "integer":
        result = math.floor(result) + (result - math.floor(result) >= 0.5)
    return min(definition.max, max(definition.min, result))


# Reserved ahead of note instruments only in offline bundles with CC mappings.
def controller_setter_lines(manifest: dict) -> list[str]:
    lines = ["instr 1"]
    channels = [binding["channel"] for bindings in manifest.values() for binding in bindings.values()]
    for index, channel in enumerate(channels):
        lines.extend([f" {'if' if index == 0 else 'elseif'} p4 == {index} then", f'  chnset p5, "{channel}"'])
    if channels:
        lines.append(" endif")
    return [*lines, "endin"]
