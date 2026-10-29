from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field, JsonValue, field_validator


from backend.app.models.score_validation import validate_authored_scores


class PerformanceBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_048)
    config: dict[str, JsonValue]


    @field_validator("config")
    @classmethod
    def validate_scores(cls, value):
        return validate_authored_scores(value)


class PerformanceCreateRequest(PerformanceBase):
    pass


class PerformanceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2_048)
    config: dict[str, JsonValue] | None = None


    @field_validator("config")
    @classmethod
    def validate_scores(cls, value):
        return validate_authored_scores(value)


class MasterRepairRequest(BaseModel):
    config: dict[str, JsonValue]


    @field_validator("config")
    @classmethod
    def validate_scores(cls, value):
        return validate_authored_scores(value)


class PerformanceResponse(PerformanceBase):
    id: str
    created_at: datetime
    updated_at: datetime


class PerformanceListItem(BaseModel):
    id: str
    name: str
    description: str
    updated_at: datetime


class PerformanceDocument(PerformanceBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
