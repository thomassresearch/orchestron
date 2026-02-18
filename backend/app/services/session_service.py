from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from backend.app.core.config import Settings
from backend.app.engine.session_runtime import RuntimeSession
from backend.app.models.session import (
    BindMidiInputRequest,
    CompileResponse,
    SessionMidiEventRequest,
    SessionActionResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionEvent,
    SessionInfo,
    SessionState,
)
from backend.app.services.compiler_service import CompilationError, CompilerService
from backend.app.services.event_bus import SessionEventBus
from backend.app.services.midi_service import MidiService
from backend.app.services.patch_service import PatchService


class SessionService:
    def __init__(
        self,
        settings: Settings,
        patch_service: PatchService,
        compiler_service: CompilerService,
        midi_service: MidiService,
        event_bus: SessionEventBus,
    ) -> None:
        self._settings = settings
        self._patch_service = patch_service
        self._compiler_service = compiler_service
        self._midi_service = midi_service
        self._event_bus = event_bus
        self._sessions: dict[str, RuntimeSession] = {}
        self._lock = asyncio.Lock()

    async def create_session(self, request: SessionCreateRequest) -> SessionCreateResponse:
        # Verify patch exists before creating runtime.
        self._patch_service.get_patch_document(request.patch_id)

        midi_inputs = self._midi_service.list_inputs()
        default_midi = midi_inputs[0].id if midi_inputs else self._settings.default_midi_device

        runtime = RuntimeSession(
            session_id=str(uuid4()),
            patch_id=request.patch_id,
            midi_input=default_midi,
        )

        async with self._lock:
            self._sessions[runtime.session_id] = runtime

        await self._publish(runtime.session_id, "session_created", {"patch_id": runtime.patch_id})

        return SessionCreateResponse(
            session_id=runtime.session_id,
            patch_id=runtime.patch_id,
            state=runtime.state,
        )

    async def list_sessions(self) -> list[SessionInfo]:
        async with self._lock:
            sessions = list(self._sessions.values())
        return [self._session_info(runtime) for runtime in sessions]

    async def get_session(self, session_id: str) -> SessionInfo:
        runtime = await self._get_session(session_id)
        return self._session_info(runtime)

    async def compile_session(self, session_id: str) -> CompileResponse:
        runtime = await self._get_session(session_id)
        patch = self._patch_service.get_patch_document(runtime.patch_id)

        midi_device = runtime.midi_input or self._settings.default_midi_device

        try:
            artifact = self._compiler_service.compile_patch(
                patch=patch,
                midi_input=midi_device,
                rtmidi_module=self._settings.default_rtmidi_module,
            )
        except CompilationError as error:
            runtime.state = SessionState.ERROR
            await self._publish(runtime.session_id, "compile_failed", {"errors": " | ".join(error.diagnostics)})
            raise HTTPException(status_code=422, detail={"diagnostics": error.diagnostics}) from error

        runtime.compile_artifact = artifact
        runtime.state = SessionState.COMPILED

        await self._publish(runtime.session_id, "compiled", {"diagnostics": len(artifact.diagnostics)})

        return CompileResponse(
            session_id=runtime.session_id,
            state=runtime.state,
            orc=artifact.orc,
            csd=artifact.csd,
            diagnostics=artifact.diagnostics,
        )

    async def start_session(self, session_id: str) -> SessionActionResponse:
        runtime = await self._get_session(session_id)

        if not runtime.compile_artifact:
            await self.compile_session(session_id)

        assert runtime.compile_artifact is not None

        try:
            result = runtime.worker.start(
                runtime.compile_artifact.csd,
                midi_input=runtime.midi_input or self._settings.default_midi_device,
                rtmidi_module=self._settings.default_rtmidi_module,
            )
        except Exception as exc:
            runtime.state = SessionState.ERROR
            await self._publish(runtime.session_id, "start_failed", {"error": str(exc)})
            raise HTTPException(status_code=500, detail=f"Failed to start session: {exc}") from exc

        runtime.state = SessionState.RUNNING
        runtime.started_at = datetime.now(timezone.utc)

        await self._publish(
            runtime.session_id,
            "started",
            {
                "backend": result.backend,
                "detail": result.detail,
                "midi_input": runtime.midi_input or self._settings.default_midi_device,
            },
        )

        return SessionActionResponse(
            session_id=runtime.session_id,
            state=runtime.state,
            detail=result.detail,
        )

    async def stop_session(self, session_id: str) -> SessionActionResponse:
        runtime = await self._get_session(session_id)
        detail = runtime.worker.stop()
        runtime.state = SessionState.COMPILED if runtime.compile_artifact else SessionState.IDLE

        await self._publish(runtime.session_id, "stopped", {"detail": detail})

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def panic_session(self, session_id: str) -> SessionActionResponse:
        runtime = await self._get_session(session_id)
        detail = runtime.worker.panic()

        await self._publish(runtime.session_id, "panic", {"detail": detail})

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def send_midi_event(self, session_id: str, request: SessionMidiEventRequest) -> SessionActionResponse:
        runtime = await self._get_session(session_id)
        if not runtime.worker.is_running:
            raise HTTPException(status_code=409, detail="Session must be running to receive MIDI events.")

        midi_input_selector = runtime.midi_input or self._settings.default_midi_device
        channel = request.channel - 1

        try:
            if request.type == "note_on":
                assert request.note is not None
                output_name = self._midi_service.send_message(
                    midi_input_selector,
                    [0x90 + channel, request.note, request.velocity],
                )
                detail = f"note_on sent via {output_name}"
            elif request.type == "note_off":
                assert request.note is not None
                output_name = self._midi_service.send_message(
                    midi_input_selector,
                    [0x80 + channel, request.note, 0],
                )
                detail = f"note_off sent via {output_name}"
            else:
                output_name = self._midi_service.send_message(midi_input_selector, [0xB0 + channel, 123, 0])
                self._midi_service.send_message(midi_input_selector, [0xB0 + channel, 120, 0])
                detail = f"all_notes_off sent via {output_name}"
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        payload: dict[str, str | int | float | bool | None] = {
            "type": request.type,
            "channel": request.channel,
            "output": output_name,
        }
        if request.note is not None:
            payload["note"] = request.note
        if request.type == "note_on":
            payload["velocity"] = request.velocity

        await self._publish(runtime.session_id, "midi_event", payload)

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def bind_midi_input(self, session_id: str, request: BindMidiInputRequest) -> SessionInfo:
        runtime = await self._get_session(session_id)

        try:
            resolved = self._midi_service.resolve_input(request.midi_input)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        runtime.midi_input = resolved
        runtime.compile_artifact = None
        runtime.state = SessionState.IDLE if not runtime.worker.is_running else runtime.state

        await self._publish(runtime.session_id, "midi_bound", {"midi_input": resolved})

        return self._session_info(runtime)

    async def delete_session(self, session_id: str) -> None:
        runtime = await self._get_session(session_id)
        runtime.worker.stop()

        async with self._lock:
            self._sessions.pop(session_id, None)

        await self._publish(session_id, "session_deleted", {})

    async def _get_session(self, session_id: str) -> RuntimeSession:
        async with self._lock:
            runtime = self._sessions.get(session_id)
        if not runtime:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        return runtime

    @staticmethod
    def _session_info(runtime: RuntimeSession) -> SessionInfo:
        return SessionInfo(
            session_id=runtime.session_id,
            patch_id=runtime.patch_id,
            state=runtime.state,
            midi_input=runtime.midi_input,
            created_at=runtime.created_at,
            started_at=runtime.started_at,
        )

    async def _publish(self, session_id: str, event_type: str, payload: dict[str, str | int | float | bool | None]) -> None:
        event = SessionEvent(session_id=session_id, type=event_type, payload=payload)
        await self._event_bus.publish(event)
