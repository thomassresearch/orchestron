from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field, JsonValue


class AppStateUpdateRequest(BaseModel):
    state: dict[str, JsonValue]


class AppStateResponse(BaseModel):
    state: dict[str, JsonValue]
    updated_at: datetime


class AppStateDocument(BaseModel):
    id: str = Field(default="last")
    state: dict[str, JsonValue]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
