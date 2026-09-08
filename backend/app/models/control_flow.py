from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.models.source_text import reject_control_characters

BRANCH_OPCODES = frozenset({"If", "Switch"})
CASE_RESULT = "CaseResult"
ROOT_ONLY_OPCODES = frozenset({"outs", "inleta", "outleta", "sfload", "maxalloc"})


class ControlFlowCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=128)
    value: float | None = None
    node_ids: list[str] = Field(default_factory=list)
    result_node_id: str = Field(min_length=1)
    silence: bool = False

    @field_validator("id", "name", "result_node_id")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return reject_control_characters(value, field_name="Control flow case")

    @field_validator("value", mode="before")
    @classmethod
    def validate_value(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value)):
            raise ValueError("Switch case values must be finite numbers.")
        return value


class ControlFlowBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["if", "switch"]
    output_format: Literal["mono", "stereo"] = "stereo"
    operator: Literal["==", "!=", "<", "<=", ">", ">="] = "=="
    cases: list[ControlFlowCase] = Field(min_length=2, max_length=128)

    @property
    def channels(self) -> tuple[str, ...]:
        return ("left", "right") if self.output_format == "stereo" else ("left",)


def validate_control_flow(nodes, blocks: dict[str, ControlFlowBlock]) -> None:
    """Validate ownership independently of wiring, so incomplete patches can be saved."""
    by_id = {node.id: node for node in nodes}
    structural = {node.id for node in nodes if node.opcode in BRANCH_OPCODES}
    if structural != set(blocks):
        raise ValueError("Every If/Switch node must have exactly one control_flow record.")
    owned: set[str] = set()
    results: set[str] = set()
    for block_id, block in blocks.items():
        if by_id[block_id].opcode != ("If" if block.kind == "if" else "Switch"):
            raise ValueError(f"Control flow kind does not match block '{block_id}'.")
        ids = [case.id for case in block.cases]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Block '{block_id}' has duplicate case IDs.")
        if block.kind == "if":
            if len(block.cases) != 2 or any(case.value is not None for case in block.cases):
                raise ValueError(f"If block '{block_id}' requires True and False cases without numeric values.")
        else:
            values = [case.value for case in block.cases[:-1]]
            if None in values or block.cases[-1].value is not None or len(values) != len(set(values)):
                raise ValueError(f"Switch '{block_id}' requires unique values and one final Default case.")
        for case in block.cases:
            members = set(case.node_ids)
            if len(members) != len(case.node_ids) or members & owned:
                raise ValueError(f"Case '{case.name}' has duplicate or overlapping node membership.")
            if case.result_node_id not in members or case.result_node_id not in by_id:
                raise ValueError(f"Case '{case.name}' requires its CaseResult node as a member.")
            if by_id[case.result_node_id].opcode != CASE_RESULT:
                raise ValueError(f"Case '{case.name}' has an invalid result node.")
            if case.silence and members != {case.result_node_id}:
                raise ValueError(f"Silence case '{case.name}' cannot contain synthesis nodes.")
            for node_id in members:
                node = by_id.get(node_id)
                if node is None:
                    raise ValueError(f"Case '{case.name}' references missing node '{node_id}'.")
                if node.opcode in BRANCH_OPCODES | ROOT_ONLY_OPCODES:
                    raise ValueError(f"Node '{node_id}' ({node.opcode}) must remain in the main graph.")
                if node.opcode == CASE_RESULT and node_id != case.result_node_id:
                    raise ValueError(f"Case '{case.name}' contains another case's result node.")
            owned.update(members)
            results.add(case.result_node_id)
    if results != {node.id for node in nodes if node.opcode == CASE_RESULT}:
        raise ValueError("Every CaseResult node must belong to exactly one case.")
