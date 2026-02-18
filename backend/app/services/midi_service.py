from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

from backend.app.models.session import MidiInputRef

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MidiBackendInfo:
    name: str
    available: bool


class MidiService:
    def __init__(self) -> None:
        self._backend = self._detect_backend()
        self._output_ports: dict[str, Any] = {}
        self._lock = threading.Lock()

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
                logger.exception("Failed to query MIDI inputs via mido")

        # Fallback to a deterministic set including the macOS IAC bus convention.
        return [
            MidiInputRef(id="0", name="IAC Driver Bus 1", backend="fallback"),
            MidiInputRef(id="1", name="IAC Driver Bus 2", backend="fallback"),
        ]

    def resolve_input(self, selector: str) -> str:
        return self.resolve_input_ref(selector).id

    def resolve_input_ref(self, selector: str) -> MidiInputRef:
        inputs = self.list_inputs()

        for midi_input in inputs:
            if midi_input.id == selector or midi_input.name == selector:
                return midi_input

        raise ValueError(f"MIDI input '{selector}' is unavailable.")

    def send_message(self, input_selector: str, message: list[int]) -> str:
        if len(message) != 3:
            raise ValueError("MIDI message must contain exactly 3 bytes")

        message = [int(value) & 0xFF for value in message]

        if self._backend.name != "mido":
            logger.warning(
                "MIDI output backend unavailable; message dropped (selector=%s message=%s)",
                input_selector,
                message,
            )
            return "mock"

        try:
            import mido

            output_name = self._resolve_output_name(input_selector, mido)
            with self._lock:
                port = self._output_ports.get(output_name)
                if port is None or getattr(port, "closed", False):
                    port = mido.open_output(output_name)
                    self._output_ports[output_name] = port

            port.send(mido.Message.from_bytes(message))
            return output_name
        except ValueError:
            raise
        except Exception as exc:  # pragma: no cover - runtime dependent
            raise RuntimeError(f"Failed to send MIDI message: {exc}") from exc

    @staticmethod
    def _normalize_name(name: str) -> str:
        return " ".join(name.strip().lower().split())

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
        try:
            import mido  # noqa: F401

            return MidiBackendInfo(name="mido", available=True)
        except Exception:
            return MidiBackendInfo(name="fallback", available=False)
