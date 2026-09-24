"""Apply a confirmed import using one database transaction and one asset batch."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from backend.app.core.container import AppContainer
from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchCreateRequest, PatchUpdateRequest
from backend.app.models.performance import PerformanceCreateRequest, PerformanceUpdateRequest
from backend.app.services.patch_service import PatchService
from backend.app.services.performance_service import PerformanceService
from backend.app.storage.repositories.patch_repository import PatchRepository
from backend.app.storage.repositories.performance_repository import PerformanceRepository


class ImportPatchOperation(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    sourcePatchId: str = Field(min_length=1)
    type: Literal["create", "update"]
    name: str = Field(min_length=1, max_length=128)


class ImportPerformanceOperation(BaseModel):
    type: Literal["create", "update"]
    performanceId: str | None = None
    payload: PerformanceCreateRequest


class BundleImportPlan(BaseModel):
    patches: list[ImportPatchOperation] = Field(default_factory=list, max_length=512)
    performance: ImportPerformanceOperation | None = None

    @model_validator(mode="after")
    def unique_targets(self):
        if len({p.id for p in self.patches}) != len(self.patches):
            raise ValueError("Import operations must have unique target IDs.")
        if len({p.sourcePatchId for p in self.patches}) != len(self.patches):
            raise ValueError("Import operations must have unique source IDs.")
        return self


def import_definitions(payload: object) -> list[ExportedPatchDefinition]:
    if not isinstance(payload, dict):
        return []
    raw = payload.get("patch_definitions", payload.get("patchDefinitions", []))
    if "sourcePatchId" in payload:
        raw = [payload]
    if not isinstance(raw, list):
        raise ValueError("Patch definitions must be an array.")
    definitions = [ExportedPatchDefinition.model_validate(item) for item in raw]
    if len({d.source_patch_id.strip() for d in definitions}) != len(definitions):
        raise ValueError("Patch definitions must have unique sourcePatchId values.")
    return definitions


def apply_import_plan(container: AppContainer, plan: BundleImportPlan, payload: object) -> dict:
    definitions = {d.source_patch_id: d for d in import_definitions(payload)}
    settings = container.settings
    with container.database.session() as db:

        @contextmanager
        def transaction():
            yield db
            # Repository calls share this transaction, including reads of new rows.
            db.flush()

        patches = PatchRepository(transaction)
        patch_service = PatchService(
            patches,
            max_graph_bytes=settings.patch_graph_max_bytes,
            max_ui_layout_bytes=settings.patch_ui_layout_max_bytes,
            max_string_bytes=settings.persisted_json_string_max_bytes,
        )
        performances = PerformanceService(
            PerformanceRepository(transaction),
            patch_repository=patches,
            max_config_bytes=settings.performance_config_max_bytes,
            max_string_bytes=settings.persisted_json_string_max_bytes,
        )
        imported = []
        for operation in plan.patches:
            definition = definitions.get(operation.sourcePatchId)
            if definition is None:
                raise ValueError(f"Unknown import source '{operation.sourcePatchId}'.")
            data = definition.model_dump(exclude={"source_patch_id"})
            data["name"] = operation.name
            if operation.type == "create":
                if patches.get(operation.id) is not None:
                    raise HTTPException(status_code=409, detail="Import target already exists; retry the import.")
                result = patch_service.create_patch(PatchCreateRequest.model_validate(data), patch_id=operation.id)
            else:
                result = patch_service.update_patch(operation.id, PatchUpdateRequest.model_validate(data))
            imported.append(result.model_dump(mode="json", by_alias=True))
        performance = None
        if plan.performance:
            operation = plan.performance
            if operation.type == "create":
                result = performances.create_performance(operation.payload)
            else:
                if not operation.performanceId:
                    raise ValueError("An update requires a performance ID.")
                result = performances.update_performance(
                    operation.performanceId, PerformanceUpdateRequest.model_validate(operation.payload.model_dump())
                )
            performance = result.model_dump(mode="json", by_alias=True)
    return {"patches": imported, "performance": performance}
