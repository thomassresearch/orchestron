from __future__ import annotations

import json
from datetime import timezone

from backend.app.models.app_state import AppStateDocument
from backend.app.storage.db import AppStateRecord


class AppStateRepository:
    def __init__(self, db_session_factory):
        self._db_session_factory = db_session_factory

    def get(self, state_id: str = "last") -> AppStateDocument | None:
        with self._db_session_factory() as db:
            record = db.get(AppStateRecord, state_id)
            if not record:
                return None
            return self._to_document(record)

    def upsert(self, document: AppStateDocument) -> AppStateDocument:
        with self._db_session_factory() as db:
            record = db.get(AppStateRecord, document.id)
            if not record:
                record = AppStateRecord(
                    id=document.id,
                    state_json=json.dumps(document.state),
                    created_at=document.created_at,
                    updated_at=document.updated_at,
                )
            else:
                record.state_json = json.dumps(document.state)
                record.updated_at = document.updated_at
            db.add(record)
            return self._to_document(record)

    @staticmethod
    def _to_document(record: AppStateRecord) -> AppStateDocument:
        created_at = record.created_at
        updated_at = record.updated_at

        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        return AppStateDocument(
            id=record.id,
            state=json.loads(record.state_json),
            created_at=created_at,
            updated_at=updated_at,
        )
