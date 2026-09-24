from __future__ import annotations

from fastapi.responses import JSONResponse

from fastapi import APIRouter, Depends, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.patch import PatchCreateRequest, PatchListItem, PatchResponse, PatchUpdateRequest

router = APIRouter(prefix="/patches", tags=["patches"])


@router.post("", response_model=PatchResponse, status_code=201)
def create_patch(
    request: PatchCreateRequest,
    container: AppContainer = Depends(get_container),
) -> Response:
    return Response(
        container.patch_service.create_patch(request).model_dump_json(by_alias=True), media_type="application/json", status_code=201
    )


@router.get("", response_model=list[PatchListItem])
def list_patches(container: AppContainer = Depends(get_container)) -> Response:
    return JSONResponse([item.model_dump(mode="json", by_alias=True) for item in container.patch_service.list_patches()])


@router.get("/{patch_id}", response_model=PatchResponse)
def get_patch(patch_id: str, container: AppContainer = Depends(get_container)) -> Response:
    return Response(container.patch_service.get_patch(patch_id).model_dump_json(by_alias=True), media_type="application/json")


@router.put("/{patch_id}", response_model=PatchResponse)
def update_patch(
    patch_id: str,
    request: PatchUpdateRequest,
    container: AppContainer = Depends(get_container),
) -> Response:
    return Response(
        container.patch_service.update_patch(patch_id, request).model_dump_json(by_alias=True), media_type="application/json"
    )


@router.delete("/{patch_id}", status_code=204)
def delete_patch(patch_id: str, container: AppContainer = Depends(get_container)) -> Response:
    container.patch_service.delete_patch(patch_id)
    return Response(status_code=204)
