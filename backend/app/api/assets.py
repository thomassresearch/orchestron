from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.assets import GenAudioAssetUploadResponse
from backend.app.services.gen_asset_service import GenAudioAssetTooLargeError

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/gen-audio", response_model=GenAudioAssetUploadResponse, status_code=201)
async def upload_gen_audio_asset(
    request: Request,
    x_file_name: str | None = Header(default=None, alias="X-File-Name"),
    container: AppContainer = Depends(get_container),
) -> GenAudioAssetUploadResponse:
    _reject_declared_oversized_upload(
        content_length=request.headers.get("content-length"),
        max_size=container.gen_asset_service.max_audio_asset_bytes,
    )
    try:
        stored = await container.gen_asset_service.store_audio_stream(
            filename=x_file_name,
            content_type=request.headers.get("content-type"),
            chunks=request.stream(),
        )
    except GenAudioAssetTooLargeError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    return GenAudioAssetUploadResponse(
        asset_id=stored.asset_id,
        original_name=stored.original_name,
        stored_name=stored.stored_name,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
    )


def _reject_declared_oversized_upload(*, content_length: str | None, max_size: int) -> None:
    if content_length is None:
        return
    try:
        declared_size = int(content_length)
    except ValueError:
        return
    if declared_size > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"Audio upload exceeds maximum size ({max_size} bytes).",
        )
