from __future__ import annotations

from pydantic import BaseModel, Field

from backend.app.models.session import SessionAudioOutputMode


class WebRtcIceServerConfig(BaseModel):
    urls: str | list[str]
    username: str | None = None
    credential: str | None = None


class RuntimeConfigResponse(BaseModel):
    audio_output_mode: SessionAudioOutputMode
    browser_audio_streaming_enabled: bool
    browser_clock_enabled: bool
    webrtc_browser_ice_servers: list[WebRtcIceServerConfig] = Field(default_factory=list)
