from __future__ import annotations

import asyncio
import contextlib
import json
import time
from uuid import uuid4

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.app.core.container import AppContainer
from backend.app.models.session import (
    BrowserClockClaimControllerRequest,
    BrowserClockManualMidiRequest,
    BrowserClockQueuePadControlRequest,
    BrowserClockReleaseControllerRequest,
    BrowserClockRequestRenderRequest,
    BrowserClockSequencerCommandRequest,
    BrowserClockSequencerStartControlRequest,
    BrowserClockTimingReportRequest,
    HostMidiClockSyncRequest,
    HostMidiDeviceInventoryRequest,
    HostMidiEventsRequest,
    HostMidiRegisterRequest,
)

router = APIRouter(tags=["ws"])


def _http_error_detail(detail: object) -> str:
    if isinstance(detail, str):
        return detail
    try:
        return json.dumps(detail)
    except TypeError:
        return str(detail)


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


@router.websocket("/ws/sessions/{session_id}/browser-clock")
async def browser_clock_controller(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()

    container: AppContainer = websocket.app.state.container
    connection_id = str(uuid4())
    send_lock = asyncio.Lock()

    async def send_json(payload: dict[str, object]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def send_bytes(payload: bytes) -> None:
        async with send_lock:
            await websocket.send_bytes(payload)

    async def close_socket(code: int, reason: str) -> None:
        async with send_lock:
            await websocket.close(code=code, reason=reason)

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                await send_json({"type": "engine_error", "detail": "Browser-clock messages must be valid JSON."})
                continue

            if not isinstance(payload, dict):
                await send_json({"type": "engine_error", "detail": "Browser-clock messages must be JSON objects."})
                continue

            message_type = payload.get("type")
            server_received_ns = time.perf_counter_ns()
            try:
                if message_type == "claim_controller":
                    response = await container.session_service.claim_browser_clock_controller(
                        session_id,
                        connection_id,
                        BrowserClockClaimControllerRequest.model_validate(payload),
                        send_json=send_json,
                        close=close_socket,
                    )
                    await send_json(response)
                    continue

                if message_type == "request_render":
                    metadata, pcm = await container.session_service.render_browser_clock_audio(
                        session_id,
                        connection_id,
                        BrowserClockRequestRenderRequest.model_validate(payload),
                        server_received_ns=server_received_ns,
                    )
                    await send_json(metadata)
                    await send_bytes(pcm)
                    continue

                if message_type == "manual_midi":
                    await container.session_service.browser_clock_manual_midi(
                        session_id,
                        connection_id,
                        BrowserClockManualMidiRequest.model_validate(payload),
                        server_received_ns=server_received_ns,
                    )
                    continue

                if message_type == "timing_report":
                    await container.session_service.browser_clock_timing_report(
                        session_id,
                        connection_id,
                        BrowserClockTimingReportRequest.model_validate(payload),
                        server_received_ns=server_received_ns,
                    )
                    continue

                if message_type == "sequencer_start":
                    response = await container.session_service.browser_clock_start_sequencer(
                        session_id,
                        connection_id,
                        BrowserClockSequencerStartControlRequest.model_validate(payload),
                    )
                    await send_json(response)
                    continue

                if message_type in {"sequencer_stop", "sequencer_rewind", "sequencer_forward"}:
                    response = await container.session_service.browser_clock_command_sequencer(
                        session_id,
                        connection_id,
                        BrowserClockSequencerCommandRequest.model_validate(payload),
                    )
                    await send_json(response)
                    continue

                if message_type == "queue_pad":
                    response = await container.session_service.browser_clock_queue_pad(
                        session_id,
                        connection_id,
                        BrowserClockQueuePadControlRequest.model_validate(payload),
                    )
                    await send_json(response)
                    continue

                if message_type == "release_controller":
                    await container.session_service.browser_clock_release_controller(
                        session_id,
                        connection_id,
                        BrowserClockReleaseControllerRequest.model_validate(payload),
                    )
                    await close_socket(1000, "controller_released")
                    return

                await send_json(
                    {
                        "type": "engine_error",
                        "detail": f"Unsupported browser-clock message type: {message_type!r}",
                    }
                )
            except ValidationError as exc:
                await send_json({"type": "engine_error", "detail": str(exc)})
            except HTTPException as exc:
                await send_json({"type": "engine_error", "detail": _http_error_detail(exc.detail)})
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                await send_json({"type": "engine_error", "detail": str(exc)})
    except asyncio.CancelledError:
        raise
    except WebSocketDisconnect:
        pass
    finally:
        with contextlib.suppress(HTTPException):
            await container.session_service.release_browser_clock_controller(session_id, connection_id)


@router.websocket("/ws/host-midi")
async def host_midi_bridge(websocket: WebSocket) -> None:
    container: AppContainer = websocket.app.state.container
    expected_token = container.settings.host_midi_token
    authorization_header = websocket.headers.get("authorization", "").strip()

    await websocket.accept()

    if not expected_token:
        await websocket.send_json({"type": "engine_error", "detail": "Host MIDI bridge is disabled."})
        await websocket.close(code=4403, reason="host_midi_disabled")
        return
    if authorization_header != f"Bearer {expected_token}":
        await websocket.send_json({"type": "engine_error", "detail": "Host MIDI bridge authorization failed."})
        await websocket.close(code=4403, reason="host_midi_unauthorized")
        return

    connection_id = str(uuid4())
    send_lock = asyncio.Lock()

    async def send_json(payload: dict[str, object]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                await send_json({"type": "engine_error", "detail": "Host MIDI messages must be valid JSON."})
                continue

            if not isinstance(payload, dict):
                await send_json({"type": "engine_error", "detail": "Host MIDI messages must be JSON objects."})
                continue

            message_type = payload.get("type")
            try:
                if message_type == "register_host":
                    await send_json(
                        await container.session_service.register_host_midi_bridge(
                            connection_id,
                            HostMidiRegisterRequest.model_validate(payload),
                        )
                    )
                    continue

                if message_type == "clock_sync":
                    await send_json(
                        await container.session_service.host_midi_clock_sync(
                            connection_id,
                            HostMidiClockSyncRequest.model_validate(payload),
                        )
                    )
                    continue

                if message_type == "device_inventory":
                    await send_json(
                        await container.session_service.host_midi_device_inventory(
                            connection_id,
                            HostMidiDeviceInventoryRequest.model_validate(payload),
                        )
                    )
                    continue

                if message_type == "midi_events":
                    await container.session_service.host_midi_events(
                        connection_id,
                        HostMidiEventsRequest.model_validate(payload),
                    )
                    continue

                await send_json(
                    {
                        "type": "engine_error",
                        "detail": f"Unsupported host MIDI message type: {message_type!r}",
                    }
                )
            except ValidationError as exc:
                await send_json({"type": "engine_error", "detail": str(exc)})
            except HTTPException as exc:
                await send_json({"type": "engine_error", "detail": _http_error_detail(exc.detail)})
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                await send_json({"type": "engine_error", "detail": str(exc)})
    except asyncio.CancelledError:
        raise
    except WebSocketDisconnect:
        pass
    finally:
        with contextlib.suppress(HTTPException):
            await container.session_service.release_host_midi_bridge(connection_id)
