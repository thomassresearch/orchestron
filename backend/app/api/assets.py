from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.assets import GenAudioAssetUploadResponse

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/gen-audio", response_model=GenAudioAssetUploadResponse, status_code=201)
async def upload_gen_audio_asset(
    request: Request,
    x_file_name: str | None = Header(default=None, alias="X-File-Name"),
    container: AppContainer = Depends(get_container),
) -> GenAudioAssetUploadResponse:
    payload = await request.body()
    try:
        stored = container.gen_asset_service.store_audio_bytes(
            filename=x_file_name,
            content_type=request.headers.get("content-type"),
            payload=payload,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    return GenAudioAssetUploadResponse(
        asset_id=stored.asset_id,
        original_name=stored.original_name,
        stored_name=stored.stored_name,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
    )

