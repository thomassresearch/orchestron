from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.patch import PatchGraph
from backend.app.models.session import SessionSequencerConfigRequest


class ExportPerformanceInstrumentAssignment(BaseModel):
    patch_id: str = Field(alias="patchId", min_length=1)
    patch_name: str | None = Field(default=None, alias="patchName")
    midi_channel: int = Field(alias="midiChannel", ge=1, le=16)

    model_config = ConfigDict(populate_by_name=True)


class ExportPerformanceConfig(BaseModel):
    version: int = 1
    instruments: list[ExportPerformanceInstrumentAssignment] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class ExportedPatchDefinition(BaseModel):
    source_patch_id: str = Field(alias="sourcePatchId", min_length=1)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    schema_version: int = 1
    graph: PatchGraph

    model_config = ConfigDict(populate_by_name=True)


class ExportedPerformanceDocument(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    config: ExportPerformanceConfig


class PerformanceExportPayload(BaseModel):
    format: Literal["orchestron.performance"]
    version: Literal[1]
    exported_at: str
    performance: ExportedPerformanceDocument
    patch_definitions: list[ExportedPatchDefinition] = Field(default_factory=list)


class PerformanceCsdExportRequest(BaseModel):
    performance_export: PerformanceExportPayload = Field(alias="performanceExport")
    sequencer_config: SessionSequencerConfigRequest = Field(alias="sequencerConfig")

    model_config = ConfigDict(populate_by_name=True)
