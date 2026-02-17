from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.session import BindMidiInputRequest, MidiInputRef, SessionInfo

router = APIRouter(prefix="/midi", tags=["midi"])


@router.get("/inputs", response_model=list[MidiInputRef])
async def list_midi_inputs(container: AppContainer = Depends(get_container)) -> list[MidiInputRef]:
    return container.midi_service.list_inputs()


@router.put("/sessions/{session_id}/midi-input", response_model=SessionInfo)
async def bind_midi_input(
    session_id: str,
    request: BindMidiInputRequest,
    container: AppContainer = Depends(get_container),
) -> SessionInfo:
    return await container.session_service.bind_midi_input(session_id, request)
