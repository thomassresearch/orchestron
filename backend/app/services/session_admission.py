from __future__ import annotations

from dataclasses import dataclass
import math

from fastapi import HTTPException

from backend.app.core.config import Settings


@dataclass(slots=True)
class RateBucket:
    tokens: float
    updated_at: float


class SessionAdmissionController:
    """Owns session quotas and per-client token buckets.

    Callers provide serialization (the SessionService lock) so quota checks and
    session commits remain part of one atomic critical section.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._session_clients: dict[str, str] = {}
        self._session_create_rate_buckets: dict[str, RateBucket] = {}
        self._session_event_ws_connect_rate_buckets: dict[str, RateBucket] = {}
        self._pending_session_creates = 0
        self._pending_session_creates_by_client: dict[str, int] = {}

    @staticmethod
    def normalize_client_key(client_key: str) -> str:
        normalized = client_key.strip()
        return normalized if normalized else "unknown"

    def reserve_session_create(self, client_key: str, *, active_session_count: int, now: float) -> None:
        active_total = active_session_count + self._pending_session_creates
        if active_total >= self._settings.session_max_active:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Active session capacity reached "
                    f"({self._settings.session_max_active} sessions). Delete or wait for idle sessions."
                ),
            )

        active_for_client = self.session_count_for_client(client_key)
        active_for_client += self._pending_session_creates_by_client.get(client_key, 0)
        if active_for_client >= self._settings.session_max_active_per_client:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Client active session quota reached "
                    f"({self._settings.session_max_active_per_client} sessions)."
                ),
            )

        bucket = self._refill_session_create_bucket(client_key, now)
        if bucket.tokens < 1.0:
            rate_per_second = self._settings.session_create_rate_per_minute / 60.0
            retry_after = max(1, int(math.ceil((1.0 - bucket.tokens) / rate_per_second)))
            raise HTTPException(
                status_code=429,
                detail="Session creation rate limit exceeded.",
                headers={"Retry-After": str(retry_after)},
            )

        bucket.tokens -= 1.0
        self._pending_session_creates += 1
        self._pending_session_creates_by_client[client_key] = (
            self._pending_session_creates_by_client.get(client_key, 0) + 1
        )

    def release_session_create_reservation(self, client_key: str) -> None:
        if self._pending_session_creates > 0:
            self._pending_session_creates -= 1
        pending_for_client = self._pending_session_creates_by_client.get(client_key, 0)
        if pending_for_client <= 1:
            self._pending_session_creates_by_client.pop(client_key, None)
        else:
            self._pending_session_creates_by_client[client_key] = pending_for_client - 1

    def commit_session(self, session_id: str, client_key: str) -> None:
        self._session_clients[session_id] = client_key
        self.release_session_create_reservation(client_key)

    def remove_session(self, session_id: str) -> None:
        self._session_clients.pop(session_id, None)

    def session_count_for_client(self, client_key: str) -> int:
        return sum(1 for owner in self._session_clients.values() if owner == client_key)

    def validate_event_ws_connect(self, client_key: str, *, now: float) -> None:
        bucket = self._refill_event_ws_connect_bucket(client_key, now)
        if bucket.tokens < 1.0:
            rate_per_second = self._settings.session_event_ws_connect_rate_per_minute / 60.0
            retry_after = max(1, int(math.ceil((1.0 - bucket.tokens) / rate_per_second)))
            raise HTTPException(
                status_code=429,
                detail="Session event WebSocket connection rate limit exceeded.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.tokens -= 1.0

    def _refill_session_create_bucket(self, client_key: str, now: float) -> RateBucket:
        return self._refill_bucket(
            self._session_create_rate_buckets,
            client_key,
            now=now,
            burst=self._settings.session_create_rate_burst,
            rate_per_minute=self._settings.session_create_rate_per_minute,
        )

    def _refill_event_ws_connect_bucket(self, client_key: str, now: float) -> RateBucket:
        return self._refill_bucket(
            self._session_event_ws_connect_rate_buckets,
            client_key,
            now=now,
            burst=self._settings.session_event_ws_connect_rate_burst,
            rate_per_minute=self._settings.session_event_ws_connect_rate_per_minute,
        )

    @staticmethod
    def _refill_bucket(
        buckets: dict[str, RateBucket],
        client_key: str,
        *,
        now: float,
        burst: int,
        rate_per_minute: float,
    ) -> RateBucket:
        normalized_burst = float(burst)
        bucket = buckets.get(client_key)
        if bucket is None:
            bucket = RateBucket(tokens=normalized_burst, updated_at=now)
            buckets[client_key] = bucket
            return bucket

        elapsed_seconds = max(0.0, now - bucket.updated_at)
        bucket.tokens = min(
            normalized_burst,
            bucket.tokens + elapsed_seconds * (rate_per_minute / 60.0),
        )
        bucket.updated_at = now
        return bucket
