from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.dx7 import MAX_DUMP_BYTES, describe_voice, read_sysex
from backend.app.models.opcode import OpcodeSpec

router = APIRouter(prefix="/opcodes", tags=["opcodes"])


@router.get("", response_model=list[OpcodeSpec])
async def list_opcodes(
    category: str | None = Query(default=None),
    container: AppContainer = Depends(get_container),
) -> list[OpcodeSpec]:
    return container.opcode_service.list_opcodes(category)


@router.get("/categories")
async def list_categories(container: AppContainer = Depends(get_container)) -> dict[str, int]:
    return container.opcode_service.categories()


@router.get("/{opcode_name}", response_model=OpcodeSpec)
async def get_opcode(opcode_name: str, container: AppContainer = Depends(get_container)) -> OpcodeSpec:
    opcode = container.opcode_service.get_opcode(opcode_name)
    if not opcode:
        raise HTTPException(status_code=404, detail=f"Opcode '{opcode_name}' not found")
    return opcode


@router.get("/{opcode_name}/icon")
async def get_opcode_icon(opcode_name: str, container: AppContainer = Depends(get_container)) -> RedirectResponse:
    opcode = container.opcode_service.get_opcode(opcode_name)
    if not opcode:
        raise HTTPException(status_code=404, detail=f"Opcode '{opcode_name}' not found")
    return RedirectResponse(url=opcode.icon)


@router.post("/fm_dx7/voices")
async def load_dx7_voices(request: Request) -> list[dict[str, str | int]]:
    """Decode locally supplied voice data without creating a server-side asset."""
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_DUMP_BYTES:
            raise HTTPException(413, "DX7 dumps may contain at most 32 voices.")
        data.extend(chunk)
    try:
        return [describe_voice(voice) for voice in read_sysex(bytes(data))]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
