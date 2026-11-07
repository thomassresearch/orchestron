from typing import Literal

from pydantic import BaseModel, Field

from backend.app.models.session import RendererDiagnostics, SessionState


class CpuLoad(BaseModel):
    cpu: int = Field(ge=0)
    percent: float | None = Field(default=None, ge=0, le=100)


class EngineStats(BaseModel):
    session_id: str
    state: SessionState
    renderer: RendererDiagnostics | None = None
    available: bool
    # CPU counters cover the whole logical CPU, including other container/host
    # work. Single rendering migrates: report API-process usage instead of
    # inventing a per-core assignment or pinning the existing renderer.
    scope: Literal["renderer_cpus", "server_process", "unavailable"]
    cpus: list[CpuLoad] = Field(default_factory=list)
    process_percent: float | None = Field(default=None, ge=0)
    sample_seconds: float | None = Field(default=None, gt=0)
