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
            *self._orchestra_emitter.massign_lines(targets, instrument_names=instrument_names),
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
                instrument_name=instrument_names[instrument_number - 1] if instrument_names is not None else None,
                global_scope_key=f"{instrument_number}_{target.patch.id}",
                allow_packaged_asset_paths=allow_packaged_asset_paths,
            )
            compiled_instruments.append((instrument_number, target, compiled_lines))
            global_header_lines.extend(compiled_lines.global_header_lines)
            sfload_global_requests.extend(compiled_lines.sfload_global_requests)

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
        return CompileArtifact(orc=orc, csd=csd, diagnostics=[])

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
        for sink_target, sink_name in zip(targets, instrument_names, strict=True):
            if not sink_target.always_on or not (sink_target.effect_routes or sink_target.effect_source_ids):
                continue
            sink_inlets = set(audio_port_names(sink_target.patch.graph, opcode="inleta"))
            if not sink_inlets:
                continue

            for source_id, port_name in self._effect_route_pairs(sink_target, source_by_assignment_id, sink_inlets):
                source_entry = source_by_assignment_id.get(source_id)
                if source_entry is None:
                    continue
                source_target, source_name = source_entry
                if source_target.always_on:
                    continue

                if port_name not in set(audio_port_names(source_target.patch.graph, opcode="outleta")):
                    continue
                lines.append(
                    "connect "
                    f"{OrchestraEmitter._format_csound_string(source_name)}, "
                    f"{OrchestraEmitter._format_csound_string(port_name)}, "
                    f"{OrchestraEmitter._format_csound_string(sink_name)}, "
                    f"{OrchestraEmitter._format_csound_string(port_name)}"
                )
        return lines

    def _effect_route_pairs(
        self,
        sink_target: PatchInstrumentTarget,
        source_by_assignment_id: dict[str, tuple[PatchInstrumentTarget, str]],
        sink_inlets: set[str],
    ) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()

        for source_id, port_name in sink_target.effect_routes:
            normalized_source_id = source_id.strip()
            normalized_port_name = port_name.strip()
            key = (normalized_source_id, normalized_port_name)
            if not normalized_source_id or normalized_port_name not in sink_inlets or key in seen:
                continue
            seen.add(key)
            pairs.append(key)

        for source_id in sink_target.effect_source_ids:
            normalized_source_id = source_id.strip()
            source_entry = source_by_assignment_id.get(normalized_source_id)
            if source_entry is None:
                continue
            source_target, _source_name = source_entry
            if source_target.always_on:
                continue
            for port_name in sorted(set(audio_port_names(source_target.patch.graph, opcode="outleta")) & sink_inlets):
                key = (normalized_source_id, port_name)
                if key in seen:
                    continue
                seen.add(key)
                pairs.append(key)

        return pairs

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
