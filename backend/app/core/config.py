from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VISUALCSOUND_", extra="ignore")

    app_name: str = "VisualCSound API"
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

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    default_sr: int = 48000
    default_ksmps: int = 64
    default_nchnls: int = 2
    default_0dbfs: float = 1.0

    default_rtmidi_module: str = "cmidi"
    default_midi_device: str = "0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
