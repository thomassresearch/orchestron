from __future__ import annotations

import asyncio
from collections import defaultdict

from backend.app.models.session import SessionEvent


class SessionEventBus:
    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue[SessionEvent]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, session_id: str) -> asyncio.Queue[SessionEvent]:
        queue: asyncio.Queue[SessionEvent] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._queues[session_id].add(queue)
        return queue

    async def unsubscribe(self, session_id: str, queue: asyncio.Queue[SessionEvent]) -> None:
        async with self._lock:
            queues = self._queues.get(session_id)
            if not queues:
                return
            queues.discard(queue)
            if not queues:
                self._queues.pop(session_id, None)

    async def publish(self, event: SessionEvent) -> None:
        async with self._lock:
            queues = list(self._queues.get(event.session_id, set()))

        for queue in queues:
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await queue.put(event)
