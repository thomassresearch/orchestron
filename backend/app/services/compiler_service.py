from __future__ import annotations

import re
import sys
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Iterable

from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchDocument
from backend.app.models.session import CompileArtifact
from backend.app.services.opcode_service import OpcodeService

OPTIONAL_OMIT_MARKER = "__VS_OPTIONAL_OMIT__"
INPUT_FORMULAS_LAYOUT_KEY = "input_formulas"
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


class CompilerService:
    def __init__(self, opcode_service: OpcodeService) -> None:
        self._opcode_service = opcode_service

    def compile_patch(
        self,
        patch: PatchDocument,
        midi_input: str,
        rtmidi_module: str,
    ) -> CompileArtifact:
        return self.compile_patch_bundle(
            targets=[PatchInstrumentTarget(patch=patch, midi_channel=0)],
            midi_input=midi_input,
            rtmidi_module=rtmidi_module,
        )

    def compile_patch_bundle(
        self,
        targets: list[PatchInstrumentTarget],
        midi_input: str,
        rtmidi_module: str,
    ) -> CompileArtifact:
        if not targets:
            raise CompilationError(["At least one patch must be provided for compilation."])

        self._validate_target_channels(targets)
        engine = self._resolve_shared_engine(targets)

        orc_lines = [
            f"sr = {engine.sr}",
            f"ksmps = {engine.ksmps}",
            f"nchnls = {engine.nchnls}",
            f"0dbfs = {engine.zero_dbfs}",
            "",
            *self._massign_lines(targets),
            "",
        ]

        for instrument_number, target in enumerate(targets, start=1):
            instrument_lines = self._compile_instrument_lines(target.patch)
            orc_lines.extend(
                [
                    f"; patch:{target.patch.id} name:{target.patch.name} channel:{target.midi_channel}",
                    f"instr {instrument_number}",
                    *[f"  {line}" if line else "" for line in instrument_lines],
                    "endin",
                    "",
                ]
            )

        orc = "\n".join(orc_lines).rstrip()
        csd = self._wrap_csd(
            orc,
            midi_input,
            rtmidi_module,
            software_buffer=engine.software_buffer,
            hardware_buffer=engine.hardware_buffer,
        )
        return CompileArtifact(orc=orc, csd=csd, diagnostics=[])

    def _compile_instrument_lines(self, patch: PatchDocument) -> list[str]:
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
                inbound_connections = inbound_index.get((compiled.node.id, input_port.id), [])
                target_key = self._formula_target_key(compiled.node.id, input_port.id)
                has_input_formula = self._lookup_input_formula_config(patch.graph.ui_layout, target_key) is not None
                if inbound_connections:
                    if len(inbound_connections) == 1 and not has_input_formula:
                        source_connection = inbound_connections[0]
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
                    else:
                        env[input_port.id] = self._resolve_input_expression(
                            ui_layout=patch.graph.ui_layout,
                            to_node_id=compiled.node.id,
                            to_port_id=input_port.id,
                            inbound_connections=inbound_connections,
                            output_vars=output_vars,
                        )
                    continue
                if has_input_formula:
                    env[input_port.id] = self._resolve_input_expression(
                        ui_layout=patch.graph.ui_layout,
                        to_node_id=compiled.node.id,
                        to_port_id=input_port.id,
                        inbound_connections=inbound_connections,
                        output_vars=output_vars,
                    )
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

        return instrument_lines

    @staticmethod
    def _resolve_shared_engine(targets: list[PatchInstrumentTarget]) -> EngineConfig:
        return targets[0].patch.graph.engine_config

    @staticmethod
    def _validate_target_channels(targets: list[PatchInstrumentTarget]) -> None:
        seen: set[int] = set()
        for target in targets:
            channel = int(target.midi_channel)
            if channel < 0 or channel > 16:
                raise CompilationError([f"Invalid MIDI channel '{channel}'. Expected values in the range 0..16."])
            if channel == 0:
                continue
            if channel in seen:
                raise CompilationError([f"MIDI channel '{channel}' is assigned to more than one instrument."])
            seen.add(channel)

    @staticmethod
    def _massign_lines(targets: list[PatchInstrumentTarget]) -> list[str]:
        if all(target.midi_channel > 0 for target in targets):
            lines = ["massign 0, 0"]
            for instrument_number, target in enumerate(targets, start=1):
                lines.append(f"massign {target.midi_channel}, {instrument_number}")
            return lines

        return [
            f"massign {target.midi_channel if target.midi_channel > 0 else 0}, {instrument_number}"
            for instrument_number, target in enumerate(targets, start=1)
        ]

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
    ) -> dict[tuple[str, str], list[Connection]]:
        inbound: dict[tuple[str, str], list[Connection]] = defaultdict(list)
        for connection in connections:
            if connection.to_node_id not in compiled_nodes or connection.from_node_id not in compiled_nodes:
                continue
            inbound[(connection.to_node_id, connection.to_port_id)].append(connection)
        return dict(inbound)

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

    def _resolve_input_expression(
        self,
        ui_layout: dict[str, object],
        to_node_id: str,
        to_port_id: str,
        inbound_connections: list[Connection],
        output_vars: dict[tuple[str, str], str],
    ) -> str:
        source_vars_by_binding: dict[tuple[str, str], str] = {}
        ordered_source_keys: list[tuple[str, str]] = []
        for connection in inbound_connections:
            source_key = (connection.from_node_id, connection.from_port_id)
            source_var = output_vars.get(source_key)
            if not source_var:
                raise CompilationError(
                    [
                        "Internal compiler error: unresolved source variable "
                        f"for {connection.from_node_id}.{connection.from_port_id}"
                    ]
                )
            if source_key not in source_vars_by_binding:
                ordered_source_keys.append(source_key)
            source_vars_by_binding[source_key] = source_var

        target_key = self._formula_target_key(to_node_id, to_port_id)
        context_label = f"{to_node_id}.{to_port_id}"
        formula_config = self._lookup_input_formula_config(ui_layout, target_key)
        if not formula_config:
            return self._default_multi_input_expression(
                [source_vars_by_binding[source_key] for source_key in ordered_source_keys]
            )

        token_to_expression: dict[str, str] = {}
        used_bindings: set[tuple[str, str]] = set()
        raw_bindings = formula_config.get("inputs")
        if isinstance(raw_bindings, list):
            for raw_binding in raw_bindings:
                if not isinstance(raw_binding, dict):
                    continue

                token = raw_binding.get("token")
                from_node_id = raw_binding.get("from_node_id")
                from_port_id = raw_binding.get("from_port_id")
                if not isinstance(token, str) or not self._is_valid_formula_identifier(token):
                    continue
                if not isinstance(from_node_id, str) or not from_node_id.strip():
                    continue
                if not isinstance(from_port_id, str) or not from_port_id.strip():
                    continue

                source_key = (from_node_id.strip(), from_port_id.strip())
                source_var = source_vars_by_binding.get(source_key)
                if not source_var or source_key in used_bindings or token in token_to_expression:
                    continue

                used_bindings.add(source_key)
                token_to_expression[token] = source_var

        auto_index = 1
        for source_key in ordered_source_keys:
            if source_key in used_bindings:
                continue
            auto_token = self._next_auto_formula_token(token_to_expression, auto_index)
            auto_index += 1
            token_to_expression[auto_token] = source_vars_by_binding[source_key]

        raw_expression = formula_config.get("expression")
        if not isinstance(raw_expression, str) or raw_expression.strip() == "":
            if not token_to_expression:
                raise CompilationError([f"Invalid formula for input '{context_label}': formula is empty."])
            return self._default_multi_input_expression(list(token_to_expression.values()))

        return self._render_formula_expression(raw_expression, token_to_expression, context_label)

    @staticmethod
    def _lookup_input_formula_config(ui_layout: dict[str, object], target_key: str) -> dict[str, object] | None:
        raw_formulas = ui_layout.get(INPUT_FORMULAS_LAYOUT_KEY)
        if not isinstance(raw_formulas, dict):
            return None
        raw_config = raw_formulas.get(target_key)
        if not isinstance(raw_config, dict):
            return None
        return raw_config

    @staticmethod
    def _formula_target_key(to_node_id: str, to_port_id: str) -> str:
        return f"{to_node_id}{FORMULA_TARGET_KEY_SEPARATOR}{to_port_id}"

    @staticmethod
    def _is_valid_formula_identifier(value: str) -> bool:
        return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value))

    @staticmethod
    def _next_auto_formula_token(token_map: dict[str, str], start_index: int) -> str:
        index = max(1, start_index)
        while f"in{index}" in token_map:
            index += 1
        return f"in{index}"

    @staticmethod
    def _default_multi_input_expression(source_vars: list[str]) -> str:
        if not source_vars:
            raise CompilationError(["Internal compiler error: cannot build expression for empty source list."])
        if len(source_vars) == 1:
            return source_vars[0]
        return "(" + ") + (".join(source_vars) + ")"

    def _render_formula_expression(
        self,
        expression: str,
        token_to_expression: dict[str, str],
        context_label: str,
    ) -> str:
        if expression.strip() == "":
            raise CompilationError([f"Invalid formula for input '{context_label}': formula is empty."])

        tokens = self._tokenize_formula_expression(expression, context_label)
        if not tokens:
            raise CompilationError([f"Invalid formula for input '{context_label}': formula is empty."])

        index = 0

        def peek() -> FormulaToken | None:
            if index >= len(tokens):
                return None
            return tokens[index]

        def consume() -> FormulaToken:
            nonlocal index
            token = tokens[index]
            index += 1
            return token

        def parse_expression() -> str:
            left = parse_term()
            while True:
                token = peek()
                if token and token.kind == "operator" and token.value in {"+", "-"}:
                    operator = consume().value
                    right = parse_term()
                    left = f"({left} {operator} {right})"
                    continue
                return left

        def parse_term() -> str:
            left = parse_factor()
            while True:
                token = peek()
                if token and token.kind == "operator" and token.value in {"*", "/"}:
                    operator = consume().value
                    right = parse_factor()
                    left = f"({left} {operator} {right})"
                    continue
                return left

        def parse_factor() -> str:
            token = peek()
            if token is None:
                raise CompilationError(
                    [f"Invalid formula for input '{context_label}': unexpected end of expression."]
                )

            if token.kind == "operator" and token.value in {"+", "-"}:
                operator = consume().value
                operand = parse_factor()
                return f"({operator}{operand})"

            if token.kind == "number":
                return consume().value

            if token.kind == "identifier":
                name = consume().value
                value = token_to_expression.get(name)
                if not value:
                    raise CompilationError(
                        [f"Invalid formula for input '{context_label}': unknown input token '{name}'."]
                    )
                return value

            if token.kind == "lparen":
                consume()
                inner = parse_expression()
                if not peek() or peek().kind != "rparen":
                    raise CompilationError(
                        [f"Invalid formula for input '{context_label}': missing closing ')'."]
                    )
                consume()
                return f"({inner})"

            raise CompilationError(
                [f"Invalid formula for input '{context_label}': unexpected token '{token.value}'."]
            )

        rendered = parse_expression()
        if index < len(tokens):
            raise CompilationError(
                [
                    "Invalid formula for input "
                    f"'{context_label}': unexpected token '{tokens[index].value}' at position {tokens[index].position + 1}."
                ]
            )
        return rendered

    def _tokenize_formula_expression(self, expression: str, context_label: str) -> list[FormulaToken]:
        tokens: list[FormulaToken] = []
        index = 0
        while index < len(expression):
            char = expression[index]

            if char.isspace():
                index += 1
                continue

            if char in {"+", "-", "*", "/"}:
                tokens.append(FormulaToken(kind="operator", value=char, position=index))
                index += 1
                continue

            if char == "(":
                tokens.append(FormulaToken(kind="lparen", value=char, position=index))
                index += 1
                continue

            if char == ")":
                tokens.append(FormulaToken(kind="rparen", value=char, position=index))
                index += 1
                continue

            if char.isalpha() or char == "_":
                start = index
                index += 1
                while index < len(expression) and (expression[index].isalnum() or expression[index] == "_"):
                    index += 1
                tokens.append(FormulaToken(kind="identifier", value=expression[start:index], position=start))
                continue

            if char.isdigit() or char == ".":
                start = index
                saw_digit = False
                saw_dot = False

                while index < len(expression):
                    current = expression[index]
                    if current.isdigit():
                        saw_digit = True
                        index += 1
                        continue
                    if current == ".":
                        if saw_dot:
                            break
                        saw_dot = True
                        index += 1
                        continue
                    break

                literal = expression[start:index]
                if not saw_digit or literal == ".":
                    raise CompilationError(
                        [f"Invalid formula for input '{context_label}': invalid number near '{literal}'."]
                    )
                tokens.append(FormulaToken(kind="number", value=literal, position=start))
                continue

            raise CompilationError(
                [
                    "Invalid formula for input "
                    f"'{context_label}': unsupported character '{char}' at position {index + 1}."
                ]
            )

        return tokens

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
    def _wrap_csd(
        orc: str,
        midi_input: str,
        rtmidi_module: str,
        software_buffer: int = DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES,
        hardware_buffer: int = DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES,
    ) -> str:
        selected_rtmidi_module = rtmidi_module.strip().strip("'\"")
        if sys.platform == "darwin":
            selected_rtmidi_module = "coremidi"

        options = [
            (
                f"-d -odac -M{midi_input} -+rtmidi={selected_rtmidi_module} "
                f"-b {software_buffer} -B{hardware_buffer}"
            )
        ]
        if sys.platform == "darwin":
            options.append("-+rtaudio=auhal")

        return "\n".join(
            [
                "<CsoundSynthesizer>",
                "<CsOptions>",
                " ".join(options),
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
