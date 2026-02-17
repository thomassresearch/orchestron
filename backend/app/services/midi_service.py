from __future__ import annotations

import logging
from dataclasses import dataclass

from backend.app.models.session import MidiInputRef

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MidiBackendInfo:
    name: str
    available: bool


class MidiService:
    def __init__(self) -> None:
        self._backend = self._detect_backend()

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
        inputs = self.list_inputs()

        for midi_input in inputs:
            if midi_input.id == selector or midi_input.name == selector:
                return midi_input.id

        raise ValueError(f"MIDI input '{selector}' is unavailable.")

    @staticmethod
    def _detect_backend() -> MidiBackendInfo:
        try:
            import mido  # noqa: F401

            return MidiBackendInfo(name="mido", available=True)
        except Exception:
            return MidiBackendInfo(name="fallback", available=False)
