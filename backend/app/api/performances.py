from __future__ import annotations

from fastapi.responses import JSONResponse

from fastapi import APIRouter, Depends, Response, HTTPException

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.performance import (
    PerformanceCreateRequest,
    PerformanceListItem,
    PerformanceResponse,
    PerformanceUpdateRequest,
    MasterRepairRequest,
)
from backend.app.services.master_migration import replace_neutral_master
from backend.app.services.internal_master import MASTER

router = APIRouter(prefix="/performances", tags=["performances"])


@router.post("/repair-master")
def repair_master(request: MasterRepairRequest, container: AppContainer = Depends(get_container)) -> Response:
    """Explicit, non-persisting replacement of a missing stereo Master."""
    config = request.config
    container.performance_service._validate_config(config)
    graph = config.get("audioGraph") or {}
    old = graph.get("masterId")
    if not old or old == MASTER:
        raise HTTPException(status_code=422, detail="There is no missing Master to replace.")
    binding = next((b for b in config.get("instruments", []) if b.get("id") == old), None)
    if binding and container.patch_repository.get(binding.get("patchId")):
        raise HTTPException(status_code=422, detail="The Master patch still exists.")
    for route in graph.get("routes", []):
        if route.get("sourceId") == old and route.get("sourcePort") not in {"$direct.left", "$direct.right"}:
            raise HTTPException(status_code=422, detail="Repair the missing Master's output port mapping first.")
        ports = {"$direct.left", "$direct.right"} if route.get("targetStage") == "strip" else {"left", "right"}
        if route.get("targetId") == old and route.get("targetPort") not in ports:
            raise HTTPException(status_code=422, detail="Repair the missing Master's input port mapping first.")
    result = replace_neutral_master(config, old)
    container.performance_service._validate_config(result)
    return JSONResponse(result)


@router.post("", response_model=PerformanceResponse, status_code=201)
def create_performance(
    request: PerformanceCreateRequest,
    container: AppContainer = Depends(get_container),
) -> Response:
    return Response(
        container.performance_service.create_performance(request).model_dump_json(by_alias=True),
        media_type="application/json",
        status_code=201,
    )


@router.get("", response_model=list[PerformanceListItem])
def list_performances(container: AppContainer = Depends(get_container)) -> Response:
    return JSONResponse([item.model_dump(mode="json", by_alias=True) for item in container.performance_service.list_performances()])


@router.get("/{performance_id}", response_model=PerformanceResponse)
def get_performance(performance_id: str, container: AppContainer = Depends(get_container)) -> Response:
    return Response(
        container.performance_service.get_performance(performance_id).model_dump_json(by_alias=True), media_type="application/json"
    )


@router.put("/{performance_id}", response_model=PerformanceResponse)
def update_performance(
    performance_id: str,
    request: PerformanceUpdateRequest,
    container: AppContainer = Depends(get_container),
) -> Response:
    return Response(
        container.performance_service.update_performance(performance_id, request).model_dump_json(by_alias=True),
        media_type="application/json",
    )


@router.delete("/{performance_id}", status_code=204)
def delete_performance(performance_id: str, container: AppContainer = Depends(get_container)) -> Response:
    container.performance_service.delete_performance(performance_id)
    return Response(status_code=204)
