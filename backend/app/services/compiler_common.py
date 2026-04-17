from __future__ import annotations

from dataclasses import dataclass

from backend.app.models.patch import Connection, NodeInstance, PatchDocument
from backend.app.models.opcode import OpcodeSpec

OPTIONAL_OMIT_MARKER = "__VS_OPTIONAL_OMIT__"
INPUT_FORMULAS_LAYOUT_KEY = "input_formulas"
GEN_NODES_LAYOUT_KEY = "gen_nodes"
SFLOAD_NODES_LAYOUT_KEY = "sfload_nodes"
FORMULA_TARGET_KEY_SEPARATOR = "::"
DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES = 128
DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES = 512


class CompilationError(Exception):
    def __init__(self, diagnostics: list[str]):
        self.diagnostics = diagnostics
        super().__init__("Patch compilation failed")


@dataclass(slots=True)
class CompiledNode:
    node: NodeInstance
    spec: OpcodeSpec


@dataclass(slots=True)
class FormulaToken:
    kind: str
    value: str
    position: int


@dataclass(slots=True)
class PatchInstrumentTarget:
    patch: PatchDocument
    midi_channel: int


@dataclass(slots=True)
class SfloadGlobalRequest:
    node_id: str
    var_name: str
    filename: str


@dataclass(slots=True)
class CompiledInstrumentLines:
    instrument_lines: list[str]
    sfload_global_requests: list[SfloadGlobalRequest]
    global_header_lines: list[str]


@dataclass(slots=True)
class CompiledGraphContext:
    compiled_nodes: dict[str, CompiledNode]
    inbound_index: dict[tuple[str, str], list[Connection]]
    ordered_ids: list[str]
