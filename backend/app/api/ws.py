from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.core.container import AppContainer

router = APIRouter(tags=["ws"])


@router.websocket("/ws/sessions/{session_id}")
async def session_events(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()

    container: AppContainer = websocket.app.state.container
    queue = await container.event_bus.subscribe(session_id)

    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event.model_dump(mode="json"))
    except WebSocketDisconnect:
        await container.event_bus.unsubscribe(session_id, queue)
    except asyncio.CancelledError:
        await container.event_bus.unsubscribe(session_id, queue)
        raise
