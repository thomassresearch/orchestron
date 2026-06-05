from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from backend.app.models.app_state import AppStateDocument, AppStateResponse, AppStateUpdateRequest
from backend.app.services.persisted_json_limits import (
    DEFAULT_APP_STATE_MAX_BYTES,
    DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    PersistedJsonLimitError,
    assert_persisted_json_limits,
)
from backend.app.storage.repositories.app_state_repository import AppStateRepository


class AppStateService:
    def __init__(
        self,
        repository: AppStateRepository,
        *,
        max_state_bytes: int = DEFAULT_APP_STATE_MAX_BYTES,
        max_string_bytes: int = DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    ):
        self._repository = repository
        self._max_state_bytes = max_state_bytes
        self._max_string_bytes = max_string_bytes

    def get_last_state(self) -> AppStateResponse:
        document = self._repository.get("last")
        if not document:
            raise HTTPException(status_code=404, detail="App state not found")

        return AppStateResponse(state=document.state, updated_at=document.updated_at)

    def save_last_state(self, request: AppStateUpdateRequest) -> AppStateResponse:
        existing = self._repository.get("last")
        now = datetime.now(timezone.utc)

        self._validate_state(request.state)
        document = AppStateDocument(
            id="last",
            state=request.state,
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        persisted = self._repository.upsert(document)
        return AppStateResponse(state=persisted.state, updated_at=persisted.updated_at)

    def _validate_state(self, state: dict) -> None:
        try:
            assert_persisted_json_limits(
                value=state,
                field_name="state",
                max_document_bytes=self._max_state_bytes,
                max_string_bytes=self._max_string_bytes,
            )
        except PersistedJsonLimitError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        except ValueError as err:
            raise HTTPException(status_code=422, detail="state must be serializable as JSON.") from err
