from __future__ import annotations

from pydantic import BaseModel

from backend.app.models.session import SessionAudioOutputMode


class RuntimeConfigResponse(BaseModel):
    audio_output_mode: SessionAudioOutputMode
    browser_clock_enabled: bool
