from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.runtime import RuntimeConfigResponse

router = APIRouter(prefix="/runtime-config", tags=["runtime"])


@router.get("", response_model=RuntimeConfigResponse)
async def get_runtime_config(container: AppContainer = Depends(get_container)) -> RuntimeConfigResponse:
    return RuntimeConfigResponse(webrtc_browser_ice_servers=container.settings.webrtc_frontend_ice_servers)
