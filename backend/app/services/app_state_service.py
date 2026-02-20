from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from backend.app.models.app_state import AppStateDocument, AppStateResponse, AppStateUpdateRequest
from backend.app.storage.repositories.app_state_repository import AppStateRepository


class AppStateService:
    def __init__(self, repository: AppStateRepository):
        self._repository = repository

    def get_last_state(self) -> AppStateResponse:
        document = self._repository.get("last")
        if not document:
            raise HTTPException(status_code=404, detail="App state not found")

        return AppStateResponse(state=document.state, updated_at=document.updated_at)

    def save_last_state(self, request: AppStateUpdateRequest) -> AppStateResponse:
        existing = self._repository.get("last")
        now = datetime.now(timezone.utc)

        document = AppStateDocument(
            id="last",
            state=request.state,
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        persisted = self._repository.upsert(document)
        return AppStateResponse(state=persisted.state, updated_at=persisted.updated_at)
