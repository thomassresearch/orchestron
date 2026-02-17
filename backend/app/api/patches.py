from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.patch import PatchCreateRequest, PatchListItem, PatchResponse, PatchUpdateRequest

router = APIRouter(prefix="/patches", tags=["patches"])


@router.post("", response_model=PatchResponse, status_code=201)
async def create_patch(
    request: PatchCreateRequest,
    container: AppContainer = Depends(get_container),
) -> PatchResponse:
    return container.patch_service.create_patch(request)


@router.get("", response_model=list[PatchListItem])
async def list_patches(container: AppContainer = Depends(get_container)) -> list[PatchListItem]:
    return container.patch_service.list_patches()


@router.get("/{patch_id}", response_model=PatchResponse)
async def get_patch(patch_id: str, container: AppContainer = Depends(get_container)) -> PatchResponse:
    return container.patch_service.get_patch(patch_id)


@router.put("/{patch_id}", response_model=PatchResponse)
async def update_patch(
    patch_id: str,
    request: PatchUpdateRequest,
    container: AppContainer = Depends(get_container),
) -> PatchResponse:
    return container.patch_service.update_patch(patch_id, request)


@router.delete("/{patch_id}", status_code=204)
async def delete_patch(patch_id: str, container: AppContainer = Depends(get_container)) -> Response:
    container.patch_service.delete_patch(patch_id)
    return Response(status_code=204)
