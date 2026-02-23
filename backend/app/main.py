from __future__ import annotations

import argparse
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api import app_state, assets, midi, opcodes, patches, performances, runtime, sessions, ws
from backend.app.core.config import Settings, get_settings
from backend.app.core.container import AppContainer
from backend.app.core.logging import configure_logging
from backend.app.services.compiler_service import CompilerService
from backend.app.services.app_state_service import AppStateService
from backend.app.services.event_bus import SessionEventBus
from backend.app.services.gen_asset_service import GenAssetService
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
    gen_asset_service = GenAssetService(audio_dir=settings.gen_audio_assets_dir)
    patch_service = PatchService(repository=patch_repository)
    app_state_service = AppStateService(repository=app_state_repository)
    performance_service = PerformanceService(repository=performance_repository)
    compiler_service = CompilerService(opcode_service=opcode_service, gen_asset_service=gen_asset_service)
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
        gen_asset_service=gen_asset_service,
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
    settings.gen_audio_assets_dir.mkdir(parents=True, exist_ok=True)

    app.state.container = _build_container(settings)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    settings.static_dir.mkdir(parents=True, exist_ok=True)
    (settings.static_dir / "icons").mkdir(parents=True, exist_ok=True)
    settings.gen_audio_assets_dir.mkdir(parents=True, exist_ok=True)
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
    app.include_router(assets.router, prefix=settings.api_prefix)
    app.include_router(app_state.router, prefix=settings.api_prefix)
    app.include_router(runtime.router, prefix=settings.api_prefix)
    app.include_router(patches.router, prefix=settings.api_prefix)
    app.include_router(performances.router, prefix=settings.api_prefix)
    app.include_router(sessions.router, prefix=settings.api_prefix)
    app.include_router(midi.router, prefix=settings.api_prefix)
    app.include_router(ws.router)

    @app.get("/api/health")
    async def health() -> dict[str, str | bool | int]:
        return {
            "status": "ok",
            "audio_output_mode": settings.audio_output_mode,
            "browser_audio_streaming_enabled": settings.audio_output_mode == "streaming",
            "browser_audio_sample_rate": 48_000,
        }

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
    parser = argparse.ArgumentParser(description="Run the VisualCSound backend")
    parser.add_argument(
        "--audio-output-mode",
        choices=("local", "streaming"),
        default=None,
        help="Select local DAC output or browser audio streaming mode.",
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--reload", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--access-log", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--debug", action=argparse.BooleanOptionalAction, default=None)
    args = parser.parse_args()

    if args.audio_output_mode is not None:
        os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = args.audio_output_mode
    if args.debug is True:
        os.environ["VISUALCSOUND_DEBUG"] = "1"
    elif args.debug is False:
        os.environ["VISUALCSOUND_DEBUG"] = "0"

    get_settings.cache_clear()
    globals()["app"] = create_app()

    uvicorn.run(
        "backend.app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
        access_log=args.access_log,
    )


if __name__ == "__main__":
    run()
