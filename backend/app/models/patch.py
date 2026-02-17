from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.app.models.opcode import SignalType

PatchParam = str | int | float | bool


class NodePortRef(BaseModel):
    id: str = Field(min_length=1)
    signal_type: SignalType


class NodePosition(BaseModel):
    x: float = 0.0
    y: float = 0.0


class NodeInstance(BaseModel):
    id: str = Field(min_length=1)
    opcode: str = Field(min_length=1)
    params: dict[str, PatchParam] = Field(default_factory=dict)
    position: NodePosition = Field(default_factory=NodePosition)


class Connection(BaseModel):
    from_node_id: str = Field(min_length=1)
    from_port_id: str = Field(min_length=1)
    to_node_id: str = Field(min_length=1)
    to_port_id: str = Field(min_length=1)


class EngineConfig(BaseModel):
    sr: int = 48_000
    ksmps: int = 64
    nchnls: int = 2
    zero_dbfs: float = Field(default=1.0, alias="0dbfs")

    model_config = {"populate_by_name": True}


class PatchGraph(BaseModel):
    nodes: list[NodeInstance] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    ui_layout: dict[str, str | int | float | bool] = Field(default_factory=dict)
    engine_config: EngineConfig = Field(default_factory=EngineConfig)

    @field_validator("nodes")
    @classmethod
    def validate_node_count(cls, nodes: list[NodeInstance]) -> list[NodeInstance]:
        if len(nodes) > 500:
            raise ValueError("Patch exceeds maximum node count (500)")
        return nodes

    @field_validator("connections")
    @classmethod
    def validate_connection_count(cls, connections: list[Connection]) -> list[Connection]:
        if len(connections) > 2_000:
            raise ValueError("Patch exceeds maximum connection count (2000)")
        return connections

    @model_validator(mode="after")
    def validate_unique_node_ids(self) -> "PatchGraph":
        ids = [node.id for node in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("Node IDs must be unique")
        return self


class PatchBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    schema_version: int = 1
    graph: PatchGraph


class PatchCreateRequest(PatchBase):
    pass


class PatchUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2_048)
    graph: PatchGraph | None = None
    schema_version: int | None = None


class PatchResponse(PatchBase):
    id: str
    created_at: datetime
    updated_at: datetime


class PatchListItem(BaseModel):
    id: str
    name: str
    description: str
    schema_version: int
    updated_at: datetime


class PatchDocument(PatchBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
