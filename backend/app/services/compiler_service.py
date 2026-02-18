from __future__ import annotations

import re
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Iterable

from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType
from backend.app.models.patch import Connection, NodeInstance, PatchDocument
from backend.app.models.session import CompileArtifact
from backend.app.services.opcode_service import OpcodeService

OPTIONAL_OMIT_MARKER = "__VS_OPTIONAL_OMIT__"


class CompilationError(Exception):
    def __init__(self, diagnostics: list[str]):
        self.diagnostics = diagnostics
        super().__init__("Patch compilation failed")


@dataclass(slots=True)
class CompiledNode:
    node: NodeInstance
    spec: OpcodeSpec


class CompilerService:
    def __init__(self, opcode_service: OpcodeService) -> None:
        self._opcode_service = opcode_service

    def compile_patch(
        self,
        patch: PatchDocument,
        midi_input: str,
        rtmidi_module: str,
    ) -> CompileArtifact:
        diagnostics: list[str] = []
        graph = patch.graph

        node_map = {node.id: node for node in graph.nodes}
        if not node_map:
            raise CompilationError(["Patch graph is empty. Add opcode nodes before compiling."])

        compiled_nodes: dict[str, CompiledNode] = {}
        for node in graph.nodes:
            spec = self._opcode_service.get_opcode(node.opcode)
            if not spec:
                diagnostics.append(f"Node '{node.id}' references unknown opcode '{node.opcode}'.")
                continue
            compiled_nodes[node.id] = CompiledNode(node=node, spec=spec)

        if diagnostics:
            raise CompilationError(diagnostics)

        if not any(item.spec.name == "outs" for item in compiled_nodes.values()):
            raise CompilationError(["Patch must include at least one 'outs' output node."])

        inbound_index = self._build_inbound_index(graph.connections, compiled_nodes)

        errors = self._validate_connections(graph.connections, compiled_nodes)
        if errors:
            raise CompilationError(errors)

        ordered_ids = self._topological_sort(graph.nodes, graph.connections)

        output_vars: dict[tuple[str, str], str] = {}
        rate_counters: dict[str, int] = defaultdict(int)
        instrument_lines: list[str] = []

        for node_id in ordered_ids:
            compiled = compiled_nodes[node_id]
            env: dict[str, str] = {}

            for output in compiled.spec.outputs:
                env[output.id] = self._allocate_var_name(rate_counters, compiled.node.id, output)
                output_vars[(compiled.node.id, output.id)] = env[output.id]

            for input_port in compiled.spec.inputs:
                source_connection = inbound_index.get((compiled.node.id, input_port.id))
                if source_connection:
                    key = (source_connection.from_node_id, source_connection.from_port_id)
                    source_var = output_vars.get(key)
                    if not source_var:
                        raise CompilationError(
                            [
                                "Internal compiler error: unresolved source variable "
                                f"for {source_connection.from_node_id}.{source_connection.from_port_id}"
                            ]
                        )
                    env[input_port.id] = source_var
                    continue

                literal, found = self._resolve_literal_value(compiled.node, input_port)
                if found:
                    env[input_port.id] = literal
                    continue

                if input_port.required:
                    diagnostics.append(
                        f"Missing required input '{input_port.id}' on node '{compiled.node.id}' ({compiled.spec.name})."
                    )
                else:
                    env[input_port.id] = OPTIONAL_OMIT_MARKER

            for param_key, param_value in compiled.node.params.items():
                if param_key in env:
                    continue
                env[param_key] = self._format_literal(param_value, SignalType.CONTROL)

            if compiled.spec.name in {"const_a", "const_i", "const_k"} and "value" not in env:
                env["value"] = "0"

            if diagnostics:
                raise CompilationError(diagnostics)

            try:
                rendered = compiled.spec.template.format(**env)
            except KeyError as err:
                raise CompilationError([f"Template value missing for node '{compiled.node.id}': {err}"]) from err

            rendered = self._cleanup_optional_placeholders(rendered)

            instrument_lines.extend(
                [f"; node:{compiled.node.id} opcode:{compiled.spec.name}", *rendered.splitlines()]
            )

        engine = patch.graph.engine_config
        orc_lines = [
            f"sr = {engine.sr}",
            f"ksmps = {engine.ksmps}",
            f"nchnls = {engine.nchnls}",
            f"0dbfs = {engine.zero_dbfs}",
            "",
            "massign 0, 1",
            "",
            "instr 1",
            *[f"  {line}" if line else "" for line in instrument_lines],
            "endin",
        ]

        orc = "\n".join(orc_lines)
        csd = self._wrap_csd(orc, midi_input, rtmidi_module)

        return CompileArtifact(orc=orc, csd=csd, diagnostics=[])

    def _validate_connections(
        self,
        connections: Iterable[Connection],
        compiled_nodes: dict[str, CompiledNode],
    ) -> list[str]:
        errors: list[str] = []
        for connection in connections:
            source = compiled_nodes.get(connection.from_node_id)
            target = compiled_nodes.get(connection.to_node_id)

            if not source:
                errors.append(f"Connection source node not found: '{connection.from_node_id}'")
                continue
            if not target:
                errors.append(f"Connection target node not found: '{connection.to_node_id}'")
                continue

            source_port = self._find_port(source.spec.outputs, connection.from_port_id)
            target_port = self._find_port(target.spec.inputs, connection.to_port_id)

            if not source_port:
                errors.append(
                    f"Unknown source port '{connection.from_port_id}' on node '{source.node.id}' ({source.spec.name})"
                )
                continue
            if not target_port:
                errors.append(
                    f"Unknown target port '{connection.to_port_id}' on node '{target.node.id}' ({target.spec.name})"
                )
                continue

            if not self._is_compatible_type(
                source_port.signal_type,
                target_port.signal_type,
                target_port.accepted_signal_types,
            ):
                errors.append(
                    "Signal type mismatch: "
                    f"{source.node.id}.{source_port.id} ({source_port.signal_type}) -> "
                    f"{target.node.id}.{target_port.id} ({target_port.signal_type})"
                )

        return errors

    @staticmethod
    def _is_compatible_type(
        source: SignalType,
        target: SignalType,
        accepted_signal_types: list[SignalType] | None = None,
    ) -> bool:
        if accepted_signal_types and source in accepted_signal_types:
            return True
        if source == target:
            return True
        return source == SignalType.INIT and target == SignalType.CONTROL

    @staticmethod
    def _find_port(ports: Iterable[PortSpec], port_id: str) -> PortSpec | None:
        for port in ports:
            if port.id == port_id:
                return port
        return None

    @staticmethod
    def _build_inbound_index(
        connections: Iterable[Connection],
        compiled_nodes: dict[str, CompiledNode],
    ) -> dict[tuple[str, str], Connection]:
        inbound: dict[tuple[str, str], Connection] = {}
        for connection in connections:
            key = (connection.to_node_id, connection.to_port_id)
            if key in inbound:
                raise CompilationError(
                    [
                        "Multiple inbound edges for one input port are not supported: "
                        f"{connection.to_node_id}.{connection.to_port_id}"
                    ]
                )

            if connection.to_node_id not in compiled_nodes or connection.from_node_id not in compiled_nodes:
                continue
            inbound[key] = connection
        return inbound

    @staticmethod
    def _topological_sort(nodes: list[NodeInstance], connections: list[Connection]) -> list[str]:
        indegree: dict[str, int] = {node.id: 0 for node in nodes}
        adjacency: dict[str, list[str]] = {node.id: [] for node in nodes}

        for connection in connections:
            if connection.from_node_id not in indegree or connection.to_node_id not in indegree:
                continue
            adjacency[connection.from_node_id].append(connection.to_node_id)
            indegree[connection.to_node_id] += 1

        queue = deque(sorted([node_id for node_id, degree in indegree.items() if degree == 0]))
        ordered: list[str] = []

        while queue:
            node_id = queue.popleft()
            ordered.append(node_id)
            for target in adjacency[node_id]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    queue.append(target)

        if len(ordered) != len(nodes):
            raise CompilationError(
                [
                    "Graph contains a cycle. Add explicit delay/feedback opcodes to break direct recursion."
                ]
            )

        return ordered

    def _resolve_literal_value(self, node: NodeInstance, input_port: PortSpec) -> tuple[str, bool]:
        if input_port.id in node.params:
            return self._format_literal(node.params[input_port.id], input_port.signal_type), True
        if input_port.default is not None:
            return self._format_literal(input_port.default, input_port.signal_type), True
        return "", False

    @staticmethod
    def _cleanup_optional_placeholders(rendered: str) -> str:
        cleaned_lines: list[str] = []
        for raw_line in rendered.splitlines():
            line = raw_line
            while True:
                trimmed = re.sub(
                    rf"(?:,\s*{OPTIONAL_OMIT_MARKER}|\s+{OPTIONAL_OMIT_MARKER})\s*$",
                    "",
                    line,
                )
                if trimmed == line:
                    break
                line = trimmed

            if OPTIONAL_OMIT_MARKER in line:
                raise CompilationError(
                    [
                        "Unsupported optional argument placement in opcode template line: "
                        f"'{raw_line}'"
                    ]
                )

            cleaned_lines.append(line)

        return "\n".join(cleaned_lines)

    @staticmethod
    def _format_literal(value: str | int | float | bool, signal_type: SignalType) -> str:
        if signal_type == SignalType.STRING:
            if isinstance(value, str):
                escaped = value.replace('"', '\\"')
                return f'"{escaped}"'
            raise CompilationError(["String signal inputs require string values."])

        if isinstance(value, bool):
            return "1" if value else "0"

        if isinstance(value, int | float):
            return str(value)

        # For numeric signal paths, only raw numeric expressions are accepted for safety.
        if isinstance(value, str):
            if re.fullmatch(r"[-+*/(). 0-9a-zA-Z_]+", value):
                return value
            raise CompilationError([f"Unsafe expression '{value}' blocked by compiler."])

        raise CompilationError([f"Unsupported literal value '{value}'"])

    @staticmethod
    def _allocate_var_name(counters: dict[str, int], node_id: str, port: PortSpec) -> str:
        safe_node = re.sub(r"[^A-Za-z0-9_]", "_", node_id)
        safe_port = re.sub(r"[^A-Za-z0-9_]", "_", port.id)
        prefix = port.signal_type.value
        counters[prefix] += 1
        return f"{prefix}_{safe_node}_{safe_port}_{counters[prefix]}"

    @staticmethod
    def _wrap_csd(orc: str, midi_input: str, rtmidi_module: str) -> str:
        return "\n".join(
            [
                "<CsoundSynthesizer>",
                "<CsOptions>",
                f"-d -odac -M{midi_input} -+rtmidi={rtmidi_module}",
                "</CsOptions>",
                "<CsInstruments>",
                orc,
                "</CsInstruments>",
                "<CsScore>",
                "f 1 0 16384 10 1",
                "f 0 z",
                "</CsScore>",
                "</CsoundSynthesizer>",
            ]
        )
