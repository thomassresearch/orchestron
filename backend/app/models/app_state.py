from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field, JsonValue, field_validator


from backend.app.models.score_validation import validate_authored_scores
from backend.app.models.sample_player import validate_authored_samples
from backend.app.models.clip_validation import validate_authored_clips


class AppStateUpdateRequest(BaseModel):
    state: dict[str, JsonValue]


    @field_validator("state")
    @classmethod
    def validate_scores(cls, value):
        return validate_authored_samples(validate_authored_clips(validate_authored_scores(value)), recovery=True)


class AppStateResponse(BaseModel):
    state: dict[str, JsonValue]
    updated_at: datetime


class AppStateDocument(BaseModel):
    id: str = Field(default="last")
    state: dict[str, JsonValue]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
