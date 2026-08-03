from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.core.config import Settings
from backend.app.services.session_admission import SessionAdmissionController


def _controller(**overrides: object) -> SessionAdmissionController:
    values: dict[str, object] = {
        "session_max_active": 2,
        "session_max_active_per_client": 1,
        "session_create_rate_per_minute": 60.0,
        "session_create_rate_burst": 1,
        "session_event_ws_connect_rate_per_minute": 60.0,
        "session_event_ws_connect_rate_burst": 1,
    }
    values.update(overrides)
    settings = Settings(**values)
    return SessionAdmissionController(settings)


def test_session_reservation_and_commit_enforce_per_client_quota() -> None:
    controller = _controller()
    controller.reserve_session_create("client-a", active_session_count=0, now=0.0)
    controller.commit_session("session-a", "client-a")

    with pytest.raises(HTTPException) as exc_info:
        controller.reserve_session_create("client-a", active_session_count=1, now=1.0)
    assert exc_info.value.status_code == 429
    assert "Client active session quota" in str(exc_info.value.detail)


def test_failed_reservation_can_be_released_without_leaking_capacity() -> None:
    controller = _controller(session_max_active_per_client=2)
    controller.reserve_session_create("client-a", active_session_count=0, now=0.0)
    controller.release_session_create_reservation("client-a")

    controller.reserve_session_create("client-b", active_session_count=0, now=1.0)


def test_event_websocket_rate_limit_refills_over_time() -> None:
    controller = _controller()
    controller.validate_event_ws_connect("client-a", now=0.0)

    with pytest.raises(HTTPException) as exc_info:
        controller.validate_event_ws_connect("client-a", now=0.0)
    assert exc_info.value.status_code == 429

    controller.validate_event_ws_connect("client-a", now=1.0)
