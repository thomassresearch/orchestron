from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import HTTPException

from backend.app.engine.midi_scheduler import ClockDomainMapping
from backend.app.models.session import HostMidiRegisterRequest, SessionMidiEventRequest


def session_midi_request_from_bytes(message: list[int]) -> SessionMidiEventRequest | None:
    """Decode the three-byte channel messages accepted by session MIDI routing."""
    if len(message) != 3:
        return None
    status = int(message[0]) & 0xF0
    channel = (int(message[0]) & 0x0F) + 1
    data1 = int(message[1]) & 0x7F
    data2 = int(message[2]) & 0x7F

    if status == 0x90:
        if data2 == 0:
            return SessionMidiEventRequest(type="note_off", channel=channel, note=data1)
        return SessionMidiEventRequest(type="note_on", channel=channel, note=data1, velocity=data2)
    if status == 0x80:
        return SessionMidiEventRequest(type="note_off", channel=channel, note=data1)
    if status == 0xB0 and data1 in {120, 123}:
        return SessionMidiEventRequest(type="all_notes_off", channel=channel)
    if status == 0xB0:
        return SessionMidiEventRequest(type="control_change", channel=channel, controller=data1, value=data2)
    return None


@dataclass(slots=True)
class HostMidiBridgeLease:
    connection_id: str
    host_id: str
    host_name: str | None = None
    protocol_version: int = 1
    timing_mapping: ClockDomainMapping = field(default_factory=ClockDomainMapping)


class HostMidiBridgeRegistry:
    """Owns host bridge leases; callers serialize access with their service lock."""

    def __init__(self) -> None:
        self._leases: dict[str, HostMidiBridgeLease] = {}

    def register(self, connection_id: str, request: HostMidiRegisterRequest) -> set[str]:
        replacement_host_ids: set[str] = set()
        existing = self._leases.get(connection_id)
        if existing is not None:
            replacement_host_ids.add(existing.host_id)

        duplicate_connection_ids = [
            bridge_connection_id
            for bridge_connection_id, lease in self._leases.items()
            if bridge_connection_id != connection_id and lease.host_id == request.host_id
        ]
        for bridge_connection_id in duplicate_connection_ids:
            removed = self._leases.pop(bridge_connection_id, None)
            if removed is not None:
                replacement_host_ids.add(removed.host_id)

        self._leases[connection_id] = HostMidiBridgeLease(
            connection_id=connection_id,
            host_id=request.host_id,
            host_name=request.host_name,
            protocol_version=request.protocol_version,
        )
        return replacement_host_ids

    def require(self, connection_id: str) -> HostMidiBridgeLease:
        lease = self._leases.get(connection_id)
        if lease is None:
            raise HTTPException(status_code=409, detail="Host MIDI bridge must register before sending data.")
        return lease

    def release(self, connection_id: str) -> HostMidiBridgeLease | None:
        return self._leases.pop(connection_id, None)
