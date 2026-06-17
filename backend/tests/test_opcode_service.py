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


def test_opcode_service_loads_stereo_reverb_entries() -> None:
    service = OpcodeService(icon_prefix="/static/icons")

    freeverb = service.get_opcode("freeverb")
    assert freeverb is not None
    assert freeverb.category == "reverb"
    assert freeverb.icon == "/static/icons/reverb.svg"
    assert freeverb.documentation_url == "https://csound.com/docs/manual/freeverb.html"
    assert [port.id for port in freeverb.outputs] == ["aout_l", "aout_r"]
    assert [port.id for port in freeverb.inputs] == [
        "ain_l",
        "ain_r",
        "kroomsize",
        "khfdamp",
        "israte",
        "iskip",
    ]
    assert freeverb.inputs[4].default == "sr"
    assert freeverb.inputs[4].required is False

    reverbsc = service.get_opcode("reverbsc")
    assert reverbsc is not None
    assert reverbsc.category == "reverb"
    assert reverbsc.icon == "/static/icons/reverb.svg"
    assert reverbsc.documentation_url == "https://csound.com/docs/manual/reverbsc.html"
    assert [port.id for port in reverbsc.outputs] == ["aout_l", "aout_r"]
    assert [port.id for port in reverbsc.inputs] == [
        "ain_l",
        "ain_r",
        "kfblvl",
        "kfco",
        "israte",
        "ipitchm",
        "iskip",
    ]
    assert reverbsc.inputs[5].default == 1
    assert reverbsc.inputs[5].required is False
