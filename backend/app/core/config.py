from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import sys
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.app.models.runtime import WebRtcIceServerConfig


def _default_rtmidi_module() -> str:
    if sys.platform == "darwin":
        return "coremidi"
    if sys.platform.startswith("linux"):
        return "alsaseq"
    if sys.platform.startswith(("win32", "cygwin")):
        return "winmme"
    return "coremidi"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VISUALCSOUND_", extra="ignore")

    app_name: str = "Orchestron API"
    app_version: str = "0.1.0"
    debug: bool = False

    api_prefix: str = "/api"

    database_url: str = Field(
        default_factory=lambda: (
            f"sqlite:///{Path(__file__).resolve().parents[3] / 'backend' / 'data' / 'visualcsound.db'}"
        )
    )

    static_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "backend" / "app" / "static")
    frontend_dist_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[3] / "frontend" / "dist"
    )
    icons_url_prefix: str = "/static/icons"
    gen_audio_assets_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[3] / "backend" / "data" / "assets" / "audio"
    )

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    default_sr: int = 48000
    default_ksmps: int = 32
    default_nchnls: int = 2
    default_0dbfs: float = 1.0

    default_rtmidi_module: str = Field(default_factory=_default_rtmidi_module)
    default_midi_device: str = "0"
    audio_output_mode: Literal["local", "streaming"] = "local"
    webrtc_frontend_ice_servers: list[WebRtcIceServerConfig] = Field(default_factory=list)
    webrtc_backend_ice_servers: list[WebRtcIceServerConfig] = Field(default_factory=list)

    @property
    def resolved_webrtc_backend_ice_servers(self) -> list[WebRtcIceServerConfig]:
        source = self.webrtc_backend_ice_servers or self.webrtc_frontend_ice_servers
        return [server.model_copy(deep=True) for server in source]


@lru_cache
def get_settings() -> Settings:
    return Settings()
