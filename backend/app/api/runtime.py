from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.runtime import RuntimeConfigResponse

router = APIRouter(prefix="/runtime-config", tags=["runtime"])


@router.get("", response_model=RuntimeConfigResponse)
async def get_runtime_config(container: AppContainer = Depends(get_container)) -> RuntimeConfigResponse:
    return RuntimeConfigResponse(
        audio_output_mode=container.settings.audio_output_mode,
        browser_clock_enabled=container.settings.audio_output_mode == "browser_clock",
    )
