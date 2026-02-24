from __future__ import annotations

import re
import sys
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Iterable

from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchDocument
from backend.app.models.session import CompileArtifact
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.opcode_service import OpcodeService

OPTIONAL_OMIT_MARKER = "__VS_OPTIONAL_OMIT__"
INPUT_FORMULAS_LAYOUT_KEY = "input_formulas"
GEN_NODES_LAYOUT_KEY = "gen_nodes"
SFLOAD_NODES_LAYOUT_KEY = "sfload_nodes"
FORMULA_TARGET_KEY_SEPARATOR = "::"
DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES = 128
DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES = 512
FORMULA_UNARY_FUNCTIONS = frozenset({"abs", "ceil", "floor", "ampdb", "dbamp"})


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


class CompilerService:
    def __init__(
        self,
        opcode_service: OpcodeService,
        gen_asset_service: GenAssetService | None = None,
    ) -> None:
        self._opcode_service = opcode_service
        self._gen_asset_service = gen_asset_service

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

        compiled_instruments: list[tuple[int, PatchInstrumentTarget, CompiledInstrumentLines]] = []
        sfload_global_requests: list[SfloadGlobalRequest] = []
        for instrument_number, target in enumerate(targets, start=1):
            compiled_lines = self._compile_instrument_lines(
                target.patch,
                global_scope_key=f"{instrument_number}_{target.patch.id}",
            )
            compiled_instruments.append((instrument_number, target, compiled_lines))
            sfload_global_requests.extend(compiled_lines.sfload_global_requests)

        global_sfload_lines = self._render_sfload_global_requests(sfload_global_requests)
        if global_sfload_lines:
            orc_lines.extend([*global_sfload_lines, ""])

        for instrument_number, target, compiled_lines in compiled_instruments:
            instrument_lines = compiled_lines.instrument_lines
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

    def _compile_instrument_lines(
        self,
        patch: PatchDocument,
        *,
        global_scope_key: str,
    ) -> CompiledInstrumentLines:
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
        sfload_global_requests: list[SfloadGlobalRequest] = []

        for node_id in ordered_ids:
            compiled = compiled_nodes[node_id]
            env: dict[str, str] = {}

            for output in compiled.spec.outputs:
                if compiled.spec.name == "sfload":
                    env[output.id] = self._allocate_global_var_name(global_scope_key, compiled.node.id, output)
                else:
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

            if diagnostics:
                raise CompilationError(diagnostics)

            if compiled.spec.name == "GEN":
                rendered = self._render_gen_node(compiled.node, patch.graph.ui_layout, env)
                instrument_lines.extend(
                    [f"; node:{compiled.node.id} opcode:{compiled.spec.name}", *rendered.splitlines()]
                )
                continue

            if compiled.spec.name == "sfload":
                rendered = self._render_sfload_global_request(compiled.node, patch.graph.ui_layout, env)
                sfload_global_requests.append(rendered)
                continue

            for param_key, param_value in compiled.node.params.items():
                if param_key in env:
                    continue
                env[param_key] = self._format_literal(param_value, SignalType.CONTROL)

            if compiled.spec.name in {"const_a", "const_i", "const_k"} and "value" not in env:
                env["value"] = "0"

            try:
                rendered = compiled.spec.template.format(**env)
            except KeyError as err:
                raise CompilationError([f"Template value missing for node '{compiled.node.id}': {err}"]) from err

            rendered = self._cleanup_optional_placeholders(rendered)

            instrument_lines.extend(
                [f"; node:{compiled.node.id} opcode:{compiled.spec.name}", *rendered.splitlines()]
            )

        return CompiledInstrumentLines(
            instrument_lines=instrument_lines,
            sfload_global_requests=sfload_global_requests,
        )

    def _render_gen_node(
        self,
        node: NodeInstance,
        ui_layout: dict[str, object],
        env: dict[str, str],
    ) -> str:
        if "ift" not in env:
            raise CompilationError([f"GEN node '{node.id}' is missing output variable binding."])

        raw_config = self._lookup_gen_node_config(ui_layout, node.id)

        mode = self._gen_mode(raw_config.get("mode"))
        table_number = self._gen_int(raw_config.get("tableNumber"), default=0)
        start_time = self._gen_number(raw_config.get("startTime"), default=0)
        table_size = self._gen_int(raw_config.get("tableSize"), default=16384)
        routine_name = self._gen_routine_name(raw_config.get("routineName"))
        routine_number = abs(self._gen_int(raw_config.get("routineNumber"), default=10))
        if routine_number == 0:
            routine_number = 10
        if table_size == 0 and (routine_name is not None or routine_number != 1):
            routine_label = f'GEN{routine_name}' if routine_name is not None else f"GEN{routine_number}"
            raise CompilationError([f"GEN node '{node.id}' tableSize cannot be 0 for {routine_label}."])
        normalize = self._gen_bool(raw_config.get("normalize"), default=True)
        igen = routine_number if normalize else -routine_number
        generator = routine_name if routine_name is not None else igen
        effective_mode = "ftgen" if routine_name is None and routine_number == 1 else mode

        args = self._flatten_gen_node_args(
            node_id=node.id,
            raw_config=raw_config,
            routine_number=0 if routine_name is not None else routine_number,
            table_size=table_size,
        )
        prelude_lines: list[str] = []
        if routine_name is None and routine_number == 1 and args and isinstance(args[0], str) and not args[0].startswith("expr:"):
            string_var = self._allocate_string_temp_name(node.id, "gen01_file")
            prelude_lines.append(f"{string_var} init {self._format_gen_argument(args[0])}")
            args = [f"expr:{string_var}", *args[1:]]
        rendered_args = ", ".join(self._format_gen_argument(value) for value in args)
        rendered_generator = self._format_gen_argument(generator)

        if effective_mode == "ftgenonce":
            line = f"{env['ift']} ftgenonce {table_number}, 0, {table_size}, {rendered_generator}"
        else:
            line = (
                f"{env['ift']} ftgen {table_number}, {self._format_gen_argument(start_time)}, "
                f"{table_size}, {rendered_generator}"
            )

        if rendered_args:
            line = f"{line}, {rendered_args}"
        if prelude_lines:
            return "\n".join([*prelude_lines, line])
        return line

    def _flatten_gen_node_args(
        self,
        *,
        node_id: str,
        raw_config: dict[str, object],
        routine_number: int,
        table_size: int,
    ) -> list[str | int | float | bool]:
        if routine_number == 10:
            partials = self._gen_number_list(raw_config.get("harmonicAmplitudes"))
            if not partials:
                partials = self._gen_number_list(raw_config.get("partials"))
            return partials or [1]

        if routine_number == 11:
            nh = max(
                1,
                self._gen_int(
                    raw_config.get("gen11HarmonicCount", raw_config.get("nh")),
                    default=8,
                ),
            )
            lh = max(
                1,
                self._gen_int(
                    raw_config.get("gen11LowestHarmonic", raw_config.get("lh")),
                    default=1,
                ),
            )
            multiplier = self._gen_number(
                raw_config.get("gen11Multiplier", raw_config.get("r")),
                default=1,
            )
            return [nh, lh, 1 if multiplier is None else multiplier]

        if routine_number == 2:
            values = self._gen_number_list(raw_config.get("valueList"))
            if not values:
                values = self._gen_number_list(raw_config.get("values"))
            return values or [1]

        if routine_number == 7:
            start_value = self._gen_number(raw_config.get("segmentStartValue"), default=0)
            segment_rows = raw_config.get("segments")
            points: list[str | int | float | bool] = [start_value]
            if isinstance(segment_rows, list):
                for entry in segment_rows:
                    if not isinstance(entry, dict):
                        continue
                    length = self._gen_number(entry.get("length"), default=None)
                    value = self._gen_number(entry.get("value"), default=None)
                    if length is None or value is None:
                        continue
                    points.extend([length, value])
            if len(points) == 1:
                points.extend([max(1, table_size), 1])
            return points

        if routine_number == 17:
            pair_rows = raw_config.get("gen17Pairs", raw_config.get("pairs"))
            points: list[str | int | float | bool] = []
            if isinstance(pair_rows, list):
                for entry in pair_rows:
                    if not isinstance(entry, dict):
                        continue
                    x_value = self._gen_number(entry.get("x"), default=None)
                    y_value = self._gen_number(entry.get("y"), default=None)
                    if x_value is None or y_value is None:
                        continue
                    points.extend([x_value, y_value])
            if not points:
                return [0, 0, max(1, table_size - 1), 1]
            return points

        if routine_number == 20:
            window_type = max(
                1,
                self._gen_int(
                    raw_config.get("gen20WindowType", raw_config.get("windowType")),
                    default=1,
                ),
            )
            max_value = self._gen_number(raw_config.get("gen20Max", raw_config.get("max")), default=1)
            args: list[str | int | float | bool] = [window_type, 1 if max_value is None else max_value]
            if self._gen20_requires_opt(window_type):
                opt_value = self._gen_number(raw_config.get("gen20Opt", raw_config.get("opt")), default=0.5)
                args.append(0.5 if opt_value is None else opt_value)
            return args

        if routine_number == 1:
            sample_asset = raw_config.get("sampleAsset")
            sample_path: str | None = None
            sample_filecode: int | None = None
            if isinstance(sample_asset, dict):
                stored_name = sample_asset.get("stored_name")
                if isinstance(stored_name, str) and stored_name.strip():
                    normalized_stored_name = stored_name.strip()
                    if self._gen_asset_service is not None:
                        try:
                            sample_filecode = self._gen_asset_service.ensure_gen01_numeric_filecode_alias(
                                normalized_stored_name
                            )
                        except ValueError as err:
                            raise CompilationError([str(err)]) from err
                    else:
                        sample_path = self._resolve_gen_audio_asset_path(normalized_stored_name)
            if sample_path is None:
                raw_sample_path = raw_config.get("samplePath")
                if isinstance(raw_sample_path, str) and raw_sample_path.strip():
                    sample_path = raw_sample_path.strip()
            if sample_path is None and sample_filecode is None:
                raise CompilationError(
                    [f"GEN node '{node_id}' GEN01 requires an uploaded audio asset or samplePath."]
                )

            skip_time = self._gen_number(raw_config.get("sampleSkipTime"), default=0)
            file_format = self._gen_int(raw_config.get("sampleFormat"), default=0)
            channel = self._gen_int(raw_config.get("sampleChannel"), default=0)
            return [
                sample_filecode if sample_filecode is not None else sample_path,
                0 if skip_time is None else skip_time,
                file_format,
                channel,
            ]

        raw_args = raw_config.get("rawArgs")
        if isinstance(raw_args, list):
            parsed: list[str | int | float | bool] = []
            for value in raw_args:
                parsed.append(self._gen_parse_raw_arg(value))
            return parsed

        raw_args_text = raw_config.get("rawArgsText")
        if isinstance(raw_args_text, str) and raw_args_text.strip():
            tokens = re.split(r"[\n,]+", raw_args_text)
            return [self._gen_parse_raw_arg(token.strip()) for token in tokens if token.strip()]

        return []

    def _resolve_gen_audio_asset_path(self, stored_name: str) -> str:
        if self._gen_asset_service is None:
            raise CompilationError(["GEN audio asset support is not configured on the backend."])
        try:
            path = self._gen_asset_service.resolve_audio_path(stored_name)
        except ValueError as err:
            raise CompilationError([str(err)]) from err
        if not path.exists():
            raise CompilationError([f"GEN audio asset '{stored_name}' does not exist on the backend."])
        # Use an SSDIR-relative filename so compiled ORC does not embed host-specific absolute paths.
        return path.name

    def _render_sfload_global_request(
        self,
        node: NodeInstance,
        ui_layout: dict[str, object],
        env: dict[str, str],
    ) -> SfloadGlobalRequest:
        output_name = env.get("ifilhandle")
        if not output_name:
            raise CompilationError([f"sfload node '{node.id}' is missing output variable binding."])

        filename = self._resolve_sfload_filename(ui_layout, node.id, legacy_params=node.params)
        if filename is None:
            raise CompilationError([f"sfload node '{node.id}' requires an uploaded SF2 asset or samplePath."])

        return SfloadGlobalRequest(
            node_id=node.id,
            var_name=output_name,
            filename=filename,
        )

    def _render_sfload_global_requests(self, requests: list[SfloadGlobalRequest]) -> list[str]:
        if not requests:
            return []

        lines: list[str] = []
        first_var_by_filename: dict[str, str] = {}
        for request in requests:
            existing_var = first_var_by_filename.get(request.filename)
            if existing_var is None:
                first_var_by_filename[request.filename] = request.var_name
                lines.extend(
                    [
                        f"; node:{request.node_id} opcode:sfload",
                        f"{request.var_name} sfload {self._format_literal(request.filename, SignalType.STRING)}",
                    ]
                )
                continue

            if existing_var == request.var_name:
                continue

            lines.extend(
                [
                    f"; node:{request.node_id} opcode:sfload (alias)",
                    f"{request.var_name} init {existing_var}",
                ]
            )

        return lines

    @staticmethod
    def _allocate_string_temp_name(node_id: str, suffix: str) -> str:
        safe_node = re.sub(r"[^A-Za-z0-9_]", "_", node_id)
        safe_suffix = re.sub(r"[^A-Za-z0-9_]", "_", suffix)
        return f"S_{safe_node}_{safe_suffix}"

    def _resolve_sfload_filename(
        self,
        ui_layout: dict[str, object],
        node_id: str,
        legacy_params: dict[str, object] | None = None,
    ) -> str | None:
        raw_config = self._lookup_sfload_node_config(ui_layout, node_id)
        if not raw_config:
            raw_config = {}

        sample_asset = raw_config.get("sampleAsset")
        if isinstance(sample_asset, dict):
            stored_name = sample_asset.get("stored_name")
            if isinstance(stored_name, str) and stored_name.strip():
                return self._resolve_gen_audio_asset_path(stored_name.strip())

        raw_sample_path = raw_config.get("samplePath")
        if isinstance(raw_sample_path, str) and raw_sample_path.strip():
            return raw_sample_path.strip()

        if legacy_params is not None:
            raw_filename = legacy_params.get("filename")
            if isinstance(raw_filename, str) and raw_filename.strip():
                return raw_filename.strip()

        return None

    @staticmethod
    def _lookup_gen_node_config(ui_layout: dict[str, object], node_id: str) -> dict[str, object]:
        raw_gen_nodes = ui_layout.get(GEN_NODES_LAYOUT_KEY)
        if not isinstance(raw_gen_nodes, dict):
            return {}
        raw_config = raw_gen_nodes.get(node_id)
        if not isinstance(raw_config, dict):
            return {}
        return raw_config

    @staticmethod
    def _lookup_sfload_node_config(ui_layout: dict[str, object], node_id: str) -> dict[str, object]:
        raw_sfload_nodes = ui_layout.get(SFLOAD_NODES_LAYOUT_KEY)
        if not isinstance(raw_sfload_nodes, dict):
            return {}
        raw_config = raw_sfload_nodes.get(node_id)
        if not isinstance(raw_config, dict):
            return {}
        return raw_config

    @staticmethod
    def _gen_mode(value: object) -> str:
        if isinstance(value, str) and value.strip().lower() == "ftgenonce":
            return "ftgenonce"
        return "ftgen"

    @staticmethod
    def _gen_bool(value: object, *, default: bool) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on"}:
                return True
            if normalized in {"0", "false", "no", "off"}:
                return False
        return default

    @staticmethod
    def _gen_int(value: object, *, default: int) -> int:
        number = CompilerService._gen_number(value, default=None)
        if number is None:
            return default
        return int(round(number))

    @staticmethod
    def _gen_number(value: object, *, default: float | int | None) -> float | int | None:
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (int, float)):
            if isinstance(value, float) and not (value == value and abs(value) != float("inf")):
                return default
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return default
            try:
                if re.fullmatch(r"[-+]?\d+", text):
                    return int(text)
                if re.fullmatch(r"[-+]?(?:\d+\.?\d*|\.\d+)", text):
                    return float(text)
            except ValueError:
                return default
        return default

    @staticmethod
    def _gen_number_list(value: object) -> list[int | float]:
        if not isinstance(value, list):
            return []
        result: list[int | float] = []
        for entry in value:
            number = CompilerService._gen_number(entry, default=None)
            if number is None:
                continue
            result.append(number)
        return result

    @staticmethod
    def _gen_routine_name(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip().lower()
        return normalized or None

    @staticmethod
    def _gen_parse_raw_arg(value: object) -> str | int | float | bool:
        if isinstance(value, (bool, int, float)):
            return value
        if not isinstance(value, str):
            return str(value)

        token = value.strip()
        if token == "":
            return ""

        if (token.startswith('"') and token.endswith('"')) or (token.startswith("'") and token.endswith("'")):
            return token[1:-1]

        number = CompilerService._gen_number(token, default=None)
        if number is not None:
            return number

        return f"expr:{token}"

    @staticmethod
    def _gen20_requires_opt(window_type: int) -> bool:
        return window_type in {6, 7, 9}

    @staticmethod
    def _format_gen_argument(value: str | int | float | bool) -> str:
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (int, float)):
            return str(value)
        if value.startswith("expr:"):
            expression = value[5:].strip()
            if not expression:
                raise CompilationError(["GEN raw argument expression is empty."])
            if not re.fullmatch(r"[-+*/(). 0-9a-zA-Z_]+", expression):
                raise CompilationError([f"Unsafe GEN raw expression '{expression}' blocked by compiler."])
            return expression

        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'

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
                if peek() and peek().kind == "lparen":
                    if name not in FORMULA_UNARY_FUNCTIONS:
                        raise CompilationError(
                            [f"Invalid formula for input '{context_label}': unknown function '{name}'."]
                        )
                    consume()
                    argument = parse_expression()
                    if not peek() or peek().kind != "rparen":
                        raise CompilationError(
                            [f"Invalid formula for input '{context_label}': missing closing ')'."]
                        )
                    consume()
                    return f"{name}({argument})"
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
    def _allocate_global_var_name(scope_key: str, node_id: str, port: PortSpec) -> str:
        safe_scope = re.sub(r"[^A-Za-z0-9_]", "_", scope_key)
        safe_node = re.sub(r"[^A-Za-z0-9_]", "_", node_id)
        safe_port = re.sub(r"[^A-Za-z0-9_]", "_", port.id)
        return f"g{port.signal_type.value}_{safe_scope}_{safe_node}_{safe_port}"

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
