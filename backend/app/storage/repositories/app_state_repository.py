from __future__ import annotations

import json

from backend.app.models.app_state import AppStateDocument
from backend.app.services.persisted_json_limits import dump_compact_json
from backend.app.storage.db import AppStateRecord
from backend.app.storage.repositories.contracts import DbSessionFactory, ensure_utc


class AppStateRepository:
    def __init__(self, db_session_factory: DbSessionFactory) -> None:
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
                    state_json=dump_compact_json(document.state),
                    created_at=document.created_at,
                    updated_at=document.updated_at,
                )
            else:
                record.state_json = dump_compact_json(document.state)
                record.updated_at = document.updated_at
            db.add(record)
            return self._to_document(record)

    @staticmethod
    def _to_document(record: AppStateRecord) -> AppStateDocument:
        return AppStateDocument(
            id=record.id,
            state=json.loads(record.state_json),
            created_at=ensure_utc(record.created_at),
            updated_at=ensure_utc(record.updated_at),
        )
