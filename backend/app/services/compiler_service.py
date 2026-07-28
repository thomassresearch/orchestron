from __future__ import annotations

import sys

from backend.app.models.patch import PatchDocument
from backend.app.models.session import CompileArtifact
from backend.app.services.compiler_common import (
    CompiledInstrumentLines,
    CompilationError,
    PatchInstrumentTarget,
    SfloadGlobalRequest,
)
from backend.app.services.audio_routing_service import resolve_audio_routes
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

        instrument_name_by_assignment_id: dict[str, str] = {}
        for target, instrument_name in zip(targets, instrument_names, strict=True):
            if target.assignment_id:
                instrument_name_by_assignment_id[target.assignment_id] = instrument_name

        lines: list[str] = []
        for route in resolve_audio_routes(targets):
            source_name = instrument_name_by_assignment_id[route.source_assignment_id]
            target_name = instrument_name_by_assignment_id[route.target_assignment_id]
            lines.append(
                "connect "
                f"{OrchestraEmitter._format_csound_string(source_name)}, "
                f"{OrchestraEmitter._format_csound_string(route.source_port_name)}, "
                f"{OrchestraEmitter._format_csound_string(target_name)}, "
                f"{OrchestraEmitter._format_csound_string(route.target_port_name)}"
            )
        return lines

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
