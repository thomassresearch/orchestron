from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from backend.app.models.patch import (
    PatchCreateRequest,
    PatchDocument,
    PatchListItem,
    PatchResponse,
    PatchUpdateRequest,
)
from backend.app.storage.repositories.patch_repository import PatchRepository


class PatchService:
    def __init__(self, repository: PatchRepository):
        self._repository = repository

    def create_patch(self, request: PatchCreateRequest) -> PatchResponse:
        now = datetime.now(timezone.utc)
        document = PatchDocument(
            id=str(uuid4()),
            name=request.name,
            description=request.description,
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
            schema_version=request.schema_version if request.schema_version is not None else existing.schema_version,
            graph=request.graph if request.graph is not None else existing.graph,
            created_at=existing.created_at,
            updated_at=datetime.now(timezone.utc),
        )

        persisted = self._repository.update(patch_id, updated)
        if not persisted:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")

        return PatchResponse.model_validate(persisted.model_dump())

    def delete_patch(self, patch_id: str) -> None:
        deleted = self._repository.delete(patch_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Patch '{patch_id}' not found")
