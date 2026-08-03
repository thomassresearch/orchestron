from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException

from backend.app.models.patch import PatchDocument
from backend.app.models.session import (
    SessionCreateRequest,
    SessionEffectRoute,
    SessionInstrumentAssignment,
)
from backend.app.services.audio_routing_service import ResolvedAudioRoute, resolve_audio_routes
from backend.app.services.compiler_common import CompilationError, PatchInstrumentTarget


class PatchDocumentLookup(Protocol):
    def get_patch_document(self, patch_id: str) -> PatchDocument: ...


class SessionInstrumentResolver:
    """Validates instrument assignments and translates them into compiler targets."""

    def __init__(self, patch_service: PatchDocumentLookup) -> None:
        self._patch_service = patch_service

    @staticmethod
    def resolve_request(request: SessionCreateRequest) -> list[SessionInstrumentAssignment]:
        if request.instruments:
            return list(request.instruments)
        if request.patch_id:
            return [SessionInstrumentAssignment(patch_id=request.patch_id, midi_channel=1)]
        raise HTTPException(status_code=422, detail="Session requires at least one instrument patch.")

    def normalize(
        self,
        instruments: list[SessionInstrumentAssignment],
    ) -> list[SessionInstrumentAssignment]:
        normalized: list[SessionInstrumentAssignment] = []
        seen_channels: set[int] = set()

        for index, assignment in enumerate(instruments):
            patch = self._runtime_patch(assignment.patch_id)
            assignment_id = assignment.id or f"rack-{index + 1}"
            if patch.always_on:
                effect_routes = self._unique_effect_routes(
                    assignment.effect_routes,
                    assignment_id=assignment_id,
                )
                source_ids = self._unique_effect_source_ids(
                    [
                        *assignment.effect_source_ids,
                        *(route.source_id for route in effect_routes),
                    ],
                    assignment_id=assignment_id,
                )
                normalized.append(
                    SessionInstrumentAssignment(
                        id=assignment_id,
                        patch_id=assignment.patch_id,
                        midi_channel=0,
                        effect_source_ids=source_ids,
                        effect_routes=effect_routes,
                    )
                )
                continue

            if assignment.effect_source_ids or assignment.effect_routes:
                raise HTTPException(
                    status_code=422,
                    detail=f"Patch '{patch.name}' is not always-on and cannot receive effect routes.",
                )
            midi_channel = int(assignment.midi_channel)
            if midi_channel < 1 or midi_channel > 16:
                raise HTTPException(
                    status_code=422,
                    detail=f"Patch '{patch.name}' is not always-on and requires a MIDI channel from 1 to 16.",
                )
            if midi_channel in seen_channels:
                raise HTTPException(
                    status_code=422,
                    detail=f"MIDI channel '{midi_channel}' is assigned more than once.",
                )
            seen_channels.add(midi_channel)
            normalized.append(
                SessionInstrumentAssignment(
                    id=assignment_id,
                    patch_id=assignment.patch_id,
                    midi_channel=midi_channel,
                    effect_source_ids=[],
                    effect_routes=[],
                )
            )

        if not normalized:
            raise HTTPException(status_code=422, detail="Session requires at least one instrument patch.")
        return normalized

    def compile_target(self, assignment: SessionInstrumentAssignment) -> PatchInstrumentTarget:
        patch = self._runtime_patch(assignment.patch_id)
        return PatchInstrumentTarget(
            patch=patch,
            midi_channel=0 if patch.always_on else assignment.midi_channel,
            assignment_id=assignment.id,
            always_on=patch.always_on,
            effect_source_ids=tuple(assignment.effect_source_ids if patch.always_on else []),
            effect_routes=tuple(
                (route.source_id, route.channel)
                for route in assignment.effect_routes
                if patch.always_on
            ),
        )

    def resolve_audio_routes(
        self,
        instruments: list[SessionInstrumentAssignment],
    ) -> list[ResolvedAudioRoute]:
        targets = [self.compile_target(assignment) for assignment in instruments]
        try:
            return resolve_audio_routes(targets)
        except CompilationError as error:
            raise HTTPException(status_code=422, detail={"diagnostics": error.diagnostics}) from error

    def _runtime_patch(self, patch_id: str) -> PatchDocument:
        patch = self._patch_service.get_patch_document(patch_id)
        if patch.is_template:
            raise HTTPException(
                status_code=422,
                detail=f"Patch '{patch.name}' is a template and cannot be used as a performance instrument.",
            )
        return patch

    @staticmethod
    def _unique_effect_source_ids(source_ids: list[str], *, assignment_id: str) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for source_id in source_ids:
            normalized = source_id.strip()
            if not normalized:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "diagnostics": [
                            f"Effect route target '{assignment_id}' contains an empty source assignment id."
                        ]
                    },
                )
            if normalized in seen:
                continue
            seen.add(normalized)
            result.append(normalized)
        return result

    @staticmethod
    def _unique_effect_routes(
        effect_routes: list[SessionEffectRoute],
        *,
        assignment_id: str,
    ) -> list[SessionEffectRoute]:
        result: list[SessionEffectRoute] = []
        seen: set[tuple[str, str]] = set()
        for route in effect_routes:
            source_id = route.source_id.strip()
            channel = route.channel.strip()
            if not source_id:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "diagnostics": [
                            f"Effect route target '{assignment_id}' contains an empty source assignment id."
                        ]
                    },
                )
            if not channel:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "diagnostics": [
                            f"Effect route from source assignment '{source_id}' to target "
                            f"'{assignment_id}' contains an empty outlet label."
                        ]
                    },
                )
            key = (source_id, channel)
            if key in seen:
                continue
            seen.add(key)
            result.append(route.model_copy(update={"source_id": source_id, "channel": channel}))
        return result
