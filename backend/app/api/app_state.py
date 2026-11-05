from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.app_state import AppStateResponse, AppStateUpdateRequest

router = APIRouter(prefix="/app-state", tags=["app-state"])


@router.get("", response_model=AppStateResponse)
def get_app_state(container: AppContainer = Depends(get_container)) -> Response:
    state = container.app_state_service.get_last_state()
    return Response(state.model_dump_json(), media_type="application/json")


@router.put("", response_model=AppStateResponse, responses={204: {"description": "Saved without returning state"}},
            openapi_extra={"requestBody": {"required": True, "content": {"application/json": {"schema": {
                "type": "object", "required": ["state"], "properties": {"state": {"type": "object"}},
            }}}}})
async def save_app_state(
    request: Request,
    return_state: bool = True,
    container: AppContainer = Depends(get_container),
) -> Response:
    # The request-size middleware bounds this body before parsing. A typed body
    # parameter would make FastAPI validate all clips on the audio event loop.
    body = await request.body()

    def persist() -> Response:
        try:
            update = AppStateUpdateRequest.model_validate_json(body)
        except ValidationError as error:
            errors = [{**item, "loc": ("body", *item["loc"])}
                      for item in error.errors(include_url=False, include_input=False)]
            raise RequestValidationError(errors) from error
        state = container.app_state_service.save_last_state(update)
        if not return_state:
            return Response(status_code=204)
        return Response(state.model_dump_json(), media_type="application/json")

    return await run_in_threadpool(persist)
