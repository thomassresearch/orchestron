from __future__ import annotations

from dataclasses import dataclass

from backend.app.core.config import Settings
from backend.app.services.compiler_service import CompilerService
from backend.app.services.app_state_service import AppStateService
from backend.app.services.event_bus import SessionEventBus
from backend.app.services.midi_service import MidiService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.patch_service import PatchService
from backend.app.services.performance_service import PerformanceService
from backend.app.services.session_service import SessionService
from backend.app.storage.db import Database
from backend.app.storage.repositories.patch_repository import PatchRepository
from backend.app.storage.repositories.app_state_repository import AppStateRepository
from backend.app.storage.repositories.performance_repository import PerformanceRepository


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    database: Database
    patch_repository: PatchRepository
    app_state_repository: AppStateRepository
    performance_repository: PerformanceRepository
    opcode_service: OpcodeService
    patch_service: PatchService
    performance_service: PerformanceService
    app_state_service: AppStateService
    compiler_service: CompilerService
    midi_service: MidiService
    event_bus: SessionEventBus
    session_service: SessionService
