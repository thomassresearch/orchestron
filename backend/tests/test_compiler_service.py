from __future__ import annotations

from backend.app.models.patch import Connection, NodeInstance, PatchDocument, PatchGraph
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


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


def test_grain3_compile_uses_correct_argument_order_and_omits_optional_tail() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="grain3 compile test",
        description="grain3 renders corrected syntax",
        graph=PatchGraph(
            nodes=[
                NodeInstance(
                    id="grain",
                    opcode="grain3",
                    params={
                        "kcps": 220,
                        "kphs": 0.5,
                        "kfmd": 0.25,
                        "kpmd": 0.125,
                        "kgdur": 0.04,
                        "kdens": 24,
                        "imaxovr": 64,
                        "kfn": 1,
                        "iwfn": 2,
                        "kfrpow": 0,
                        "kprpow": 0,
                    },
                ),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="grain", from_port_id="asig", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="grain", from_port_id="asig", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    grain3_line = next(line.strip() for line in artifact.orc.splitlines() if " grain3 " in line)

    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc
    assert grain3_line == "a_grain_asig_1 grain3 220, 0.5, 0.25, 0.125, 0.04, 24, 64, 1, 2, 0, 0, 0, 0"
