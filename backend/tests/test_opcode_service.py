from __future__ import annotations

from backend.app.services.opcode_service import OpcodeService


def test_opcode_service_loads_catalog_from_data_file() -> None:
    service = OpcodeService(icon_prefix="/static/icons")

    oscili = service.get_opcode("oscili")
    assert oscili is not None
    assert oscili.name == "oscili"
    assert oscili.icon == "/static/icons/oscili.svg"
    assert oscili.documentation_url == "https://csound.com/docs/manual/oscili.html"
    assert any(port.id == "freq" for port in oscili.inputs)
    assert any(port.id == "asig" for port in oscili.outputs)


def test_opcode_categories_match_loaded_catalog() -> None:
    service = OpcodeService(icon_prefix="/static/icons")

    categories = service.categories()
    opcodes = service.list_opcodes()

    assert categories
    assert sum(categories.values()) == len(opcodes)
    assert "oscillator" in categories


def test_opcode_service_loads_cross_modulation_and_tanh_entries() -> None:
    service = OpcodeService(icon_prefix="/static/icons")

    tanh = service.get_opcode("tanh")
    assert tanh is not None
    assert tanh.documentation_url == "https://csound.com/docs/manual/tanh.html"
    assert [signal_type.value for signal_type in tanh.inputs[0].accepted_signal_types] == ["a", "k", "i"]

    crossfmpmi = service.get_opcode("crossfmpmi")
    assert crossfmpmi is not None
    assert crossfmpmi.icon == "/static/icons/vco.svg"
    assert crossfmpmi.documentation_url == "https://csound.com/docs/manual/crossfm.html"
    assert [port.id for port in crossfmpmi.outputs] == ["a1", "a2"]
