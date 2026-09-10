"""Static controller definitions and instance-scoped Csound software channels."""

from __future__ import annotations

import hashlib
import json

from pydantic import ValidationError

from backend.app.models.performance_controller import PerformanceControllerDefinition
from backend.app.services.compiler_common import CompilationError


def controller_definitions(graph, *, strict=True) -> list[PerformanceControllerDefinition]:
    result = []
    for node in graph.nodes:
        if node.opcode != "perf_controller":
            continue
        try:
            definition = PerformanceControllerDefinition.model_validate({
                "node_id": node.id,
                **{key: node.params[key] for key in ("min", "max", "default", "scale", "label") if key in node.params},
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
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not definition.min <= value <= definition.max:
            raise CompilationError([f"Performance controller '{node_id}' value must be within {definition.min}–{definition.max}."])
    return dict(values)


def controller_bindings(target, fallback_identity: str) -> dict:
    definitions = controller_definitions(target.patch.graph)
    values = validate_controller_values(definitions, target.performance_controller_values)
    identity = target.assignment_id or fallback_identity
    return {
        definition.node_id: {
            **definition.model_dump(exclude={"error"}),
            "channel": "__vcs_perf_" + hashlib.sha256(json.dumps([identity, definition.node_id]).encode()).hexdigest(),
            "value": values.get(definition.node_id, definition.default),
        }
        for definition in definitions
    }
