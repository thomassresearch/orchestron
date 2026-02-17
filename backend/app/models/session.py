from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field


class SessionState(StrEnum):
    IDLE = "idle"
    COMPILED = "compiled"
    RUNNING = "running"
    ERROR = "error"


class SessionCreateRequest(BaseModel):
    patch_id: str = Field(min_length=1)


class SessionCreateResponse(BaseModel):
    session_id: str
    patch_id: str
    state: SessionState


class SessionInfo(BaseModel):
    session_id: str
    patch_id: str
    state: SessionState
    midi_input: str | None = None
    created_at: datetime
    started_at: datetime | None = None


class CompileResponse(BaseModel):
    session_id: str
    state: SessionState
    orc: str
    csd: str
    diagnostics: list[str] = Field(default_factory=list)


class SessionActionResponse(BaseModel):
    session_id: str
    state: SessionState
    detail: str


class MidiInputRef(BaseModel):
    id: str
    name: str
    backend: str


class BindMidiInputRequest(BaseModel):
    midi_input: str = Field(min_length=1)


class SessionEvent(BaseModel):
    session_id: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    type: str
    payload: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


@dataclass
class CompileArtifact:
    orc: str
    csd: str
    diagnostics: list[str] = field(default_factory=list)
