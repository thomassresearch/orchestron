from __future__ import annotations

from types import SimpleNamespace
import sys

from backend.app.services.midi_service import MidiBackendInfo, MidiService


def test_list_inputs_uses_stable_ids_when_backend_order_changes(monkeypatch) -> None:
    name_sets = [
        ["Arturia KeyStep 37", "IAC Driver Bus 1"],
        ["IAC Driver Bus 1", "Arturia KeyStep 37"],
    ]
    state = {"index": 0}

    def get_input_names() -> list[str]:
        names = name_sets[state["index"]]
        state["index"] += 1
        return names

    monkeypatch.setitem(sys.modules, "mido", SimpleNamespace(get_input_names=get_input_names))

    service = MidiService()
    service._backend = MidiBackendInfo(name="mido", available=True)

    first = {item.name: item for item in service.list_inputs()}
    second = {item.name: item for item in service.list_inputs()}

    assert first["Arturia KeyStep 37"].id == second["Arturia KeyStep 37"].id
    assert first["IAC Driver Bus 1"].id == second["IAC Driver Bus 1"].id
    assert first["Arturia KeyStep 37"].selector == "0"
    assert second["Arturia KeyStep 37"].selector == "1"


def test_resolve_input_ref_accepts_stable_id_runtime_selector_and_name(monkeypatch) -> None:
    monkeypatch.setitem(
        sys.modules,
        "mido",
        SimpleNamespace(get_input_names=lambda: ["Arturia KeyStep 37"]),
    )

    service = MidiService()
    service._backend = MidiBackendInfo(name="mido", available=True)

    midi_input = service.list_inputs()[0]

    assert service.resolve_input_ref(midi_input.id).name == midi_input.name
    assert service.resolve_input_ref(midi_input.selector).id == midi_input.id
    assert service.resolve_input_ref(midi_input.name).id == midi_input.id
