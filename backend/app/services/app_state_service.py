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
from backend.app.services.arpeggiator_migration import migrate_arpeggiators
from backend.app.services.sequencer_timing_migration import migrate_sequencer_timing
from backend.app.services.master_migration import normalize_master_app_state, repository_lookup


class AppStateService:
    def __init__(
        self,
        repository: AppStateRepository,
        *,
        patch_repository=None,
        max_state_bytes: int = DEFAULT_APP_STATE_MAX_BYTES,
        max_string_bytes: int = DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
    ):
        self._repository = repository
        self._patch_lookup = repository_lookup(patch_repository)
        self._max_state_bytes = max_state_bytes
        self._max_string_bytes = max_string_bytes

    def get_last_state(self) -> AppStateResponse:
        document = self._repository.get("last")
        if not document:
            raise HTTPException(status_code=404, detail="App state not found")

        state = self._normalize_state(document.state)
        return AppStateResponse.model_construct(state=state, updated_at=document.updated_at)

    def save_last_state(self, request: AppStateUpdateRequest) -> AppStateResponse:
        created_at = self._repository.get_created_at("last")
        now = datetime.now(timezone.utc)

        self._validate_state(request.state)
        state = self._normalize_state(request.state)
        if state is not request.state:
            self._validate_state(state)
        # JsonValue validation already happened on AppStateUpdateRequest. Keep
        # this same validated tree instead of rebuilding it for every wrapper.
        document = AppStateDocument.model_construct(
            id="last",
            state=state,
            created_at=created_at or now,
            updated_at=now,
        )
        persisted = self._repository.upsert(document)
        return AppStateResponse.model_construct(state=persisted.state, updated_at=persisted.updated_at)

    def _normalize_state(self, state: dict) -> dict:
        try:
            normalized = normalize_master_app_state(state, self._patch_lookup)
            result = migrate_arpeggiators(normalized)
            if result is not normalized:
                result["version"] = normalized.get("version", 1)
            return migrate_sequencer_timing(result, app_state=True)
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err

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
