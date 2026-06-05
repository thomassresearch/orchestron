from __future__ import annotations

import asyncio
from dataclasses import dataclass

from backend.app.models.session import SessionEvent


class SessionEventSubscriptionLimitExceededError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SessionEventBusStats:
    session_count: int
    subscription_count: int
    subscriptions_by_session: dict[str, int]


class SessionEventBus:
    def __init__(
        self,
        *,
        max_subscriptions_total: int,
        max_subscriptions_per_session: int,
    ) -> None:
        self._queues: dict[str, set[asyncio.Queue[SessionEvent]]] = {}
        self._max_subscriptions_total = max(1, int(max_subscriptions_total))
        self._max_subscriptions_per_session = max(1, int(max_subscriptions_per_session))
        self._lock = asyncio.Lock()

    async def subscribe(self, session_id: str) -> asyncio.Queue[SessionEvent]:
        async with self._lock:
            queues = self._queues.get(session_id)
            session_subscription_count = len(queues) if queues is not None else 0
            if session_subscription_count >= self._max_subscriptions_per_session:
                raise SessionEventSubscriptionLimitExceededError(
                    "Session event WebSocket subscription capacity reached for this session."
                )
            if self._subscription_count_unlocked() >= self._max_subscriptions_total:
                raise SessionEventSubscriptionLimitExceededError(
                    "Session event WebSocket subscription capacity reached."
                )

            queue: asyncio.Queue[SessionEvent] = asyncio.Queue(maxsize=100)
            if queues is None:
                queues = set()
                self._queues[session_id] = queues
            queues.add(queue)
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

    async def stats(self) -> SessionEventBusStats:
        async with self._lock:
            subscriptions_by_session = {
                session_id: len(queues)
                for session_id, queues in self._queues.items()
            }
            return SessionEventBusStats(
                session_count=len(subscriptions_by_session),
                subscription_count=sum(subscriptions_by_session.values()),
                subscriptions_by_session=subscriptions_by_session,
            )

    def _subscription_count_unlocked(self) -> int:
        return sum(len(queues) for queues in self._queues.values())
