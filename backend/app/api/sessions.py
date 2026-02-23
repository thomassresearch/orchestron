from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.session import (
    BindMidiInputRequest,
    CompileResponse,
    SessionAudioWebRtcAnswerResponse,
    SessionAudioWebRtcOfferRequest,
    SessionSequencerConfigRequest,
    SessionSequencerQueuePadRequest,
    SessionSequencerStartRequest,
    SessionSequencerStatus,
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


@router.post("/{session_id}/audio/webrtc", response_model=SessionAudioWebRtcAnswerResponse)
async def negotiate_audio_stream(
    session_id: str,
    request: SessionAudioWebRtcOfferRequest,
    container: AppContainer = Depends(get_container),
) -> SessionAudioWebRtcAnswerResponse:
    return await container.session_service.negotiate_session_audio_stream(session_id, request)


@router.put("/{session_id}/sequencer/config", response_model=SessionSequencerStatus)
async def configure_sequencer(
    session_id: str,
    request: SessionSequencerConfigRequest,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.configure_session_sequencer(session_id, request)


@router.post("/{session_id}/sequencer/start", response_model=SessionSequencerStatus)
async def start_sequencer(
    session_id: str,
    request: SessionSequencerStartRequest,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.start_session_sequencer(session_id, request)


@router.post("/{session_id}/sequencer/stop", response_model=SessionSequencerStatus)
async def stop_sequencer(
    session_id: str,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.stop_session_sequencer(session_id)


@router.get("/{session_id}/sequencer/status", response_model=SessionSequencerStatus)
async def sequencer_status(
    session_id: str,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.get_session_sequencer_status(session_id)


@router.post("/{session_id}/sequencer/tracks/{track_id}/queue-pad", response_model=SessionSequencerStatus)
async def queue_sequencer_pad(
    session_id: str,
    track_id: str,
    request: SessionSequencerQueuePadRequest,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.queue_session_sequencer_pad(session_id, track_id, request)


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
