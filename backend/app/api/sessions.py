from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.session import (
    BindMidiInputRequest,
    CompileResponse,
    SessionMidiEventRequest,
    SessionActionResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionInfo,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionCreateResponse, status_code=201)
async def create_session(
    request: SessionCreateRequest,
    container: AppContainer = Depends(get_container),
) -> SessionCreateResponse:
    return await container.session_service.create_session(request)


@router.get("", response_model=list[SessionInfo])
async def list_sessions(container: AppContainer = Depends(get_container)) -> list[SessionInfo]:
    return await container.session_service.list_sessions()


@router.get("/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str, container: AppContainer = Depends(get_container)) -> SessionInfo:
    return await container.session_service.get_session(session_id)


@router.post("/{session_id}/compile", response_model=CompileResponse)
async def compile_session(session_id: str, container: AppContainer = Depends(get_container)) -> CompileResponse:
    return await container.session_service.compile_session(session_id)


@router.post("/{session_id}/start", response_model=SessionActionResponse)
async def start_session(session_id: str, container: AppContainer = Depends(get_container)) -> SessionActionResponse:
    return await container.session_service.start_session(session_id)


@router.post("/{session_id}/stop", response_model=SessionActionResponse)
async def stop_session(session_id: str, container: AppContainer = Depends(get_container)) -> SessionActionResponse:
    return await container.session_service.stop_session(session_id)


@router.post("/{session_id}/panic", response_model=SessionActionResponse)
async def panic_session(session_id: str, container: AppContainer = Depends(get_container)) -> SessionActionResponse:
    return await container.session_service.panic_session(session_id)


@router.post("/{session_id}/midi-event", response_model=SessionActionResponse)
async def midi_event(
    session_id: str,
    request: SessionMidiEventRequest,
    container: AppContainer = Depends(get_container),
) -> SessionActionResponse:
    return await container.session_service.send_midi_event(session_id, request)


@router.put("/{session_id}/midi-input", response_model=SessionInfo)
async def bind_midi_input(
    session_id: str,
    request: BindMidiInputRequest,
    container: AppContainer = Depends(get_container),
) -> SessionInfo:
    return await container.session_service.bind_midi_input(session_id, request)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, container: AppContainer = Depends(get_container)) -> Response:
    await container.session_service.delete_session(session_id)
    return Response(status_code=204)
