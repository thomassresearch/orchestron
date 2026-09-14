from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.app_state import AppStateResponse, AppStateUpdateRequest

router = APIRouter(prefix="/app-state", tags=["app-state"])


@router.get("", response_model=AppStateResponse)
def get_app_state(container: AppContainer = Depends(get_container)) -> Response:
    state = container.app_state_service.get_last_state()
    return Response(state.model_dump_json(), media_type="application/json")


@router.put("", response_model=AppStateResponse)
def save_app_state(
    request: AppStateUpdateRequest,
    container: AppContainer = Depends(get_container),
) -> Response:
    # Persistence validation and SQLite work must not block browser audio refills.
    state = container.app_state_service.save_last_state(request)
    # Serialize the already-validated model here, in the worker thread as well.
    return Response(state.model_dump_json(), media_type="application/json")
