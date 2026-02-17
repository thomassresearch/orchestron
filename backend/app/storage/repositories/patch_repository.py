from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import desc, select

from backend.app.models.patch import PatchDocument, PatchGraph
from backend.app.storage.db import PatchRecord


class PatchRepository:
    def __init__(self, db_session_factory):
        self._db_session_factory = db_session_factory

    def create(self, document: PatchDocument) -> PatchDocument:
        with self._db_session_factory() as db:
            record = PatchRecord(
                id=document.id,
                name=document.name,
                description=document.description,
                schema_version=document.schema_version,
                graph_json=document.graph.model_dump_json(),
                created_at=document.created_at,
                updated_at=document.updated_at,
            )
            db.add(record)
        return document

    def get(self, patch_id: str) -> PatchDocument | None:
        with self._db_session_factory() as db:
            record = db.get(PatchRecord, patch_id)
            if not record:
                return None
            return self._to_document(record)

    def list(self) -> Sequence[PatchDocument]:
        with self._db_session_factory() as db:
            stmt = select(PatchRecord).order_by(desc(PatchRecord.updated_at))
            return [self._to_document(record) for record in db.scalars(stmt).all()]

    def update(self, patch_id: str, document: PatchDocument) -> PatchDocument | None:
        with self._db_session_factory() as db:
            record = db.get(PatchRecord, patch_id)
            if not record:
                return None

            record.name = document.name
            record.description = document.description
            record.schema_version = document.schema_version
            record.graph_json = document.graph.model_dump_json()
            record.updated_at = document.updated_at
            db.add(record)

            return self._to_document(record)

    def delete(self, patch_id: str) -> bool:
        with self._db_session_factory() as db:
            record = db.get(PatchRecord, patch_id)
            if not record:
                return False
            db.delete(record)
        return True

    @staticmethod
    def _to_document(record: PatchRecord) -> PatchDocument:
        created_at = record.created_at
        updated_at = record.updated_at

        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        return PatchDocument(
            id=record.id,
            name=record.name,
            description=record.description,
            schema_version=record.schema_version,
            graph=PatchGraph.model_validate(json.loads(record.graph_json)),
            created_at=created_at,
            updated_at=updated_at,
        )
