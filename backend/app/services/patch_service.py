from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from backend.app.models.patch import (
    PatchCreateRequest,
    PatchDocument,
    PatchGraph,
    PatchListItem,
    PatchResponse,
    PatchUpdateRequest,
)
from backend.app.services.persisted_json_limits import (
    DEFAULT_PATCH_GRAPH_MAX_BYTES,
    DEFAULT_PATCH_UI_LAYOUT_MAX_BYTES,
    DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    PersistedJsonLimitError,
    assert_persisted_json_limits,
)
from backend.app.services.audio_port_names import audio_port_names
from backend.app.storage.repositories.patch_repository import PatchRepository

ALWAYS_ON_REQUIRES_INLETA_MESSAGE = 'always on instruments require at least one "inleta" instance'


class PatchService:
    def __init__(
        self,
        repository: PatchRepository,
        *,
        max_graph_bytes: int = DEFAULT_PATCH_GRAPH_MAX_BYTES,
        max_ui_layout_bytes: int = DEFAULT_PATCH_UI_LAYOUT_MAX_BYTES,
        max_string_bytes: int = DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    ):
        self._repository = repository
        self._max_graph_bytes = max_graph_bytes
        self._max_ui_layout_bytes = max_ui_layout_bytes
        self._max_string_bytes = max_string_bytes

    def create_patch(self, request: PatchCreateRequest) -> PatchResponse:
        now = datetime.now(timezone.utc)
        self._validate_graph(request.graph)
        self._validate_always_on_requirements(always_on=request.always_on, graph=request.graph)
        document = PatchDocument(
            id=str(uuid4()),
            name=request.name,
            description=request.description,
            is_template=request.is_template,
            always_on=request.always_on,
            schema_version=request.schema_version,
            graph=request.graph,
            created_at=now,
            updated_at=now,
        )
        self._repository.create(document)
        return PatchResponse.model_validate(document.model_dump())

    def get_patch(self, patch_id: str) -> PatchResponse:
        document = self._repository.get(patch_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")
        return PatchResponse.model_validate(document.model_dump())

    def get_patch_document(self, patch_id: str) -> PatchDocument:
        document = self._repository.get(patch_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")
        return document

    def list_patches(self) -> list[PatchListItem]:
        documents = self._repository.list()
        return [
            PatchListItem(
                id=document.id,
                name=document.name,
                description=document.description,
                is_template=document.is_template,
                always_on=document.always_on,
                audio_inlet_names=audio_port_names(document.graph, opcode="inleta"),
                audio_outlet_names=audio_port_names(document.graph, opcode="outleta"),
                schema_version=document.schema_version,
                updated_at=document.updated_at,
            )
            for document in documents
        ]

    def update_patch(self, patch_id: str, request: PatchUpdateRequest) -> PatchResponse:
        existing = self._repository.get(patch_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")

        updated = PatchDocument(
            id=existing.id,
            name=request.name if request.name is not None else existing.name,
            description=request.description if request.description is not None else existing.description,
            is_template=request.is_template if request.is_template is not None else existing.is_template,
            always_on=request.always_on if request.always_on is not None else existing.always_on,
            schema_version=request.schema_version if request.schema_version is not None else existing.schema_version,
            graph=request.graph if request.graph is not None else existing.graph,
            created_at=existing.created_at,
            updated_at=datetime.now(timezone.utc),
        )

        self._validate_graph(updated.graph)
        self._validate_always_on_requirements(always_on=updated.always_on, graph=updated.graph)
        persisted = self._repository.update(patch_id, updated)
        if not persisted:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")

        return PatchResponse.model_validate(persisted.model_dump())

    def delete_patch(self, patch_id: str) -> None:
        deleted = self._repository.delete(patch_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")

    def _validate_graph(self, graph: PatchGraph) -> None:
        try:
            assert_persisted_json_limits(
                value=graph.ui_layout,
                field_name="graph.ui_layout",
                max_document_bytes=self._max_ui_layout_bytes,
                max_string_bytes=self._max_string_bytes,
            )
            assert_persisted_json_limits(
                value=graph.model_dump(mode="json"),
                field_name="graph",
                max_document_bytes=self._max_graph_bytes,
                max_string_bytes=self._max_string_bytes,
            )
        except PersistedJsonLimitError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        except ValueError as err:
            raise HTTPException(status_code=422, detail="graph must be serializable as JSON.") from err

    @staticmethod
    def _validate_always_on_requirements(*, always_on: bool, graph: PatchGraph) -> None:
        if always_on and not any(node.opcode == "inleta" for node in graph.nodes):
            raise HTTPException(status_code=422, detail=ALWAYS_ON_REQUIRES_INLETA_MESSAGE)
