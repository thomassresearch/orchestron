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
from backend.app.services.compiler_graph import compile_graph_context, resolve_shared_engine, validate_target_channels
from backend.app.services.compiler_orchestra import OrchestraEmitter, wrap_csd
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.opcode_service import OpcodeService


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

        validate_target_channels(targets)
        engine = resolve_shared_engine(targets)

        orc_lines = [
            f"sr = {engine.sr}",
            f"ksmps = {engine.ksmps}",
            f"nchnls = {engine.nchnls}",
            f"0dbfs = {engine.zero_dbfs}",
            "",
            *self._orchestra_emitter.massign_lines(targets),
            "",
        ]

        compiled_instruments: list[tuple[int, PatchInstrumentTarget, CompiledInstrumentLines]] = []
        global_header_lines: list[str] = []
        sfload_global_requests: list[SfloadGlobalRequest] = []

        for instrument_number, target in enumerate(targets, start=1):
            graph_context = compile_graph_context(target.patch.graph, self._opcode_service)
            compiled_lines = self._orchestra_emitter.compile_instrument_lines(
                target.patch,
                graph_context=graph_context,
                instrument_number=instrument_number,
                global_scope_key=f"{instrument_number}_{target.patch.id}",
            )
            compiled_instruments.append((instrument_number, target, compiled_lines))
            global_header_lines.extend(compiled_lines.global_header_lines)
            sfload_global_requests.extend(compiled_lines.sfload_global_requests)

        if global_header_lines:
            orc_lines.extend([*global_header_lines, ""])

        global_sfload_lines = self._orchestra_emitter.render_sfload_global_requests(sfload_global_requests)
        if global_sfload_lines:
            orc_lines.extend([*global_sfload_lines, ""])

        for instrument_number, target, compiled_lines in compiled_instruments:
            orc_lines.extend(
                [
                    f"; patch:{target.patch.id} name:{target.patch.name} channel:{target.midi_channel}",
                    f"instr {instrument_number}",
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
        return CompileArtifact(orc=orc, csd=csd, diagnostics=[])

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
