"""Ephemeral lane output controls, independent of transport and authored configuration."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def lane_id(track_id: str) -> str:
    parts = track_id.split(":")
    return parts[1] if len(parts) == 3 and parts[0] == "drumrow" else track_id


@dataclass(frozen=True)
class LaneRouting:
    channels: tuple[int, ...]
    input_channel: int | None = None


class LaneOutputGate:
    # Access is serialized by the render boundary. MIDI producers only enqueue events.
    def __init__(self) -> None:
        self.revision = -1
        self.controls: dict[str, dict[str, bool]] = {}
        self.routing: dict[str, LaneRouting] = {}
        self.blocked: frozenset[str] = frozenset()
        self._notes: dict[tuple[str, int, int], bool] = {}
        self._sounding: dict[tuple[int, int], int] = {}

    def configure(self, config: Any) -> None:
        routing = {lane_id(t.track_id): LaneRouting((t.midi_channel,)) for t in config.tracks}
        routing.update({t.track_id: LaneRouting(tuple(t.target_channels or ())) for t in config.controller_tracks})
        self.routing = routing
        self.configure_arpeggiators(config.arpeggiators)

    def configure_arpeggiators(self, configs: Any) -> None:
        self.routing = {key: route for key, route in self.routing.items() if route.input_channel is None}
        self.routing.update({a.arpeggiator_id: LaneRouting((a.target_channel,), a.input_channel)
                             for a in configs if a.playback_mode == "arranger"})
        self.controls = {key: value for key, value in self.controls.items() if key in self.routing}
        self._resolve()

    def apply(self, revision: int, controls: dict[str, dict[str, bool]]) -> None:
        if controls.keys() - self.routing.keys():
            raise ValueError("Unknown arranger lane.")
        if revision < self.revision or revision == self.revision and controls != self.controls:
            raise ValueError("Stale lane output revision.")
        self.revision = revision
        self.controls = controls
        self._resolve()

    def _resolve(self) -> None:
        solos = {key for key, value in self.controls.items() if value["solo"]}
        allowed = set(solos)
        # A soloed arpeggiator needs its feeders; a soloed feeder needs its processor.
        for key in solos:
            route = self.routing.get(key)
            if route and route.input_channel is not None:
                allowed.update(k for k, r in self.routing.items() if route.input_channel in r.channels)
        for key, route in self.routing.items():
            if route.input_channel is not None and any(route.input_channel in self.routing[k].channels for k in allowed):
                allowed.add(key)
        self.blocked = frozenset(key for key in self.routing
                                if self.controls.get(key, {}).get("mute") or solos and key not in allowed)

    def status(self) -> dict[str, Any]:
        return {"revision": self.revision, "lanes": {key: {"mute": self.controls.get(key, {}).get("mute", False),
                "solo": self.controls.get(key, {}).get("solo", False), "suppressed": key in self.blocked}
                for key in self.routing}}

    def reset_notes(self) -> None:
        self._notes.clear()
        self._sounding.clear()

    def source_releases(self, sources: set[str]) -> list[tuple[str, list[int]]]:
        """Release only voices actually delivered; ownership is consumed at delivery."""
        return [(source.removeprefix("output:"), [0x80 + channel, note, 0])
                for (source, channel, note), sounded in self._notes.items()
                if sounded and source.startswith("output:") and source.removeprefix("output:") in sources]

    def allows(self, source: str, message: bytes | tuple[int, ...] | list[int], *, stage: str = "output") -> bool:
        status, note, velocity = message
        channel, kind = status & 15, status & 0xf0
        key = (f"{stage}:{source}", channel, note)
        pitch = (channel, note)
        blocked = source.startswith("lane:") and lane_id(source[5:]) in self.blocked
        if kind == 0x90 and velocity:
            was_sounding = self._notes.get(key, False)
            self._notes[key] = not blocked
            if stage == "output":
                count = self._sounding.get(pitch, 0) + int(not blocked) - int(was_sounding)
                if count:
                    self._sounding[pitch] = count
                else:
                    self._sounding.pop(pitch, None)
            return not blocked
        if kind == 0x80 or kind == 0x90 and not velocity:
            sounded = self._notes.pop(key, None)
            if sounded is False or sounded is None and source.startswith("lane:"):
                return False
            # Shared-channel MIDI has no voice ID: retain another source's held pitch.
            if stage == "output":
                count = self._sounding.get(pitch, 0) - int(bool(sounded))
                if count > 0:
                    self._sounding[pitch] = count
                    return False
                self._sounding.pop(pitch, None)
            return True
        if kind == 0xb0 and note in {120, 123}:
            if blocked:
                return False
            self._notes = {k: value for k, value in self._notes.items()
                           if k[1] != channel or not k[0].startswith(f"{stage}:")}
            if stage == "output":
                self._sounding = {pitch: count for pitch, count in self._sounding.items() if pitch[0] != channel}
        return not blocked
