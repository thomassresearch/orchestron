from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.assets import GenAudioAssetUploadResponse
from backend.app.services.gen_asset_references import collect_persisted_gen_audio_stored_names
from backend.app.services.gen_asset_service import GenAudioAssetQuotaExceededError, GenAudioAssetTooLargeError

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/gen-audio", response_model=GenAudioAssetUploadResponse, status_code=201)
async def upload_gen_audio_asset(
    request: Request,
    x_file_name: str | None = Header(default=None, alias="X-File-Name"),
    container: AppContainer = Depends(get_container),
) -> GenAudioAssetUploadResponse:
    _reject_declared_oversized_upload(
        content_length=request.headers.get("content-length"),
        container=container,
    )
    try:
        stored = await _store_audio_stream_with_gc_retry(
            container=container,
            filename=x_file_name,
            content_type=request.headers.get("content-type"),
            chunks=request.stream(),
        )
    except GenAudioAssetTooLargeError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except GenAudioAssetQuotaExceededError as err:
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


def _reject_declared_oversized_upload(*, content_length: str | None, container: AppContainer) -> None:
    if content_length is None:
        return
    try:
        declared_size = int(content_length)
    except ValueError:
        return
    try:
        container.gen_asset_service.assert_upload_can_fit_declared_size(declared_size)
    except GenAudioAssetTooLargeError as err:
        raise HTTPException(
            status_code=413,
            detail=str(err),
        ) from err
    except GenAudioAssetQuotaExceededError:
        _run_asset_gc(container=container)
        try:
            container.gen_asset_service.assert_upload_can_fit_declared_size(declared_size)
        except GenAudioAssetQuotaExceededError as err:
            raise HTTPException(status_code=413, detail=str(err)) from err


async def _store_audio_stream_with_gc_retry(
    *,
    container: AppContainer,
    filename: str | None,
    content_type: str | None,
    chunks,
):
    return await container.gen_asset_service.store_audio_stream(
        filename=filename,
        content_type=content_type,
        chunks=chunks,
        quota_retry=lambda: _run_asset_gc(container=container),
    )


def _run_asset_gc(*, container: AppContainer) -> None:
    referenced = collect_persisted_gen_audio_stored_names(
        patch_documents=container.patch_repository.list(),
        performance_documents=container.performance_repository.list(),
    )
    container.gen_asset_service.garbage_collect_unreferenced_assets(referenced_stored_names=referenced)
