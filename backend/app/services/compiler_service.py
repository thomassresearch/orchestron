from __future__ import annotations

import sys

from backend.app.models.patch import PatchDocument
from backend.app.models.session import CompileArtifact
from backend.app.services.compiler_common import (
    CompiledInstrumentLines,
    CompiledNode,
    CompilationError,
    FormulaToken,
    PatchInstrumentTarget,
    SfloadGlobalRequest,
)
from backend.app.services.audio_port_names import audio_port_names
from backend.app.services.compiler_graph import compile_graph_context, resolve_shared_engine, validate_target_channels
from backend.app.services.compiler_orchestra import OrchestraEmitter, wrap_csd
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.orc_metadata import format_orc_comment_value


class CompilerService:
    def __init__(
        self,
        opcode_service: OpcodeService,
        gen_asset_service: GenAssetService | None = None,
    ) -> None:
        self._opcode_service = opcode_service
        self._orchestra_emitter = OrchestraEmitter(gen_asset_service=gen_asset_service)

    def compile_patch(
        self,
        patch: PatchDocument,
        midi_input: str,
        rtmidi_module: str,
    ) -> CompileArtifact:
        return self.compile_patch_bundle(
            targets=[
                PatchInstrumentTarget(
                    patch=patch,
                    midi_channel=0,
                    always_on=patch.always_on,
                )
            ],
            midi_input=midi_input,
            rtmidi_module=rtmidi_module,
        )

    def compile_patch_bundle(
        self,
        targets: list[PatchInstrumentTarget],
        midi_input: str,
        rtmidi_module: str,
        *,
        allow_packaged_asset_paths: bool = False,
        performance_input_mode: str = "midi",
    ) -> CompileArtifact:
        if not targets:
            raise CompilationError(["At least one patch must be provided for compilation."])

        validate_target_channels(targets)
        engine = resolve_shared_engine(targets)

        instrument_names = self._instrument_names(targets)

        orc_lines = [
            f"sr = {engine.sr}",
            f"ksmps = {engine.ksmps}",
            f"nchnls = {engine.nchnls}",
            f"0dbfs = {engine.zero_dbfs}",
            "",
        ]
        if performance_input_mode == "score":
            orc_lines.extend([*self._orchestra_emitter.score_controller_header_lines(), ""])
        else:
            orc_lines.extend(
                [
                    *self._orchestra_emitter.massign_lines(targets, instrument_names=instrument_names),
                    "",
                ]
            )

        compiled_instruments: list[tuple[int, PatchInstrumentTarget, CompiledInstrumentLines]] = []
        global_header_lines: list[str] = []
        sfload_global_requests: list[SfloadGlobalRequest] = []
        diagnostics: list[str] = []

        for instrument_number, target in enumerate(targets, start=1):
            graph_context = compile_graph_context(target.patch.graph, self._opcode_service)
            compiled_lines = self._orchestra_emitter.compile_instrument_lines(
                target.patch,
                graph_context=graph_context,
                instrument_number=instrument_number,
                instrument_name=instrument_names[instrument_number - 1] if instrument_names is not None else None,
                global_scope_key=f"{instrument_number}_{target.patch.id}",
                allow_packaged_asset_paths=allow_packaged_asset_paths,
                performance_input_mode=performance_input_mode,
                score_midi_channel=target.midi_channel,
            )
            compiled_instruments.append((instrument_number, target, compiled_lines))
            global_header_lines.extend(compiled_lines.global_header_lines)
            sfload_global_requests.extend(compiled_lines.sfload_global_requests)
            diagnostics.extend(compiled_lines.diagnostics)

        if global_header_lines:
            orc_lines.extend([*global_header_lines, ""])

        global_sfload_lines = self._orchestra_emitter.render_sfload_global_requests(sfload_global_requests)
        if global_sfload_lines:
            orc_lines.extend([*global_sfload_lines, ""])

        route_lines = self._audio_route_lines(targets, instrument_names)
        if route_lines:
            orc_lines.extend(["; effect audio routing", *route_lines, ""])

        always_on_lines = self._always_on_lines(targets, instrument_names)
        if always_on_lines:
            orc_lines.extend(["; always-on instruments", *always_on_lines, ""])

        for instrument_number, target, compiled_lines in compiled_instruments:
            instrument_ref = (
                instrument_names[instrument_number - 1] if instrument_names is not None else str(instrument_number)
            )
            orc_lines.extend(
                [
                    (
                        f"; patch:{format_orc_comment_value(target.patch.id)} "
                        f"name:{format_orc_comment_value(target.patch.name)} channel:{target.midi_channel} "
                        f"always_on:{'true' if target.always_on else 'false'}"
                    ),
                    f"instr {instrument_ref}",
                    *[f"  {line}" if line else "" for line in compiled_lines.instrument_lines],
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
        return CompileArtifact(orc=orc, csd=csd, diagnostics=diagnostics)

    @staticmethod
    def _instrument_names(targets: list[PatchInstrumentTarget]) -> list[str] | None:
        if not any(target.always_on or target.effect_source_ids or target.effect_routes for target in targets):
            return None
        return [f"vcs_instr_{index}" for index, _target in enumerate(targets, start=1)]

    def _audio_route_lines(
        self,
        targets: list[PatchInstrumentTarget],
        instrument_names: list[str] | None,
    ) -> list[str]:
        if instrument_names is None:
            return []

        source_by_assignment_id: dict[str, tuple[PatchInstrumentTarget, str]] = {}
        for target, instrument_name in zip(targets, instrument_names, strict=True):
            if target.assignment_id:
                source_by_assignment_id[target.assignment_id] = (target, instrument_name)

        lines: list[str] = []
        route_edges: list[tuple[str, str]] = []
        for sink_target, sink_name in zip(targets, instrument_names, strict=True):
            if not sink_target.always_on or not (sink_target.effect_routes or sink_target.effect_source_ids):
                continue
            sink_inlets = audio_port_names(sink_target.patch.graph, opcode="inleta")
            if not sink_inlets:
                continue

            for source_id, source_port_name, sink_port_name in self._effect_route_pairs(
                sink_target,
                source_by_assignment_id,
                sink_inlets,
            ):
                source_entry = source_by_assignment_id.get(source_id)
                if source_entry is None:
                    continue
                source_target, source_name = source_entry

                if source_port_name not in set(audio_port_names(source_target.patch.graph, opcode="outleta")):
                    continue
                route_edges.append((source_id, sink_target.assignment_id or sink_name))
                lines.append(
                    "connect "
                    f"{OrchestraEmitter._format_csound_string(source_name)}, "
                    f"{OrchestraEmitter._format_csound_string(source_port_name)}, "
                    f"{OrchestraEmitter._format_csound_string(sink_name)}, "
                    f"{OrchestraEmitter._format_csound_string(sink_port_name)}"
                )
        self._validate_audio_route_graph(route_edges)
        return lines

    def _effect_route_pairs(
        self,
        sink_target: PatchInstrumentTarget,
        source_by_assignment_id: dict[str, tuple[PatchInstrumentTarget, str]],
        sink_inlets: list[str],
    ) -> list[tuple[str, str, str]]:
        pairs: list[tuple[str, str, str]] = []
        seen: set[tuple[str, str]] = set()
        explicitly_routed_sources: set[str] = set()

        for source_id, port_name in sink_target.effect_routes:
            normalized_source_id = source_id.strip()
            normalized_port_name = port_name.strip()
            source_entry = source_by_assignment_id.get(normalized_source_id)
            if source_entry is None:
                continue
            explicitly_routed_sources.add(normalized_source_id)
            source_target, _source_name = source_entry
            source_outlets = audio_port_names(source_target.patch.graph, opcode="outleta")
            sink_port_name = self._resolve_sink_inlet_name(normalized_port_name, source_outlets, sink_inlets)
            key = (normalized_source_id, normalized_port_name)
            if not normalized_source_id or not sink_port_name or key in seen:
                continue
            seen.add(key)
            pairs.append((normalized_source_id, normalized_port_name, sink_port_name))

        for source_id in sink_target.effect_source_ids:
            normalized_source_id = source_id.strip()
            if normalized_source_id in explicitly_routed_sources:
                continue
            source_entry = source_by_assignment_id.get(normalized_source_id)
            if source_entry is None:
                continue
            source_target, _source_name = source_entry
            source_outlets = audio_port_names(source_target.patch.graph, opcode="outleta")
            for port_name in source_outlets:
                sink_port_name = self._resolve_sink_inlet_name(port_name, source_outlets, sink_inlets)
                key = (normalized_source_id, port_name)
                if not sink_port_name or key in seen:
                    continue
                seen.add(key)
                pairs.append((normalized_source_id, port_name, sink_port_name))

        return pairs

    @staticmethod
    def _resolve_sink_inlet_name(source_port_name: str, source_outlets: list[str], sink_inlets: list[str]) -> str | None:
        if not sink_inlets:
            return None
        if source_port_name in sink_inlets:
            return source_port_name

        sink_by_lower = {name.lower(): name for name in sink_inlets}
        source_by_lower = {name.lower(): name for name in source_outlets}
        source_lower = source_port_name.lower()
        side = CompilerService._stereo_side_for_source_port(source_lower, source_by_lower)
        if side:
            for candidate in ("left", "l") if side == "left" else ("right", "r"):
                sink_name = sink_by_lower.get(candidate)
                if sink_name:
                    return sink_name

        if len(source_outlets) == len(sink_inlets):
            source_index_by_name = {name: index for index, name in enumerate(source_outlets)}
            source_index = source_index_by_name.get(source_port_name)
            if source_index is not None and source_index < len(sink_inlets):
                return sink_inlets[source_index]

        return sink_inlets[0]

    @staticmethod
    def _stereo_side_for_source_port(source_lower: str, source_by_lower: dict[str, str]) -> str | None:
        if source_lower in {"left", "l"} or source_lower.endswith("left"):
            return "left"
        if source_lower in {"right", "r"} or source_lower.endswith("right"):
            return "right"
        if source_lower.endswith("l") and f"{source_lower[:-1]}r" in source_by_lower:
            return "left"
        if source_lower.endswith("r") and f"{source_lower[:-1]}l" in source_by_lower:
            return "right"
        return None

    @staticmethod
    def _validate_audio_route_graph(route_edges: list[tuple[str, str]]) -> None:
        adjacency: dict[str, set[str]] = {}
        for source_id, sink_id in route_edges:
            source = source_id.strip()
            sink = sink_id.strip()
            if not source or not sink:
                continue
            if source == sink:
                raise CompilationError(["Effect routing would create an audio feedback loop."])
            adjacency.setdefault(source, set()).add(sink)
            adjacency.setdefault(sink, set())

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visited:
                return
            if node_id in visiting:
                raise CompilationError(["Effect routing would create an audio feedback loop."])
            visiting.add(node_id)
            for next_id in adjacency.get(node_id, set()):
                visit(next_id)
            visiting.remove(node_id)
            visited.add(node_id)

        for node_id in adjacency:
            visit(node_id)

    @staticmethod
    def _always_on_lines(
        targets: list[PatchInstrumentTarget],
        instrument_names: list[str] | None,
    ) -> list[str]:
        if instrument_names is None:
            return []
        return [
            f"alwayson {OrchestraEmitter._format_csound_string(instrument_name)}"
            for target, instrument_name in zip(targets, instrument_names, strict=True)
            if target.always_on
        ]

    @staticmethod
    def _wrap_csd(
        orc: str,
        midi_input: str,
        rtmidi_module: str,
        software_buffer: int = 128,
        hardware_buffer: int = 512,
    ) -> str:
        return wrap_csd(
            orc,
            midi_input,
            rtmidi_module,
            software_buffer=software_buffer,
            hardware_buffer=hardware_buffer,
            runtime_platform=sys.platform,
        )
