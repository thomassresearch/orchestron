from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.audio import MixerUpdate
from backend.app.models.performance_controller import PerformanceControllerUpdate
from backend.app.models.patch import PatchDocument
from pydantic import BaseModel, Field, model_validator
from backend.app.models.session import (
    BindMidiInputRequest,
    CompileResponse,
    SessionArpeggiatorConfigRequest,
    SessionArpeggiatorStatus,
    SessionSequencerConfigRequest,
    SessionSequencerQueuePadRequest,
    SessionSequencerStartRequest,
    SessionSequencerStatus,
    SessionMidiEventRequest,
    SessionActionResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionInfo,
    SessionInstrumentValidationRequest,
    SessionInstrumentValidationResponse,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


class PreviewSessionRequest(BaseModel):
    session: SessionCreateRequest
    patches: list[PatchDocument] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def unique_patch_ids(self):
        if len({p.id for p in self.patches}) != len(self.patches):
            raise ValueError("Preview patch IDs must be unique")
        return self


@router.post("/preview", response_model=SessionCreateResponse, status_code=201)
async def preview_session(request_body: PreviewSessionRequest, request: Request,
                          container: AppContainer = Depends(get_container)):
    return await container.session_service.create_session(request_body.session,
        client_key=request.client.host if request.client else "unknown",
        preview_patches={p.id: p for p in request_body.patches})


@router.get("/{session_id}/mixer")
async def get_mixer(session_id: str, container: AppContainer = Depends(get_container)):
    return await container.session_service.get_mixer(session_id)


@router.put("/{session_id}/mixer")
async def update_mixer(session_id: str, request_body: MixerUpdate, container: AppContainer = Depends(get_container)):
    return await container.session_service.update_mixer(session_id, request_body)


@router.put("/{session_id}/instruments/{assignment_id}/performance-controllers", response_model=PerformanceControllerUpdate)
async def update_performance_controllers(session_id: str, assignment_id: str,
        request_body: PerformanceControllerUpdate, container: AppContainer = Depends(get_container)):
    return await container.session_service.update_performance_controllers(session_id, assignment_id, request_body.values)


@router.post("", response_model=SessionCreateResponse, status_code=201)
async def create_session(
    request_body: SessionCreateRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> SessionCreateResponse:
    client_key = request.client.host if request.client is not None else "unknown"
    return await container.session_service.create_session(request_body, client_key=client_key)


@router.post("/validate-instruments", response_model=SessionInstrumentValidationResponse)
async def validate_instruments(
    request_body: SessionInstrumentValidationRequest,
    container: AppContainer = Depends(get_container),
) -> SessionInstrumentValidationResponse:
    return await container.session_service.validate_session_instruments(request_body)


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


@router.put("/{session_id}/sequencer/config", response_model=SessionSequencerStatus)
async def configure_sequencer(
    session_id: str,
    request: SessionSequencerConfigRequest,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.configure_session_sequencer(session_id, request)


@router.put("/{session_id}/arpeggiators/config", response_model=list[SessionArpeggiatorStatus])
async def configure_arpeggiators(
    session_id: str,
    request: SessionArpeggiatorConfigRequest,
    container: AppContainer = Depends(get_container),
) -> list[SessionArpeggiatorStatus]:
    return await container.session_service.configure_session_arpeggiators(session_id, request)


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


@router.post("/{session_id}/sequencer/rewind", response_model=SessionSequencerStatus)
async def rewind_sequencer_cycle(
    session_id: str,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.rewind_session_sequencer_cycle(session_id)


@router.post("/{session_id}/sequencer/forward", response_model=SessionSequencerStatus)
async def forward_sequencer_cycle(
    session_id: str,
    container: AppContainer = Depends(get_container),
) -> SessionSequencerStatus:
    return await container.session_service.forward_session_sequencer_cycle(session_id)


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
