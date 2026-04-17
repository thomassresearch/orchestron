from __future__ import annotations

import re

from collections import defaultdict

from backend.app.models.opcode import PortSpec, SignalType
from backend.app.models.patch import NodeInstance, PatchDocument
from backend.app.services.compiler_common import (
    CompiledGraphContext,
    CompiledInstrumentLines,
    DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES,
    DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES,
    GEN_NODES_LAYOUT_KEY,
    OPTIONAL_OMIT_MARKER,
    SFLOAD_NODES_LAYOUT_KEY,
    CompilationError,
    PatchInstrumentTarget,
    SfloadGlobalRequest,
)
from backend.app.services.compiler_formula import (
    formula_target_key,
    lookup_input_formula_config,
    resolve_input_expression,
)
from backend.app.services.compiler_graph import find_port
from backend.app.services.gen_asset_service import GenAssetService


class OrchestraEmitter:
    def __init__(self, gen_asset_service: GenAssetService | None = None) -> None:
        self._gen_asset_service = gen_asset_service

    def compile_instrument_lines(
        self,
        patch: PatchDocument,
        *,
        graph_context: CompiledGraphContext,
        instrument_number: int,
        global_scope_key: str,
    ) -> CompiledInstrumentLines:
        diagnostics: list[str] = []
        ui_layout = patch.graph.ui_layout
        compiled_nodes = graph_context.compiled_nodes
        inbound_index = graph_context.inbound_index

        output_vars: dict[tuple[str, str], str] = {}
        output_signal_types: dict[tuple[str, str], SignalType] = {}
        rate_counters: dict[str, int] = defaultdict(int)
        instrument_lines: list[str] = []
        global_header_lines: list[str] = []
        sfload_global_requests: list[SfloadGlobalRequest] = []

        for node_id, compiled in compiled_nodes.items():
            for output in compiled.spec.outputs:
                if compiled.spec.name == "sfload":
                    output_vars[(node_id, output.id)] = self._allocate_global_var_name(global_scope_key, node_id, output)
                else:
                    output_vars[(node_id, output.id)] = self._allocate_var_name(rate_counters, node_id, output)
                output_signal_types[(node_id, output.id)] = output.signal_type

        for node_id in graph_context.ordered_ids:
            compiled = compiled_nodes[node_id]
            env: dict[str, str] = {}
            input_is_audio: dict[str, bool] = {}

            for output in compiled.spec.outputs:
                env[output.id] = output_vars[(compiled.node.id, output.id)]

            for input_port in compiled.spec.inputs:
                inbound_connections = inbound_index.get((compiled.node.id, input_port.id), [])
                target_key = formula_target_key(compiled.node.id, input_port.id)
                has_input_formula = lookup_input_formula_config(ui_layout, target_key) is not None

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
                        input_is_audio[input_port.id] = output_signal_types.get(key) == SignalType.AUDIO
                    else:
                        env[input_port.id] = resolve_input_expression(
                            ui_layout=ui_layout,
                            to_node_id=compiled.node.id,
                            to_port_id=input_port.id,
                            inbound_connections=inbound_connections,
                            output_vars=output_vars,
                        )
                        input_is_audio[input_port.id] = any(
                            output_signal_types.get((item.from_node_id, item.from_port_id)) == SignalType.AUDIO
                            for item in inbound_connections
                        )
                    continue

                if has_input_formula:
                    env[input_port.id] = resolve_input_expression(
                        ui_layout=ui_layout,
                        to_node_id=compiled.node.id,
                        to_port_id=input_port.id,
                        inbound_connections=inbound_connections,
                        output_vars=output_vars,
                    )
                    input_is_audio[input_port.id] = False
                    continue

                literal, found = self._resolve_literal_value(compiled.node, input_port)
                if found:
                    env[input_port.id] = literal
                    input_is_audio[input_port.id] = False
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
                rendered = self._render_gen_node(compiled.node, ui_layout, env)
                instrument_lines.extend([f"; node:{compiled.node.id} opcode:{compiled.spec.name}", *rendered.splitlines()])
                continue

            if compiled.spec.name == "sfload":
                sfload_global_requests.append(self._render_sfload_global_request(compiled.node, ui_layout, env))
                continue

            if compiled.spec.name == "maxalloc":
                icount_connections = inbound_index.get((compiled.node.id, "icount"), [])
                icount_formula_key = formula_target_key(compiled.node.id, "icount")
                if lookup_input_formula_config(ui_layout, icount_formula_key) is not None:
                    raise CompilationError(
                        [
                            f"maxalloc node '{compiled.node.id}' requires a literal icount value; "
                            "input formulas are not supported because maxalloc is emitted in the orchestra header."
                        ]
                    )

                icount = OPTIONAL_OMIT_MARKER
                if icount_connections:
                    if len(icount_connections) != 1:
                        raise CompilationError(
                            [f"maxalloc node '{compiled.node.id}' supports exactly one icount source connection."]
                        )

                    source_connection = icount_connections[0]
                    source_node = compiled_nodes.get(source_connection.from_node_id)
                    if (
                        not source_node
                        or source_node.spec.name != "const_i"
                        or source_connection.from_port_id != "iout"
                    ):
                        raise CompilationError(
                            [
                                f"maxalloc node '{compiled.node.id}' only accepts a direct const_i connection for icount; "
                                "other connected sources are instrument-local and cannot be used in orchestra header code."
                            ]
                        )
                    icount = self._format_literal(source_node.node.params.get("value", 0), SignalType.INIT)
                else:
                    icount_port = find_port(compiled.spec.inputs, "icount")
                    if not icount_port:
                        raise CompilationError(
                            [f"Internal compiler error: maxalloc node '{compiled.node.id}' is missing icount input spec."]
                        )

                    icount, found = self._resolve_literal_value(compiled.node, icount_port)
                    if not found or not icount or icount == OPTIONAL_OMIT_MARKER:
                        raise CompilationError([f"maxalloc node '{compiled.node.id}' requires icount."])

                rendered = f"maxalloc {instrument_number}, {icount}"
                global_header_lines.extend([f"; node:{compiled.node.id} opcode:{compiled.spec.name}", rendered])
                continue

            if compiled.spec.name == "flanger" and "adel" in env:
                adel = env["adel"].strip()
                if (
                    adel
                    and adel != OPTIONAL_OMIT_MARKER
                    and not input_is_audio.get("adel", False)
                    and not re.fullmatch(r"a\s*\(.+\)", adel)
                ):
                    env["adel"] = f"a({adel})"

            if compiled.spec.name == "vdelayxs" and "adl" in env:
                adl = env["adl"].strip()
                if (
                    adl
                    and adl != OPTIONAL_OMIT_MARKER
                    and not input_is_audio.get("adl", False)
                    and not re.fullmatch(r"a\s*\(.+\)", adl)
                ):
                    env["adl"] = f"a({adl})"

            if compiled.spec.name == "platerev" and "aexcite2" in env:
                aexcite2 = env["aexcite2"].strip()
                if (
                    aexcite2
                    and aexcite2 != OPTIONAL_OMIT_MARKER
                    and not input_is_audio.get("aexcite2", False)
                    and not re.fullmatch(r"a\s*\(.+\)", aexcite2)
                    and not aexcite2.startswith("a_")
                ):
                    env["aexcite2"] = OPTIONAL_OMIT_MARKER

            for param_key, param_value in compiled.node.params.items():
                if param_key in env:
                    continue
                env[param_key] = self._format_literal(param_value, SignalType.CONTROL)

            if (
                compiled.spec.name in {"madsr", "mxadsr"}
                and "ireltim" in env
                and "ireltim" not in compiled.node.params
                and "idrss" in compiled.node.params
            ):
                env["ireltim"] = self._format_literal(compiled.node.params["idrss"], SignalType.INIT)

            if compiled.spec.name in {"const_a", "const_i", "const_k"} and "value" not in env:
                env["value"] = "0"

            try:
                rendered = compiled.spec.template.format(**env)
            except KeyError as err:
                raise CompilationError([f"Template value missing for node '{compiled.node.id}': {err}"]) from err

            rendered = self._cleanup_optional_placeholders(rendered)
            instrument_lines.extend([f"; node:{compiled.node.id} opcode:{compiled.spec.name}", *rendered.splitlines()])

        return CompiledInstrumentLines(
            instrument_lines=instrument_lines,
            sfload_global_requests=sfload_global_requests,
            global_header_lines=global_header_lines,
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
            routine_label = f"GEN{routine_name}" if routine_name is not None else f"GEN{routine_number}"
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
            nh = max(1, self._gen_int(raw_config.get("gen11HarmonicCount", raw_config.get("nh")), default=8))
            lh = max(1, self._gen_int(raw_config.get("gen11LowestHarmonic", raw_config.get("lh")), default=1))
            multiplier = self._gen_number(raw_config.get("gen11Multiplier", raw_config.get("r")), default=1)
            return [nh, lh, 1 if multiplier is None else multiplier]

        if routine_number == 2:
            values = self._gen_number_list(raw_config.get("valueList"))
            if not values:
                values = self._gen_number_list(raw_config.get("values"))
            return values or [1]

        if routine_number in (7, 8):
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
            window_type = max(1, self._gen_int(raw_config.get("gen20WindowType", raw_config.get("windowType")), default=1))
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
                raise CompilationError([f"GEN node '{node_id}' GEN01 requires an uploaded audio asset or samplePath."])

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
            return [self._gen_parse_raw_arg(value) for value in raw_args]

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

        return SfloadGlobalRequest(node_id=node.id, var_name=output_name, filename=filename)

    @staticmethod
    def render_sfload_global_requests(requests: list[SfloadGlobalRequest]) -> list[str]:
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
                        f"{request.var_name} sfload {OrchestraEmitter._format_literal(request.filename, SignalType.STRING)}",
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
    def massign_lines(targets: list[PatchInstrumentTarget]) -> list[str]:
        if all(target.midi_channel > 0 for target in targets):
            lines = ["massign 0, 0"]
            for instrument_number, target in enumerate(targets, start=1):
                lines.append(f"massign {target.midi_channel}, {instrument_number}")
            return lines

        return [
            f"massign {target.midi_channel if target.midi_channel > 0 else 0}, {instrument_number}"
            for instrument_number, target in enumerate(targets, start=1)
        ]

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
        number = OrchestraEmitter._gen_number(value, default=None)
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
            number = OrchestraEmitter._gen_number(entry, default=None)
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

        number = OrchestraEmitter._gen_number(token, default=None)
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
    def _resolve_literal_value(node: NodeInstance, input_port: PortSpec) -> tuple[str, bool]:
        if input_port.id in node.params:
            return OrchestraEmitter._format_literal(node.params[input_port.id], input_port.signal_type), True
        if input_port.default is not None:
            return OrchestraEmitter._format_literal(input_port.default, input_port.signal_type), True
        return "", False

    @staticmethod
    def _cleanup_optional_placeholders(rendered: str) -> str:
        cleaned_lines: list[str] = []
        for raw_line in rendered.splitlines():
            line = raw_line
            while True:
                trimmed = re.sub(rf"(?:,\s*{OPTIONAL_OMIT_MARKER}|\s+{OPTIONAL_OMIT_MARKER})\s*$", "", line)
                if trimmed == line:
                    break
                line = trimmed

            if OPTIONAL_OMIT_MARKER in line:
                raise CompilationError(
                    ["Unsupported optional argument placement in opcode template line: " f"'{raw_line}'"]
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

        if isinstance(value, (int, float)):
            return str(value)

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


def wrap_csd(
    orc: str,
    midi_input: str,
    rtmidi_module: str,
    *,
    software_buffer: int = DEFAULT_CSOUND_SOFTWARE_BUFFER_SAMPLES,
    hardware_buffer: int = DEFAULT_CSOUND_HARDWARE_BUFFER_SAMPLES,
    runtime_platform: str,
) -> str:
    selected_rtmidi_module = rtmidi_module.strip().strip("'\"")
    if runtime_platform == "darwin":
        selected_rtmidi_module = "coremidi"

    options = [
        f"-d -n -M{midi_input} -+rtmidi={selected_rtmidi_module} "
        f"-b {software_buffer} -B{hardware_buffer}"
    ]

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
