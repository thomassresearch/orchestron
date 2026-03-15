from __future__ import annotations

from types import SimpleNamespace
import sys

from backend.app.models.session import MidiInputRef
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


def test_virtual_output_sink_receives_scheduled_delivery_delay() -> None:
    service = MidiService()
    service._backend = MidiBackendInfo(name="fallback", available=False)
    service.list_inputs = lambda: [
        MidiInputRef(
            id="fallback:iac-driver-bus-1:abcdef123456",
            name="IAC Driver Bus 1",
            backend="fallback",
            selector="0",
        )
    ]

    captured: list[tuple[list[int], float | None]] = []

    service.register_virtual_output_sink(
        selector="0",
        sink_id="test",
        sink=lambda message, delivery_delay_seconds: captured.append((list(message), delivery_delay_seconds)) or True,
    )

    output = service.send_scheduled_message(
        "0",
        [0x90, 60, 100],
        delivery_delay_seconds=0.125,
    )

    assert output == "virtual:1"
    assert captured == [([0x90, 60, 100], 0.125)]


def test_send_scheduled_messages_uses_coremidi_scheduler_when_available(monkeypatch) -> None:
    scheduler_calls: list[tuple[str, list[list[int]], float | None]] = []

    class FakeCoreMidiScheduler:
        def send_messages(
            self,
            output_name: str,
            messages: list[list[int]],
            *,
            delivery_delay_seconds: float | None,
        ) -> None:
            scheduler_calls.append((output_name, [list(message) for message in messages], delivery_delay_seconds))

    monkeypatch.setitem(
        sys.modules,
        "mido",
        SimpleNamespace(
            get_input_names=lambda: ["IAC Driver Bus 1"],
            get_output_names=lambda: ["IAC Driver Bus 1"],
            open_output=lambda name: (_ for _ in ()).throw(AssertionError(f"unexpected open_output({name})")),
            Message=SimpleNamespace(from_bytes=lambda message: list(message)),
        ),
    )

    service = MidiService()
    service._backend = MidiBackendInfo(name="mido", available=True)
    service._coremidi_scheduler = FakeCoreMidiScheduler()

    output = service.send_scheduled_messages(
        "0",
        [[0x90, 60, 100], [0x80, 60, 0]],
        delivery_delay_seconds=0.05,
    )

    assert output == "IAC Driver Bus 1"
    assert scheduler_calls == [("IAC Driver Bus 1", [[0x90, 60, 100], [0x80, 60, 0]], 0.05)]
