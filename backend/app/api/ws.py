from __future__ import annotations

import asyncio
import contextlib
import json
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.core.container import AppContainer

router = APIRouter(tags=["ws"])


@router.websocket("/ws/sessions/{session_id}")
async def session_events(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()

    container: AppContainer = websocket.app.state.container
    queue = await container.event_bus.subscribe(session_id)
    connection_id = str(uuid4())
    await container.session_service.frontend_connected(session_id, connection_id)

    async def send_loop() -> None:
        while True:
            event = await queue.get()
            await websocket.send_json(event.model_dump(mode="json"))

    async def receive_loop() -> None:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if payload.get("type") == "heartbeat":
                await container.session_service.frontend_heartbeat(session_id, connection_id)

    try:
        sender_task = asyncio.create_task(send_loop(), name=f"ws-session-send:{session_id}")
        receiver_task = asyncio.create_task(receive_loop(), name=f"ws-session-recv:{session_id}")
        done, pending = await asyncio.wait({sender_task, receiver_task}, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()
        for task in pending:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect):
                await task

        for task in done:
            exception = task.exception()
            if exception is None or isinstance(exception, WebSocketDisconnect):
                continue
            raise exception
    except asyncio.CancelledError:
        raise
    except WebSocketDisconnect:
        pass
    finally:
        await container.event_bus.unsubscribe(session_id, queue)
        await container.session_service.frontend_disconnected(session_id, connection_id)
