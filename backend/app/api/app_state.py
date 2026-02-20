from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.app_state import AppStateResponse, AppStateUpdateRequest

router = APIRouter(prefix="/app-state", tags=["app-state"])


@router.get("", response_model=AppStateResponse)
async def get_app_state(container: AppContainer = Depends(get_container)) -> AppStateResponse:
    return container.app_state_service.get_last_state()


@router.put("", response_model=AppStateResponse)
async def save_app_state(
    request: AppStateUpdateRequest,
    container: AppContainer = Depends(get_container),
) -> AppStateResponse:
    return container.app_state_service.save_last_state(request)
