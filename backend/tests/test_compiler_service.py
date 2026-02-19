from __future__ import annotations

from backend.app.services.compiler_service import CompilerService


def test_wrap_csd_uses_auhal_and_coremidi_on_macos(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.services.compiler_service.sys.platform", "darwin")

    csd = CompilerService._wrap_csd("instr 1\nendin", midi_input="0", rtmidi_module="cmidi")

    assert "-+rtmidi=coremidi" in csd
    assert "-+rtmidi=cmidi" not in csd
    assert "-b 128" in csd
    assert "-B512" in csd
    assert "-+rtaudio=auhal" in csd


def test_wrap_csd_omits_rtaudio_on_non_macos(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.services.compiler_service.sys.platform", "linux")

    csd = CompilerService._wrap_csd("instr 1\nendin", midi_input="0", rtmidi_module="alsaseq")

    assert "-+rtmidi=alsaseq" in csd
    assert "-b 128" in csd
    assert "-B512" in csd
    assert "-+rtaudio=" not in csd


def test_wrap_csd_uses_explicit_buffer_sizes(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.services.compiler_service.sys.platform", "linux")

    csd = CompilerService._wrap_csd(
        "instr 1\nendin",
        midi_input="2",
        rtmidi_module="alsaseq",
        software_buffer=256,
        hardware_buffer=1024,
    )

    assert "-M2" in csd
    assert "-+rtmidi=alsaseq" in csd
    assert "-b 256" in csd
    assert "-B1024" in csd
