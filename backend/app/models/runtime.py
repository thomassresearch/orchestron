from __future__ import annotations

from pydantic import BaseModel, Field


class WebRtcIceServerConfig(BaseModel):
    urls: str | list[str]
    username: str | None = None
    credential: str | None = None


class RuntimeConfigResponse(BaseModel):
    webrtc_browser_ice_servers: list[WebRtcIceServerConfig] = Field(default_factory=list)
