from __future__ import annotations

import json
from datetime import timezone
from typing import Sequence

from sqlalchemy import desc, select

from backend.app.models.performance import PerformanceDocument
from backend.app.storage.db import PerformanceRecord


class PerformanceRepository:
    def __init__(self, db_session_factory):
        self._db_session_factory = db_session_factory

    def create(self, document: PerformanceDocument) -> PerformanceDocument:
        with self._db_session_factory() as db:
            record = PerformanceRecord(
                id=document.id,
                name=document.name,
                description=document.description,
                config_json=json.dumps(document.config),
                created_at=document.created_at,
                updated_at=document.updated_at,
            )
            db.add(record)
        return document

    def get(self, performance_id: str) -> PerformanceDocument | None:
        with self._db_session_factory() as db:
            record = db.get(PerformanceRecord, performance_id)
            if not record:
                return None
            return self._to_document(record)

    def list(self) -> Sequence[PerformanceDocument]:
        with self._db_session_factory() as db:
            stmt = select(PerformanceRecord).order_by(desc(PerformanceRecord.updated_at))
            return [self._to_document(record) for record in db.scalars(stmt).all()]

    def update(self, performance_id: str, document: PerformanceDocument) -> PerformanceDocument | None:
        with self._db_session_factory() as db:
            record = db.get(PerformanceRecord, performance_id)
            if not record:
                return None

            record.name = document.name
            record.description = document.description
            record.config_json = json.dumps(document.config)
            record.updated_at = document.updated_at
            db.add(record)
            return self._to_document(record)

    def delete(self, performance_id: str) -> bool:
        with self._db_session_factory() as db:
            record = db.get(PerformanceRecord, performance_id)
            if not record:
                return False
            db.delete(record)
        return True

    @staticmethod
    def _to_document(record: PerformanceRecord) -> PerformanceDocument:
        created_at = record.created_at
        updated_at = record.updated_at

        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        return PerformanceDocument(
            id=record.id,
            name=record.name,
            description=record.description,
            config=json.loads(record.config_json),
            created_at=created_at,
            updated_at=updated_at,
        )
