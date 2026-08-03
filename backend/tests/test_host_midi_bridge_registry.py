from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.models.session import HostMidiRegisterRequest
from backend.app.services.host_midi_bridge_registry import (
    HostMidiBridgeRegistry,
    session_midi_request_from_bytes,
)


def _request(host_id: str) -> HostMidiRegisterRequest:
    return HostMidiRegisterRequest(
        type="register_host",
        host_id=host_id,
        host_name="Test Host",
        protocol_version=1,
    )


def test_registering_duplicate_host_replaces_previous_connection() -> None:
    registry = HostMidiBridgeRegistry()
    assert registry.register("connection-a", _request("host-a")) == set()

    assert registry.register("connection-b", _request("host-a")) == {"host-a"}
    with pytest.raises(HTTPException):
        registry.require("connection-a")
    assert registry.require("connection-b").host_id == "host-a"


def test_release_returns_removed_lease() -> None:
    registry = HostMidiBridgeRegistry()
    registry.register("connection-a", _request("host-a"))

    assert registry.release("connection-a").host_id == "host-a"
    assert registry.release("connection-a") is None


@pytest.mark.parametrize(
    ("message", "event_type", "channel"),
    [
        ([0x91, 64, 100], "note_on", 2),
        ([0x91, 64, 0], "note_off", 2),
        ([0x81, 64, 10], "note_off", 2),
        ([0xB1, 123, 0], "all_notes_off", 2),
        ([0xB1, 1, 64], "control_change", 2),
    ],
)
def test_session_midi_decoder_maps_supported_channel_messages(
    message: list[int],
    event_type: str,
    channel: int,
) -> None:
    request = session_midi_request_from_bytes(message)

    assert request is not None
    assert request.type == event_type
    assert request.channel == channel


def test_session_midi_decoder_ignores_unsupported_messages() -> None:
    assert session_midi_request_from_bytes([0xF8]) is None
    assert session_midi_request_from_bytes([0xE0, 0, 64]) is None
