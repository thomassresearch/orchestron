from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api import app_state, midi, opcodes, patches, performances, sessions, ws
from backend.app.core.config import Settings, get_settings
from backend.app.core.container import AppContainer
from backend.app.core.logging import configure_logging
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


def _build_container(settings: Settings) -> AppContainer:
    if settings.database_url.startswith("sqlite:///"):
        db_path = Path(settings.database_url.replace("sqlite:///", "", 1))
        db_path.parent.mkdir(parents=True, exist_ok=True)

    database = Database(settings.database_url)
    database.create_all()

    patch_repository = PatchRepository(database.session)
    app_state_repository = AppStateRepository(database.session)
    performance_repository = PerformanceRepository(database.session)
    opcode_service = OpcodeService(icon_prefix=settings.icons_url_prefix)
    patch_service = PatchService(repository=patch_repository)
    app_state_service = AppStateService(repository=app_state_repository)
    performance_service = PerformanceService(repository=performance_repository)
    compiler_service = CompilerService(opcode_service=opcode_service)
    midi_service = MidiService()
    event_bus = SessionEventBus()
    session_service = SessionService(
        settings=settings,
        patch_service=patch_service,
        compiler_service=compiler_service,
        midi_service=midi_service,
        event_bus=event_bus,
    )

    return AppContainer(
        settings=settings,
        database=database,
        patch_repository=patch_repository,
        app_state_repository=app_state_repository,
        performance_repository=performance_repository,
        opcode_service=opcode_service,
        patch_service=patch_service,
        performance_service=performance_service,
        app_state_service=app_state_service,
        compiler_service=compiler_service,
        midi_service=midi_service,
        event_bus=event_bus,
        session_service=session_service,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.debug)

    settings.static_dir.mkdir(parents=True, exist_ok=True)
    (settings.static_dir / "icons").mkdir(parents=True, exist_ok=True)

    app.state.container = _build_container(settings)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    settings.static_dir.mkdir(parents=True, exist_ok=True)
    (settings.static_dir / "icons").mkdir(parents=True, exist_ok=True)
    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    static_root = Path(settings.static_dir)
    app.mount("/static", StaticFiles(directory=static_root), name="static")

    frontend_dist = Path(settings.frontend_dist_dir)
    if frontend_dist.exists():
        app.mount("/client", StaticFiles(directory=frontend_dist, html=True), name="client")
    else:
        @app.get("/client", include_in_schema=False)
        async def client_unavailable() -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={
                    "detail": (
                        f"Frontend build not found at '{frontend_dist}'. "
                        "Run `cd frontend && npm install && npm run build`."
                    )
                },
            )

    app.include_router(opcodes.router, prefix=settings.api_prefix)
    app.include_router(app_state.router, prefix=settings.api_prefix)
    app.include_router(patches.router, prefix=settings.api_prefix)
    app.include_router(performances.router, prefix=settings.api_prefix)
    app.include_router(sessions.router, prefix=settings.api_prefix)
    app.include_router(midi.router, prefix=settings.api_prefix)
    app.include_router(ws.router)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/health/realtime")
    async def health_realtime() -> dict[str, str | int]:
        backend = app.state.container.session_service
        running_count = len(
            [session for session in await backend.list_sessions() if session.state == "running"]
        )
        return {"status": "ok", "running_sessions": running_count}

    return app


app = create_app()


def run() -> None:
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    run()
