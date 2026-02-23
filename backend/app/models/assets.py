from __future__ import annotations

from pydantic import BaseModel, Field


class GenAudioAssetUploadResponse(BaseModel):
    asset_id: str = Field(min_length=1)
    original_name: str = Field(min_length=1)
    stored_name: str = Field(min_length=1)
    content_type: str
    size_bytes: int = Field(ge=1)

