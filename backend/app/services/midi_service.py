from __future__ import annotations

import logging
import os
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable

from backend.app.models.session import MidiInputRef

logger = logging.getLogger(__name__)
MidiMessageSink = Callable[[list[int]], bool]


@dataclass(slots=True)
class MidiBackendInfo:
    name: str
    available: bool


class MidiService:
    def __init__(self) -> None:
        self._backend = self._detect_backend()
        self._output_ports: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._warned_missing_output_backend = False
        self._virtual_output_sinks: dict[str, dict[str, MidiMessageSink]] = {}

    def list_inputs(self) -> list[MidiInputRef]:
        if self._backend.name == "mido":
            try:
                import mido

                names = mido.get_input_names()
                refs = [
                    MidiInputRef(id=str(index), name=name, backend="mido")
                    for index, name in enumerate(names)
                ]
                if refs:
                    return refs
            except Exception:  # pragma: no cover - runtime dependent
                if self._is_expected_linux_alsa_missing():
                    logger.info(
                        "MIDI backend probing skipped: /dev/snd/seq is unavailable in this container; "
                        "using fallback MIDI inputs."
                    )
                else:
                    logger.exception("Failed to query MIDI inputs via mido")
                self._backend = MidiBackendInfo(name="fallback", available=False)

        return self._fallback_inputs()

    def resolve_input(self, selector: str) -> str:
        return self.resolve_input_ref(selector).id

    def resolve_input_ref(self, selector: str) -> MidiInputRef:
        inputs = self.list_inputs()

        for midi_input in inputs:
            if midi_input.id == selector or midi_input.name == selector:
                return midi_input

        raise ValueError(f"MIDI input '{selector}' is unavailable.")

    def send_message(self, input_selector: str, message: list[int]) -> str:
        return self.send_messages(input_selector, [message])

    def send_messages(self, input_selector: str, messages: list[list[int]]) -> str:
        if len(messages) == 0:
            raise ValueError("At least one MIDI message is required")

        normalized_messages: list[list[int]] = []
        for message in messages:
            if len(message) != 3:
                raise ValueError("MIDI message must contain exactly 3 bytes")
            normalized_messages.append([int(value) & 0xFF for value in message])

        input_ref = self.resolve_input_ref(input_selector)

        if self._backend.name != "mido":
            delivered_total = 0
            for message in normalized_messages:
                delivered_total += self._deliver_virtual_output(input_ref.id, message)
            if delivered_total > 0:
                return f"virtual:{delivered_total}"
            if not self._warned_missing_output_backend:
                logger.warning(
                    "MIDI output backend unavailable; dropping MIDI messages (selector=%s). "
                    "This is expected in Docker-on-macOS without ALSA passthrough.",
                    input_selector,
                )
                self._warned_missing_output_backend = True
            return "mock"

        try:
            import mido

            output_name = self._resolve_output_name(input_ref.id, mido)
            with self._lock:
                port = self._output_ports.get(output_name)
                if port is None or getattr(port, "closed", False):
                    port = mido.open_output(output_name)
                    self._output_ports[output_name] = port

                for message in normalized_messages:
                    port.send(mido.Message.from_bytes(message))
            return output_name
        except ValueError:
            raise
        except Exception as exc:  # pragma: no cover - runtime dependent
            raise RuntimeError(f"Failed to send MIDI message: {exc}") from exc

    def register_virtual_output_sink(
        self,
        *,
        selector: str,
        sink_id: str,
        sink: MidiMessageSink,
    ) -> None:
        input_ref = self.resolve_input_ref(selector)
        with self._lock:
            sinks = self._virtual_output_sinks.setdefault(input_ref.id, {})
            sinks[sink_id] = sink

    def unregister_virtual_output_sink(self, *, selector: str, sink_id: str) -> None:
        try:
            input_ref = self.resolve_input_ref(selector)
        except ValueError:
            return
        with self._lock:
            sinks = self._virtual_output_sinks.get(input_ref.id)
            if not sinks:
                return
            sinks.pop(sink_id, None)
            if not sinks:
                self._virtual_output_sinks.pop(input_ref.id, None)

    @staticmethod
    def _normalize_name(name: str) -> str:
        return " ".join(name.strip().lower().split())

    def _deliver_virtual_output(self, selector_id: str, message: list[int]) -> int:
        with self._lock:
            sinks = list(self._virtual_output_sinks.get(selector_id, {}).values())

        delivered = 0
        for sink in sinks:
            try:
                if sink(message):
                    delivered += 1
            except Exception:
                logger.exception("Virtual MIDI sink delivery failed (selector=%s)", selector_id)
        return delivered

    def _resolve_output_name(self, input_selector: str, mido_module: Any) -> str:
        input_ref = self.resolve_input_ref(input_selector)
        output_names = list(mido_module.get_output_names())
        if not output_names:
            raise ValueError(
                "No backend MIDI outputs are available. Enable the macOS IAC Driver bus in Audio MIDI Setup."
            )

        target = self._normalize_name(input_ref.name)

        exact = next((name for name in output_names if self._normalize_name(name) == target), None)
        if exact:
            return exact

        partial = next(
            (
                name
                for name in output_names
                if target in self._normalize_name(name) or self._normalize_name(name) in target
            ),
            None,
        )
        if partial:
            return partial

        if len(output_names) == 1:
            return output_names[0]

        available = ", ".join(output_names)
        raise ValueError(
            (
                f"No backend MIDI output matched '{input_ref.name}'. "
                f"Available outputs: {available}. "
                "Confirm the IAC Driver bus name and restart the browser/backend."
            )
        )

    @staticmethod
    def _detect_backend() -> MidiBackendInfo:
        if MidiService._is_expected_linux_alsa_missing():
            logger.info("Linux ALSA sequencer device (/dev/snd/seq) not present; using fallback MIDI backend")
            return MidiBackendInfo(name="fallback", available=False)
        try:
            import mido  # noqa: F401

            return MidiBackendInfo(name="mido", available=True)
        except Exception:
            return MidiBackendInfo(name="fallback", available=False)

    @staticmethod
    def _is_expected_linux_alsa_missing() -> bool:
        if not sys.platform.startswith("linux"):
            return False
        # Docker Desktop on macOS/Windows runs Linux containers without host ALSA device passthrough by default.
        return not os.path.exists("/dev/snd/seq")

    @staticmethod
    def _fallback_inputs() -> list[MidiInputRef]:
        if sys.platform == "darwin":
            return [
                MidiInputRef(id="0", name="IAC Driver Bus 1", backend="fallback"),
                MidiInputRef(id="1", name="IAC Driver Bus 2", backend="fallback"),
            ]
        return [
            MidiInputRef(id="0", name="Virtual MIDI Input 1", backend="fallback"),
            MidiInputRef(id="1", name="Virtual MIDI Input 2", backend="fallback"),
        ]
