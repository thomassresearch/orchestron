from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from backend.app.api.deps import get_container
from backend.app.core.container import AppContainer
from backend.app.models.performance import (
    PerformanceCreateRequest,
    PerformanceListItem,
    PerformanceResponse,
    PerformanceUpdateRequest,
)

router = APIRouter(prefix="/performances", tags=["performances"])


@router.post("", response_model=PerformanceResponse, status_code=201)
async def create_performance(
    request: PerformanceCreateRequest,
    container: AppContainer = Depends(get_container),
) -> PerformanceResponse:
    return container.performance_service.create_performance(request)


@router.get("", response_model=list[PerformanceListItem])
async def list_performances(container: AppContainer = Depends(get_container)) -> list[PerformanceListItem]:
    return container.performance_service.list_performances()


@router.get("/{performance_id}", response_model=PerformanceResponse)
async def get_performance(performance_id: str, container: AppContainer = Depends(get_container)) -> PerformanceResponse:
    return container.performance_service.get_performance(performance_id)


@router.put("/{performance_id}", response_model=PerformanceResponse)
async def update_performance(
    performance_id: str,
    request: PerformanceUpdateRequest,
    container: AppContainer = Depends(get_container),
) -> PerformanceResponse:
    return container.performance_service.update_performance(performance_id, request)


@router.delete("/{performance_id}", status_code=204)
async def delete_performance(performance_id: str, container: AppContainer = Depends(get_container)) -> Response:
    container.performance_service.delete_performance(performance_id)
    return Response(status_code=204)
