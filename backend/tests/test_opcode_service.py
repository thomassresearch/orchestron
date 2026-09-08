from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.services.opcode_service import OpcodeService
from backend.tests.stk_test_support import STK_CONTROLLERS


@pytest.mark.parametrize("name", STK_CONTROLLERS)
def test_stk_catalog_has_icons_and_complete_localized_help(name: str) -> None:
    root = Path(__file__).resolve().parents[2]
    service = OpcodeService(icon_prefix="/static/icons")
    opcode = service.get_opcode(name)
    assert opcode is not None
    assert (root / "backend/app" / opcode.icon.lstrip("/")).is_file()
    expected_inputs = ["ifrequency", "iamplitude"]
    for index, (controller, _) in enumerate(STK_CONTROLLERS[name], start=1):
        expected_inputs.extend([controller, f"kv{index}"])
    assert [port.id for port in opcode.inputs] == expected_inputs
    assert opcode.template == "{asignal} " + name + " " + ", ".join("{" + port + "}" for port in expected_inputs)
    details = json.loads((root / "frontend/src/lib/opcodeDocDetails.json").read_text())[name]
    assert set(details["inputs"]) == set(expected_inputs)
    assert set(details["outputs"]) == {"asignal"}
    for index, (_, number) in enumerate(STK_CONTROLLERS[name], start=1):
        value_help = details["inputs"][f"kv{index}"]["english"]
        assert f"(controller {number})" in value_help
        assert "Leave unset" in value_help
    for text in [details["description"], *details["inputs"].values(), *details["outputs"].values()]:
        assert set(text) == {"english", "german", "french", "spanish"}
        assert all(value.strip() for value in text.values())
        assert all(text[lang] != text["english"] for lang in ("german", "french", "spanish"))


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
