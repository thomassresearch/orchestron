from __future__ import annotations

from backend.app.models.patch import Connection, EngineConfig, NodeInstance, NodePosition, PatchDocument, PatchGraph
from backend.app.services.compiler_common import SfloadGlobalRequest
from backend.app.services.compiler_orchestra import OrchestraEmitter
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


def test_wrap_csd_uses_headless_coremidi_on_macos(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.services.compiler_service.sys.platform", "darwin")

    csd = CompilerService._wrap_csd("instr 1\nendin", midi_input="0", rtmidi_module="cmidi")

    assert "-+rtmidi=coremidi" in csd
    assert "-+rtmidi=cmidi" not in csd
    assert "-n" in csd
    assert "-b 128" in csd
    assert "-B512" in csd
    assert "-+rtaudio=" not in csd
    assert "-odac" not in csd


def test_wrap_csd_omits_rtaudio_on_non_macos(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.services.compiler_service.sys.platform", "linux")

    csd = CompilerService._wrap_csd("instr 1\nendin", midi_input="0", rtmidi_module="alsaseq")

    assert "-+rtmidi=alsaseq" in csd
    assert "-n" in csd
    assert "-b 128" in csd
    assert "-B512" in csd
    assert "-+rtaudio=" not in csd
    assert "-odac" not in csd


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
    assert "-n" in csd
    assert "-b 256" in csd
    assert "-B1024" in csd


def test_compile_escapes_legacy_patch_and_node_metadata_in_orc_comments() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    malicious_node_id = "n1\ninstr 99\nendin"
    malicious_header_node_id = "limit\ninstr 55\nendin"
    patch = PatchDocument.model_construct(
        id="patch-1\ninstr 77",
        name="Injected Patch\ninstr 88",
        description="legacy document bypasses request validation",
        schema_version=1,
        graph=PatchGraph.model_construct(
            nodes=[
                NodeInstance.model_construct(
                    id=malicious_node_id,
                    opcode="const_a",
                    params={"value": 0.2},
                    position=NodePosition(),
                ),
                NodeInstance.model_construct(
                    id=malicious_header_node_id,
                    opcode="maxalloc",
                    params={"icount": 4},
                    position=NodePosition(),
                ),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection.model_construct(
                    from_node_id=malicious_node_id,
                    from_port_id="aout",
                    to_node_id="out",
                    to_port_id="left",
                ),
                Connection.model_construct(
                    from_node_id=malicious_node_id,
                    from_port_id="aout",
                    to_node_id="out",
                    to_port_id="right",
                ),
            ],
            ui_layout={},
            engine_config=EngineConfig(),
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    lines = [line.strip() for line in artifact.orc.splitlines()]

    assert '; patch:"patch-1\\ninstr 77" name:"Injected Patch\\ninstr 88" channel:0' in artifact.orc
    assert '; node:"n1\\ninstr 99\\nendin" opcode:const_a' in artifact.orc
    assert '; node:"limit\\ninstr 55\\nendin" opcode:maxalloc' in artifact.orc
    assert "instr 99" not in lines
    assert "instr 88" not in lines
    assert "instr 77" not in lines
    assert "instr 55" not in lines
    assert lines.count("endin") == 1


def test_sfload_global_request_escapes_legacy_node_metadata_comment() -> None:
    lines = OrchestraEmitter.render_sfload_global_requests(
        [
            SfloadGlobalRequest(
                node_id="sf\ninstr 42\nendin",
                var_name="gi_patch_sfload_ifilhandle",
                filename="test.sf2",
            )
        ]
    )

    assert lines[0] == '; node:"sf\\ninstr 42\\nendin" opcode:sfload'
    assert all(line.strip() != "instr 42" for line in lines)
    assert all(line.strip() != "endin" for line in lines)


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


def test_grain2_compile_uses_manual_argument_order() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="grain2 compile test",
        description="grain2 renders corrected syntax",
        graph=PatchGraph(
            nodes=[
                NodeInstance(
                    id="grain",
                    opcode="grain2",
                    params={
                        "kcps": 220,
                        "kfmd": 0.25,
                        "kgdur": 0.04,
                        "iovrlp": 64,
                        "kfn": 1,
                        "iwfn": 2,
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
    grain2_line = next(line.strip() for line in artifact.orc.splitlines() if " grain2 " in line)

    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc
    assert grain2_line == "a_grain_asig_1 grain2 220, 0.25, 0.04, 64, 1, 2, 0, 0, 0"
