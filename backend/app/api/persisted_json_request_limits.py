from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from backend.app.core.config import Settings
from backend.app.services.persisted_json_limits import PERSISTED_JSON_REQUEST_OVERHEAD_BYTES

Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[dict[str, Any], Receive, Send], Awaitable[None]]


class PersistedJsonRequestLimitMiddleware:
    def __init__(self, app: ASGIApp, *, settings: Settings, api_prefix: str) -> None:
        self.app = app
        self._settings = settings
        self._api_prefix = api_prefix.rstrip("/")

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_size = self._limit_for_scope(scope)
        if max_size is None:
            await self.app(scope, receive, send)
            return

        if self._declared_too_large(scope=scope, max_size=max_size):
            await self._send_too_large(send=send, max_size=max_size)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] != "http.request":
                await self.app(scope, _single_message_receive(message), send)
                return

            chunk = message.get("body", b"")
            next_size = len(body) + len(chunk)
            if next_size > max_size:
                await self._send_too_large(send=send, max_size=max_size)
                return
            body.extend(chunk)

            if not message.get("more_body", False):
                break

        replayed = False

        async def replay_receive() -> dict[str, Any]:
            nonlocal replayed
            if replayed:
                return {"type": "http.request", "body": b"", "more_body": False}
            replayed = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay_receive, send)

    def _limit_for_scope(self, scope: dict[str, Any]) -> int | None:
        method = scope.get("method", "").upper()
        path = str(scope.get("path", ""))
        app_state_path = f"{self._api_prefix}/app-state"
        patches_path = f"{self._api_prefix}/patches"
        performances_path = f"{self._api_prefix}/performances"

        if method == "PUT" and path == app_state_path:
            return self._settings.app_state_max_bytes + PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
        if method == "POST" and path == patches_path:
            return self._settings.patch_graph_max_bytes + PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
        if method == "PUT" and path.startswith(f"{patches_path}/"):
            return self._settings.patch_graph_max_bytes + PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
        if method == "POST" and path == performances_path:
            return self._settings.performance_config_max_bytes + PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
        if method == "PUT" and path.startswith(f"{performances_path}/"):
            return self._settings.performance_config_max_bytes + PERSISTED_JSON_REQUEST_OVERHEAD_BYTES
        return None

    def _declared_too_large(self, *, scope: dict[str, Any], max_size: int) -> bool:
        for name, value in scope.get("headers", []):
            if name.lower() != b"content-length":
                continue
            try:
                return int(value.decode("ascii")) > max_size
            except ValueError:
                return False
        return False

    async def _send_too_large(self, *, send, max_size: int) -> None:
        body = json.dumps(
            {"detail": f"Persistent JSON request exceeds maximum size ({max_size} bytes)."}
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body, "more_body": False})


def _single_message_receive(message: dict[str, Any]) -> Receive:
    async def receive() -> dict[str, Any]:
        return message

    return receive
