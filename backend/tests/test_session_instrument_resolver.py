from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.models.patch import PatchDocument, PatchGraph
from backend.app.models.session import (
    SessionCreateRequest,
    SessionEffectRoute,
    SessionInstrumentAssignment,
)
from backend.app.services.session_instrument_resolver import SessionInstrumentResolver


class PatchLookup:
    def __init__(self, patches: list[PatchDocument]) -> None:
        self._patches = {patch.id: patch for patch in patches}

    def get_patch_document(self, patch_id: str) -> PatchDocument:
        return self._patches[patch_id]


def patch_document(
    patch_id: str,
    *,
    always_on: bool = False,
    is_template: bool = False,
) -> PatchDocument:
    return PatchDocument(
        id=patch_id,
        name=patch_id,
        always_on=always_on,
        is_template=is_template,
        graph=PatchGraph(),
    )


def resolver_for(*patches: PatchDocument) -> SessionInstrumentResolver:
    return SessionInstrumentResolver(PatchLookup(list(patches)))


def test_resolve_request_supports_legacy_single_patch_sessions() -> None:
    request = SessionCreateRequest(patch_id="instrument")

    assignments = SessionInstrumentResolver.resolve_request(request)

    assert assignments == [SessionInstrumentAssignment(patch_id="instrument", midi_channel=1)]


def test_normalize_assigns_ids_and_canonicalizes_always_on_routes() -> None:
    instrument = patch_document("instrument")
    effect = patch_document("effect", always_on=True)
    resolver = resolver_for(instrument, effect)

    normalized = resolver.normalize(
        [
            SessionInstrumentAssignment(patch_id=instrument.id, midi_channel=2),
            SessionInstrumentAssignment(
                id="fx",
                patch_id=effect.id,
                midi_channel=9,
                effect_source_ids=[" source ", "source"],
                effect_routes=[
                    SessionEffectRoute(source_id=" source ", channel=" left "),
                    SessionEffectRoute(source_id="source", channel="left"),
                ],
            ),
        ]
    )

    assert normalized[0] == SessionInstrumentAssignment(
        id="rack-1",
        patch_id=instrument.id,
        midi_channel=2,
    )
    assert normalized[1] == SessionInstrumentAssignment(
        id="fx",
        patch_id=effect.id,
        midi_channel=0,
        effect_source_ids=["source"],
        effect_routes=[SessionEffectRoute(source_id="source", channel="left")],
    )


def test_normalize_rejects_duplicate_performance_midi_channels() -> None:
    first = patch_document("first")
    second = patch_document("second")
    resolver = resolver_for(first, second)

    with pytest.raises(HTTPException, match="assigned more than once") as error:
        resolver.normalize(
            [
                SessionInstrumentAssignment(patch_id=first.id, midi_channel=3),
                SessionInstrumentAssignment(patch_id=second.id, midi_channel=3),
            ]
        )

    assert error.value.status_code == 422


def test_compile_target_rejects_template_patches() -> None:
    template = patch_document("template", is_template=True)
    resolver = resolver_for(template)

    with pytest.raises(HTTPException, match="template") as error:
        resolver.compile_target(SessionInstrumentAssignment(patch_id=template.id, midi_channel=1))

    assert error.value.status_code == 422
