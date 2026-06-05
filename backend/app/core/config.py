from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import sys
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.app.services.persisted_json_limits import (
    DEFAULT_APP_STATE_MAX_BYTES,
    DEFAULT_PATCH_GRAPH_MAX_BYTES,
    DEFAULT_PATCH_UI_LAYOUT_MAX_BYTES,
    DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES,
    DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
)


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
    gen_audio_asset_max_bytes: int = Field(default=64 * 1024 * 1024, gt=0)
    gen_audio_assets_max_total_bytes: int = Field(default=1024 * 1024 * 1024, gt=0)
    gen_audio_assets_max_count: int = Field(default=1024, gt=0)
    gen_audio_asset_gc_min_age_seconds: float = Field(default=24 * 60 * 60, ge=0.0)
    bundle_import_max_bytes: int = Field(default=256 * 1024 * 1024, gt=0)
    bundle_import_json_max_bytes: int = Field(default=8 * 1024 * 1024, gt=0)
    bundle_import_zip_max_members: int = Field(default=512, gt=0)
    bundle_import_zip_max_uncompressed_bytes: int = Field(default=256 * 1024 * 1024, gt=0)
    app_state_max_bytes: int = Field(default=DEFAULT_APP_STATE_MAX_BYTES, gt=0)
    patch_graph_max_bytes: int = Field(default=DEFAULT_PATCH_GRAPH_MAX_BYTES, gt=0)
    patch_ui_layout_max_bytes: int = Field(default=DEFAULT_PATCH_UI_LAYOUT_MAX_BYTES, gt=0)
    performance_config_max_bytes: int = Field(default=DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES, gt=0)
    persisted_json_string_max_bytes: int = Field(default=DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES, gt=0)

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    default_sr: int = 48000
    default_ksmps: int = 32
    default_nchnls: int = 2
    default_0dbfs: float = 1.0

    default_rtmidi_module: str = Field(default_factory=_default_rtmidi_module)
    default_midi_device: str = "internal:loopback"
    host_midi_token: str | None = None
    audio_output_mode: Literal["browser_clock"] = "browser_clock"
    frontend_disconnect_grace_seconds: float = Field(default=5.0, gt=0.0)
    frontend_heartbeat_timeout_seconds: float = Field(default=5.0, gt=0.0)
    arpeggiator_pending_input_max_events: int = Field(default=16_384, gt=0)
    browser_clock_manual_midi_max_future_ms: float = Field(default=2_000.0, gt=0.0)
    browser_clock_manual_midi_rate_per_second: float = Field(default=240.0, gt=0.0)
    browser_clock_manual_midi_burst: int = Field(default=480, gt=0)

    @field_validator("audio_output_mode", mode="before")
    @classmethod
    def _normalize_audio_output_mode(cls, value: object) -> str:
        normalized = str(value or "").strip().lower()
        if normalized == "":
            return "browser_clock"
        if normalized == "streaming":
            return "browser_clock"
        if normalized in {"browser_clock", "browser-clock", "pcm"}:
            return "browser_clock"
        if normalized in {"local", "webrtc", "browser"}:
            raise ValueError(
                f"VISUALCSOUND_AUDIO_OUTPUT_MODE={normalized} is no longer supported. "
                "Use VISUALCSOUND_AUDIO_OUTPUT_MODE=browser_clock."
            )
        raise ValueError(
            "Invalid VISUALCSOUND_AUDIO_OUTPUT_MODE value. Supported values: "
            "browser_clock (or streaming as a compatibility alias)."
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
