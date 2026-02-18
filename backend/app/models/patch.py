from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field, JsonValue, field_validator, model_validator

from backend.app.models.opcode import SignalType

PatchParam = str | int | float | bool

AUDIO_RATE_MIN = 22_000
AUDIO_RATE_MAX = 48_000
CONTROL_RATE_MIN = 25
CONTROL_RATE_MAX = 48_000


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
    sr: int = 44_100
    control_rate: int = 4_400
    ksmps: int = 10
    nchnls: int = 2
    zero_dbfs: float = Field(default=1.0, alias="0dbfs")

    model_config = {"populate_by_name": True}

    @field_validator("sr")
    @classmethod
    def validate_sr_range(cls, value: int) -> int:
        if value < AUDIO_RATE_MIN or value > AUDIO_RATE_MAX:
            raise ValueError(f"Audio sample rate must be between {AUDIO_RATE_MIN} and {AUDIO_RATE_MAX}.")
        return value

    @field_validator("control_rate")
    @classmethod
    def validate_control_rate_range(cls, value: int) -> int:
        if value < CONTROL_RATE_MIN or value > CONTROL_RATE_MAX:
            raise ValueError(
                f"Control sample rate must be between {CONTROL_RATE_MIN} and {CONTROL_RATE_MAX}."
            )
        return value

    @field_validator("ksmps")
    @classmethod
    def validate_ksmps(cls, value: int) -> int:
        if value < 1:
            raise ValueError("ksmps must be >= 1.")
        return value

    @model_validator(mode="after")
    def sync_rates(self) -> "EngineConfig":
        fields = self.model_fields_set
        if "control_rate" not in fields and "ksmps" in fields and self.ksmps > 0:
            derived_control_rate = round(self.sr / self.ksmps)
            if CONTROL_RATE_MIN <= derived_control_rate <= CONTROL_RATE_MAX:
                self.control_rate = derived_control_rate

        self.ksmps = max(1, round(self.sr / self.control_rate))
        return self


class PatchGraph(BaseModel):
    nodes: list[NodeInstance] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    ui_layout: dict[str, JsonValue] = Field(default_factory=dict)
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
