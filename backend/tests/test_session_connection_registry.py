from __future__ import annotations

from backend.app.services.browser_clock_policy import BrowserClockControllerLease
from backend.app.services.session_connection_registry import SessionConnectionRegistry


async def _send_json(_payload: dict[str, object]) -> None:
    return None


async def _close(_code: int, _reason: str) -> None:
    return None


def _lease(connection_id: str) -> BrowserClockControllerLease:
    return BrowserClockControllerLease(
        connection_id=connection_id,
        sample_rate=48_000,
        queue_low_water_frames=1_024,
        queue_high_water_frames=2_048,
        max_blocks_per_request=32,
        send_json=_send_json,
        close=_close,
    )


def test_frontend_membership_is_removed_when_last_connection_leaves() -> None:
    registry = SessionConnectionRegistry()
    registry.add_frontend("session-a", "connection-a")
    registry.add_frontend("session-a", "connection-b")

    assert registry.remove_frontend("session-a", "connection-a") is True
    assert registry.has_frontend("session-a") is True
    assert registry.remove_frontend("session-a", "connection-b") is True
    assert registry.has_frontend("session-a") is False


def test_browser_controller_replacement_returns_previous_lease() -> None:
    registry = SessionConnectionRegistry()
    first = _lease("connection-a")
    second = _lease("connection-b")

    assert registry.replace_browser_controller("session-a", first) is None
    assert registry.replace_browser_controller("session-a", second) is first
    assert registry.remove_browser_controller("session-a", connection_id="connection-a") is None
    assert registry.remove_browser_controller("session-a", connection_id="connection-b") is second
