from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from backend.app.models.performance import (
    PerformanceCreateRequest,
    PerformanceDocument,
    PerformanceListItem,
    PerformanceResponse,
    PerformanceUpdateRequest,
)
from backend.app.services.persisted_json_limits import (
    DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES,
    DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    PersistedJsonLimitError,
    assert_persisted_json_limits,
)
from backend.app.storage.repositories.performance_repository import PerformanceRepository


class PerformanceService:
    def __init__(
        self,
        repository: PerformanceRepository,
        *,
        max_config_bytes: int = DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES,
        max_string_bytes: int = DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    ):
        self._repository = repository
        self._max_config_bytes = max_config_bytes
        self._max_string_bytes = max_string_bytes

    def create_performance(self, request: PerformanceCreateRequest) -> PerformanceResponse:
        now = datetime.now(timezone.utc)
        self._validate_config(request.config)
        document = PerformanceDocument(
            id=str(uuid4()),
            name=request.name,
            description=request.description,
            config=request.config,
            created_at=now,
            updated_at=now,
        )
        self._repository.create(document)
        return PerformanceResponse.model_validate(document.model_dump())

    def get_performance(self, performance_id: str) -> PerformanceResponse:
        document = self._repository.get(performance_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Performance '{performance_id}' not found")
        return PerformanceResponse.model_validate(document.model_dump())

    def list_performances(self) -> list[PerformanceListItem]:
        documents = self._repository.list()
        return [
            PerformanceListItem(
                id=document.id,
                name=document.name,
                description=document.description,
                updated_at=document.updated_at,
            )
            for document in documents
        ]

    def update_performance(self, performance_id: str, request: PerformanceUpdateRequest) -> PerformanceResponse:
        existing = self._repository.get(performance_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Performance '{performance_id}' not found")

        updated = PerformanceDocument(
            id=existing.id,
            name=request.name if request.name is not None else existing.name,
            description=request.description if request.description is not None else existing.description,
            config=request.config if request.config is not None else existing.config,
            created_at=existing.created_at,
            updated_at=datetime.now(timezone.utc),
        )

        self._validate_config(updated.config)
        persisted = self._repository.update(performance_id, updated)
        if not persisted:
            raise HTTPException(status_code=404, detail=f"Performance '{performance_id}' not found")

        return PerformanceResponse.model_validate(persisted.model_dump())

    def delete_performance(self, performance_id: str) -> None:
        deleted = self._repository.delete(performance_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Performance '{performance_id}' not found")

    def _validate_config(self, config: dict) -> None:
        try:
            assert_persisted_json_limits(
                value=config,
                field_name="config",
                max_document_bytes=self._max_config_bytes,
                max_string_bytes=self._max_string_bytes,
            )
        except PersistedJsonLimitError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        except ValueError as err:
            raise HTTPException(status_code=422, detail="config must be serializable as JSON.") from err
