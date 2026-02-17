from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.models.session import CompileArtifact, SessionState


@dataclass(slots=True)
class RuntimeSession:
    session_id: str
    patch_id: str
    state: SessionState = SessionState.IDLE
    midi_input: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    compile_artifact: CompileArtifact | None = None
    worker: CsoundWorker = field(default_factory=CsoundWorker)
