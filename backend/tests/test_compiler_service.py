from __future__ import annotations

import pytest

from backend.tests.stk_test_support import STK_CONTROLLERS
from backend.tests.csound_test_support import orc_code_lines

from backend.app.models.patch import (
    Connection,
    EngineConfig,
    MAX_GEN_TABLE_SIZE,
    NodeInstance,
    NodePosition,
    PatchDocument,
    PatchGraph,
)
from backend.app.services.compiler_common import CompilationError, SfloadGlobalRequest
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


def test_const_s_compile_quotes_valid_value_and_feeds_string_ports() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="const_s compile test",
        description="const_s renders a restricted string literal",
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="sig", opcode="const_a", params={"value": 0.1}),
                NodeInstance(id="label", opcode="const_s", params={"value": "left_bus"}),
                NodeInstance(id="send", opcode="outleta"),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="sig", from_port_id="aout", to_node_id="send", to_port_id="asignal"),
                Connection(from_node_id="label", from_port_id="sout", to_node_id="send", to_port_id="sname"),
                Connection(from_node_id="sig", from_port_id="aout", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="sig", from_port_id="aout", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")

    assert 'S_label_sout_1 = "left_bus"' in artifact.orc
    assert "outleta S_label_sout_1, a_sig_aout_1" in artifact.orc


def test_compile_accepts_outleta_without_direct_outs() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="outleta-only compile test",
        description="source patch routes only to a named audio outlet",
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="sig", opcode="const_a", params={"value": 0.1}),
                NodeInstance(id="label", opcode="const_s", params={"value": "left_bus"}),
                NodeInstance(id="send", opcode="outleta"),
            ],
            connections=[
                Connection(from_node_id="sig", from_port_id="aout", to_node_id="send", to_port_id="asignal"),
                Connection(from_node_id="label", from_port_id="sout", to_node_id="send", to_port_id="sname"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")

    assert 'S_label_sout_1 = "left_bus"' in artifact.orc
    assert "outleta S_label_sout_1, a_sig_aout_1" in artifact.orc
    assert "outs " not in artifact.orc


def test_compile_accepts_standalone_always_on_patch_without_assignment_id() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="standalone always-on compile test",
        description="standalone patch compilation does not need a rack routing id",
        always_on=True,
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="left", opcode="inleta", params={"sname": "left"}),
                NodeInstance(id="right", opcode="inleta", params={"sname": "right"}),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="left", from_port_id="asignal", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="right", from_port_id="asignal", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")

    assert 'inleta "left"' in artifact.orc
    assert 'inleta "right"' in artifact.orc


def test_compile_rejects_patch_without_outs_or_outleta() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="missing output compile test",
        description="patch has no direct output or named audio outlet",
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="sig", opcode="const_a", params={"value": 0.1}),
            ],
        ),
    )

    with pytest.raises(CompilationError) as error:
        compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")

    assert error.value.diagnostics == ["Patch must include at least one 'outs' or 'outleta' output node."]


@pytest.mark.parametrize("value", ["", "1bad", "_bad", "Bad", "bad-name", "a" * 51, 7])
def test_const_s_rejects_invalid_values(value: object) -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="const_s invalid test",
        description="const_s validates literal payloads",
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="label", opcode="const_s", params={"value": value}),
                NodeInstance(id="sig", opcode="const_a", params={"value": 0.1}),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="sig", from_port_id="aout", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="sig", from_port_id="aout", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    with pytest.raises(CompilationError) as err:
        compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")

    assert any("const_s node 'label' value must match" in diagnostic for diagnostic in err.value.diagnostics)


def test_compile_rejects_legacy_constructed_gen_table_size_over_limit() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument.model_construct(
        id="patch-1",
        name="Legacy GEN table",
        description="model_construct bypasses request validation",
        schema_version=1,
        graph=PatchGraph.model_construct(
            nodes=[
                NodeInstance.model_construct(
                    id="g1",
                    opcode="GEN",
                    params={},
                    position=NodePosition(),
                ),
                NodeInstance.model_construct(
                    id="a1",
                    opcode="const_a",
                    params={"value": 0.1},
                    position=NodePosition(),
                ),
                NodeInstance.model_construct(
                    id="o1",
                    opcode="outs",
                    params={},
                    position=NodePosition(),
                ),
            ],
            connections=[
                Connection.model_construct(
                    from_node_id="a1",
                    from_port_id="aout",
                    to_node_id="o1",
                    to_port_id="left",
                ),
                Connection.model_construct(
                    from_node_id="a1",
                    from_port_id="aout",
                    to_node_id="o1",
                    to_port_id="right",
                ),
            ],
            ui_layout={
                "gen_nodes": {
                    "g1": {
                        "mode": "ftgen",
                        "tableNumber": 0,
                        "startTime": 0,
                        "tableSize": MAX_GEN_TABLE_SIZE + 1,
                        "routineNumber": 10,
                        "normalize": True,
                        "harmonicAmplitudes": [1],
                    }
                }
            },
            engine_config=EngineConfig(),
        ),
    )

    with pytest.raises(CompilationError) as err:
        compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")

    assert any("GEN tableSize cannot exceed" in diagnostic for diagnostic in err.value.diagnostics)


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
    grain3_line = next(line.strip() for line in orc_code_lines(artifact.orc) if " grain3 " in line)

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
    grain2_line = next(line.strip() for line in orc_code_lines(artifact.orc) if " grain2 " in line)

    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc
    assert grain2_line == "a_grain_asig_1 grain2 220, 0.25, 0.04, 64, 1, 2, 0, 0, 0"


def test_tanh_compile_accepts_control_input_for_audio_output() -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name="tanh compile test",
        description="tanh renders as an audio-rate function node",
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="drive", opcode="const_k", params={"value": 0.8}),
                NodeInstance(id="shape", opcode="tanh"),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="drive", from_port_id="kout", to_node_id="shape", to_port_id="xin"),
                Connection(from_node_id="shape", from_port_id="aout", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="shape", from_port_id="aout", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    tanh_line = next(line.strip() for line in orc_code_lines(artifact.orc) if "tanh(" in line)

    assert tanh_line == "a_shape_aout_1 = tanh(a(k_drive_kout_1))"


@pytest.mark.parametrize("opcode_name", ["crossfmi", "crosspmi", "crossfmpmi"])
def test_cross_modulation_variants_compile_with_manual_argument_order(opcode_name: str) -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name=f"{opcode_name} compile test",
        description=f"{opcode_name} renders the crossfm-family syntax",
        graph=PatchGraph(
            nodes=[
                NodeInstance(
                    id="cross",
                    opcode=opcode_name,
                    params={
                        "xfrq1": 1,
                        "xfrq2": 1.5,
                        "xndx1": 2,
                        "xndx2": 3,
                        "kcps": 220,
                        "ifn1": 1,
                        "ifn2": 1,
                    },
                ),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="cross", from_port_id="a1", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="cross", from_port_id="a2", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    cross_line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {opcode_name} " in line)

    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc
    assert (
        cross_line
        == f"a_cross_a1_1, a_cross_a2_2 {opcode_name} 1, 1.5, 2, 3, 220, 1, 1, 0, 0"
    )


@pytest.mark.parametrize(
    ("opcode_name", "expected_tail"),
    [
        ("freeverb", "0.8, 0.35, sr, 0"),
        ("reverbsc", "0.85, 12000, sr, 1, 0"),
    ],
)
def test_stereo_reverbs_compile_with_manual_argument_order(opcode_name: str, expected_tail: str) -> None:
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    patch = PatchDocument(
        name=f"{opcode_name} compile test",
        description=f"{opcode_name} renders stereo reverb syntax",
        graph=PatchGraph(
            nodes=[
                NodeInstance(id="left", opcode="const_a", params={"value": 0.05}),
                NodeInstance(id="right", opcode="const_a", params={"value": 0.025}),
                NodeInstance(id="rvb", opcode=opcode_name),
                NodeInstance(id="out", opcode="outs"),
            ],
            connections=[
                Connection(from_node_id="left", from_port_id="aout", to_node_id="rvb", to_port_id="ain_l"),
                Connection(from_node_id="right", from_port_id="aout", to_node_id="rvb", to_port_id="ain_r"),
                Connection(from_node_id="rvb", from_port_id="aout_l", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="rvb", from_port_id="aout_r", to_node_id="out", to_port_id="right"),
            ],
        ),
    )

    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    reverb_line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {opcode_name} " in line)

    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc
    assert (
        reverb_line
        == f"a_rvb_aout_l_3, a_rvb_aout_r_4 {opcode_name} a_left_aout_1, a_right_aout_2, {expected_tail}"
    )


def _compress2_pareq_hsboscil_patch(name: str, params: dict | None = None) -> PatchDocument:
    nodes = []
    connections = []
    layout = {}
    if name == "hsboscil":
        nodes = [NodeInstance(id="wave", opcode="GEN"), NodeInstance(id="window", opcode="GEN")]
        layout = {"gen_nodes": {
            "wave": {"routineNumber": 10, "harmonicAmplitudes": [1], "tableSize": 1024},
            "window": {"routineNumber": 19, "normalize": False, "tableSize": 1024,
                       "rawArgs": [1, 0.5, 270, 0.5]},
        }}
        connections = [Connection(from_node_id=node, from_port_id="ift", to_node_id="target", to_port_id=port)
                       for node, port in [("wave", "iwfn"), ("window", "ioctfn")]]
    else:
        nodes = [NodeInstance(id="source", opcode="oscili", params={"amp": 0.2, "freq": 440})]
        connections = [Connection(from_node_id="source", from_port_id="asig", to_node_id="target",
                                  to_port_id="aasig" if name == "compress2" else "asig")]
        if name == "compress2":
            nodes.append(NodeInstance(id="sidechain", opcode="oscili", params={"amp": 0.1, "freq": 220}))
            connections.append(Connection(from_node_id="sidechain", from_port_id="asig",
                                          to_node_id="target", to_port_id="acsig"))
    nodes.extend([NodeInstance(id="target", opcode=name, params=params or {}), NodeInstance(id="out", opcode="outs")])
    connections.extend(Connection(from_node_id="target", from_port_id="ar" if name == "compress2" else "ares",
                                  to_node_id="out", to_port_id=channel) for channel in ("left", "right"))
    return PatchDocument(name=f"{name} test", graph=PatchGraph(nodes=nodes, connections=connections, ui_layout=layout))


@pytest.mark.parametrize(("name", "params", "expected"), [
    ("compress2", {}, "a_source_asig_1, a_sidechain_asig_2, -90, -52, -30, 3, 0.01, 0.1, 0.05"),
    ("compress2", {"kthresh": -80, "kloknee": -24, "khiknee": -12, "kratio": 4,
                   "katt": 0.02, "krel": 0.2, "ilook": 0.01},
     "a_source_asig_1, a_sidechain_asig_2, -80, -24, -12, 4, 0.02, 0.2, 0.01"),
    ("pareq", {}, "a_source_asig_1, 1000, 1, 0.70710678, 0, 0"),
    ("pareq", {"iskip": 1}, "a_source_asig_1, 1000, 1, 0.70710678, 0, 1"),
    ("pareq", {"kc": 500, "kv": 0.5, "kq": 1, "imode": 2}, "a_source_asig_1, 500, 0.5, 1, 2, 0"),
    ("hsboscil", {}, "0.2, 0, 0, 220, i_wave_ift_1, i_window_ift_2, 3, 0"),
    ("hsboscil", {"iphs": 0.25}, "0.2, 0, 0, 220, i_wave_ift_1, i_window_ift_2, 3, 0.25"),
    ("hsboscil", {"kamp": 0.1, "ktone": 0.5, "kbrite": -1, "ibasfreq": 110, "ioctcnt": 5, "iphs": -1},
     "0.1, 0.5, -1, 110, i_wave_ift_1, i_window_ift_2, 5, -1"),
])
def test_compress2_pareq_hsboscil_argument_order_and_optional_defaults(name, params, expected) -> None:
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(
        _compress2_pareq_hsboscil_patch(name, params), midi_input="0", rtmidi_module="alsaseq",
    )
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {name} " in line)
    assert line.split(f" {name} ", 1)[1] == expected
    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc
    if name == "hsboscil":
        assert "ftgen 0, 0, 1024, -19, 1, 0.5, 270, 0.5" in artifact.orc


@pytest.mark.parametrize("source_rate", ["a", "k", "i", "S"])
@pytest.mark.parametrize(("name", "port", "accepted"), [
    ("compress2", "aasig", "a"), ("compress2", "acsig", "a"),
    *[("compress2", port, "ki") for port in ["kthresh", "kloknee", "khiknee", "kratio", "katt", "krel"]],
    ("compress2", "ilook", "i"), ("pareq", "asig", "a"),
    *[("pareq", port, "ki") for port in ["kc", "kv", "kq"]],
    ("pareq", "imode", "i"), ("pareq", "iskip", "i"),
    *[("hsboscil", port, "ki") for port in ["kamp", "ktone", "kbrite"]],
    *[("hsboscil", port, "i") for port in ["ibasfreq", "iwfn", "ioctfn", "ioctcnt", "iphs"]],
])
def test_compress2_pareq_hsboscil_connected_rates(name, port, accepted, source_rate) -> None:
    patch = _compress2_pareq_hsboscil_patch(name)
    patch.graph.nodes.insert(0, NodeInstance(id="mod", opcode=f"const_{source_rate.lower()}",
                                           params={"value": "signal" if source_rate == "S" else 1}))
    patch.graph.connections = [c for c in patch.graph.connections if (c.to_node_id, c.to_port_id) != ("target", port)]
    patch.graph.connections.append(Connection(from_node_id="mod", from_port_id=f"{source_rate.lower()}out",
                                              to_node_id="target", to_port_id=port))
    compiler = CompilerService(OpcodeService("/static/icons"))
    if source_rate not in accepted:
        with pytest.raises(CompilationError) as error:
            compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        assert any("Signal type mismatch" in item for item in error.value.diagnostics)
    else:
        artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        line = next(line for line in orc_code_lines(artifact.orc) if f" {name} " in line)
        assert f"{source_rate}_mod_{source_rate.lower()}out_1" in line


@pytest.mark.parametrize(("name", "port"), [
    ("compress2", "aasig"), ("compress2", "acsig"), ("pareq", "asig"), ("hsboscil", "ioctfn"),
])
def test_compress2_pareq_hsboscil_require_audio_and_octave_table(name, port) -> None:
    patch = _compress2_pareq_hsboscil_patch(name)
    patch.graph.connections = [c for c in patch.graph.connections if (c.to_node_id, c.to_port_id) != ("target", port)]
    with pytest.raises(CompilationError) as error:
        CompilerService(OpcodeService("/static/icons")).compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    assert any(port in item and "target" in item for item in error.value.diagnostics)


@pytest.mark.parametrize(("name", "params"), [
    ("compress2", {}), ("pareq", {}), ("pareq", {"imode": 1}), ("pareq", {"imode": 2}),
    ("hsboscil", {}), ("hsboscil", {"ioctcnt": 2, "iphs": 0.25}), ("hsboscil", {"ioctcnt": 10}),
])
def test_compress2_pareq_hsboscil_native_audio(name, params, tmp_path) -> None:
    import shutil
    import subprocess
    import wave

    import numpy as np

    csound = shutil.which("csound")
    if not csound:
        pytest.skip("Csound executable is unavailable")
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(
        _compress2_pareq_hsboscil_patch(name, params), midi_input="0", rtmidi_module="alsaseq",
    )
    path = tmp_path / "opcode.csd"
    path.write_text("\n".join([
        "<CsoundSynthesizer>", "<CsOptions>", "-d -m0 -W -s -o opcode.wav", "</CsOptions>",
        "<CsInstruments>", artifact.orc, "</CsInstruments>", "<CsScore>",
        "f 1 0 16384 10 1", "i 1 0 0.3", "e", "</CsScore>", "</CsoundSynthesizer>",
    ]))
    result = subprocess.run([csound, path.name], cwd=tmp_path, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    with wave.open(str(tmp_path / "opcode.wav"), "rb") as audio:
        assert audio.getnchannels() == 2
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").reshape(-1, 2)
    # Ignore lookahead/startup, then require audible, unclipped output on both channels.
    steady = samples[-4800:].astype(float) / 32768
    assert np.all(np.sqrt(np.mean(steady ** 2, axis=0)) > 0.001)
    assert np.max(np.abs(steady)) < 0.99


def _atone_patch(name: str, params: dict | None = None) -> PatchDocument:
    rate = "k" if name == "atonek" else "a"
    nodes = [
        NodeInstance(id="source", opcode=f"const_{rate}", params={"value": 0.2}),
        NodeInstance(id="filter", opcode=name, params=params or {}),
    ]
    connections = [Connection(
        from_node_id="source", from_port_id=f"{rate}out", to_node_id="filter", to_port_id=f"{rate}sig",
    )]
    if rate == "k":
        nodes.append(NodeInstance(id="osc", opcode="vco2", params={"kcps": 440}))
        connections.append(Connection(
            from_node_id="filter", from_port_id="kout", to_node_id="osc", to_port_id="kamp",
        ))
    nodes.append(NodeInstance(id="out", opcode="outs"))
    for channel in ("left", "right"):
        connections.append(Connection(
            from_node_id="osc" if rate == "k" else "filter",
            from_port_id="asig" if rate == "k" else "aout", to_node_id="out", to_port_id=channel,
        ))
    return PatchDocument(name=f"{name} compile test", graph=PatchGraph(nodes=nodes, connections=connections))


@pytest.mark.parametrize(
    ("name", "params", "expected_tail"),
    [
        ("atone", {}, "200, 0"),
        ("atone", {"khp": 4000, "iskip": 1}, "4000, 1"),
        ("atonek", {}, "10, 0"),
        ("atonek", {"khp": 25, "iskip": 1}, "25, 1"),
        ("atonex", {}, "200, 4, 0"),
        ("atonex", {"inumlayer": 8}, "200, 8, 0"),
        ("atonex", {"iskip": 1}, "200, 4, 1"),
        ("atonex", {"xhp": 800, "inumlayer": 2, "iskip": 1}, "800, 2, 1"),
    ],
)
def test_atone_compile_preserves_argument_order_and_optional_defaults(
    name: str, params: dict, expected_tail: str,
) -> None:
    artifact = CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(
        _atone_patch(name, params), midi_input="0", rtmidi_module="alsaseq",
    )
    rate = "k" if name == "atonek" else "a"
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {name} " in line)
    assert line == f"{rate}_filter_{rate}out_2 {name} {rate}_source_{rate}out_1, {expected_tail}"
    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc


@pytest.mark.parametrize("source_rate", ["a", "k", "i"])
@pytest.mark.parametrize(
    ("name", "target_port", "accepted_rates"),
    [
        ("atone", "asig", "a"),
        ("atone", "khp", "ki"),
        ("atone", "iskip", "i"),
        ("atonek", "ksig", "ki"),
        ("atonek", "khp", "ki"),
        ("atonek", "iskip", "i"),
        ("atonex", "asig", "a"),
        ("atonex", "xhp", "aki"),
        ("atonex", "inumlayer", "i"),
        ("atonex", "iskip", "i"),
    ],
)
def test_atone_connected_inputs_enforce_manual_rates(
    name: str, target_port: str, accepted_rates: str, source_rate: str,
) -> None:
    patch = _atone_patch(name)
    patch.graph.nodes.insert(0, NodeInstance(id="mod", opcode=f"const_{source_rate}", params={"value": 1}))
    patch.graph.connections = [
        c for c in patch.graph.connections if (c.to_node_id, c.to_port_id) != ("filter", target_port)
    ]
    patch.graph.connections.append(Connection(
        from_node_id="mod", from_port_id=f"{source_rate}out", to_node_id="filter", to_port_id=target_port,
    ))
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    if source_rate not in accepted_rates:
        with pytest.raises(CompilationError) as error:
            compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        assert any("Signal type mismatch" in diagnostic for diagnostic in error.value.diagnostics)
        return
    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {name} " in line)
    assert f"{source_rate}_mod_{source_rate}out_1" in line



def _zdf_filter_patch(name: str, params: dict | None = None) -> PatchDocument:
    spec = OpcodeService(icon_prefix="/static/icons").get_opcode(name)
    assert spec is not None
    return PatchDocument(name=f"{name} test", graph=PatchGraph(
        nodes=[NodeInstance(id="source", opcode="vco2"),
               NodeInstance(id="filter", opcode=name, params=params or {}),
               NodeInstance(id="out", opcode="outs")],
        connections=[Connection(from_node_id="source", from_port_id="asig",
                                to_node_id="filter", to_port_id=spec.inputs[0].id),
                     *[Connection(from_node_id="filter", from_port_id=port.id,
                                  to_node_id="out", to_port_id="left" if index == 0 else "right")
                       for index, port in enumerate(spec.outputs)],
                     Connection(from_node_id="filter", from_port_id=spec.outputs[0].id,
                                to_node_id="out", to_port_id="right")],
    ))


@pytest.mark.parametrize(("name", "params", "outputs", "tail"), [
    ("zdf_1pole", {}, ["aout"], "1200, 0, 0"),
    ("zdf_1pole", {"istor": 1}, ["aout"], "1200, 0, 1"),
    ("zdf_1pole", {"kmode": 2}, ["aout"], "1200, 2, 0"),
    ("zdf_1pole_mode", {}, ["alp", "ahp"], "1200, 0"),
    ("zdf_1pole_mode", {"istor": 1}, ["alp", "ahp"], "1200, 1"),
    ("zdf_2pole", {}, ["aout"], "1200, 1, 0, 0"),
    ("zdf_2pole", {"istor": 1}, ["aout"], "1200, 1, 0, 1"),
    ("zdf_2pole", {"xcf": 2400, "xq": 4, "kmode": 6}, ["aout"], "2400, 4, 6, 0"),
    ("zdf_2pole_mode", {}, ["alp", "abp", "ahp"], "1200, 1, 0"),
    ("zdf_2pole_mode", {"istor": 1}, ["alp", "abp", "ahp"], "1200, 1, 1"),
    ("zdf_ladder", {}, ["aout"], "1200, 1, 0"),
    ("zdf_ladder", {"xcf": 800, "xq": 2, "istor": 1}, ["aout"], "800, 2, 1"),
    ("zfilter2", {}, ["aout"], "0, 0, 3, 2, 0.06745527, 0.13491055, 0.06745527, -1.1429805, 0.4128016"),
    ("zfilter2", {"im": 1, "in": 1, "icoeffs": "0.5, -0.5", "kdamp": 0.1, "kfreq": -0.2},
     ["aout"], "0.1, -0.2, 1, 1, 0.5, -0.5"),
    ("zfilter2", {"im": 1, "in": 1, "icoeffs": "(1 / 2), -(1 / 2)"},
     ["aout"], "0, 0, 1, 1, (1 / 2), -(1 / 2)"),
])
def test_zdf_and_zfilter_compile_argument_output_order(name, params, outputs, tail) -> None:
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(
        _zdf_filter_patch(name, params), midi_input="0", rtmidi_module="alsaseq",
    )
    output_vars = ", ".join(f"a_filter_{port}_{index + 2}" for index, port in enumerate(outputs))
    assert f"{output_vars} {name} a_source_asig_1, {tail}" in artifact.orc
    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc


@pytest.mark.parametrize("source_rate", ["a", "k", "i", "S"])
@pytest.mark.parametrize(("name", "port", "accepted"), [
    (name, port, rates)
    for name in ("zdf_1pole", "zdf_1pole_mode", "zdf_2pole", "zdf_2pole_mode", "zdf_ladder")
    for port, rates in [
        ("ain", "a"), ("xcf", "aki"), ("istor", "i"),
        *([("xq", "aki")] if name in {"zdf_2pole", "zdf_2pole_mode", "zdf_ladder"} else []),
        *([("kmode", "ki")] if name in {"zdf_1pole", "zdf_2pole"} else []),
    ]
] + [("zfilter2", port, rates) for port, rates in [
    ("asig", "a"), ("kdamp", "ki"), ("kfreq", "ki"), ("im", "i"), ("in", "i"), ("icoeffs", "i"),
]])
def test_zdf_and_zfilter_connected_rates(name, port, accepted, source_rate) -> None:
    patch = _zdf_filter_patch(name)
    patch.graph.nodes.insert(0, NodeInstance(id="mod", opcode=f"const_{source_rate.lower()}",
                                           params={"value": "signal" if source_rate == "S" else 1}))
    patch.graph.connections = [c for c in patch.graph.connections if (c.to_node_id, c.to_port_id) != ("filter", port)]
    patch.graph.connections.append(Connection(from_node_id="mod", from_port_id=f"{source_rate.lower()}out",
                                              to_node_id="filter", to_port_id=port))
    compiler = CompilerService(OpcodeService("/static/icons"))
    if source_rate not in accepted:
        with pytest.raises(CompilationError) as error:
            compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        assert any("Signal type mismatch" in item for item in error.value.diagnostics)
    elif port == "icoeffs":
        # A single scalar source cannot fill the default five-coefficient filter.
        with pytest.raises(CompilationError) as error:
            compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        assert any("coefficient count" in item for item in error.value.diagnostics)
    else:
        artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        assert f"{source_rate}_mod_{source_rate.lower()}out_1" in artifact.orc


@pytest.mark.parametrize("params", [
    {"im": 0}, {"im": 52}, {"im": 1.5}, {"in": 0}, {"in": 50}, {"in": -1},
    {"icoeffs": "1, 2"}, {"icoeffs": ""}, {"icoeffs": "1,,2"},
    {"icoeffs": "1,"}, {"icoeffs": "1; exitnow, 2"}, {"icoeffs": "1\nouts 1, 1"},
    {"im": 1, "in": 2, "icoeffs": "max(1, 2), -0.5"},
    {"im": 1, "in": 1, "icoeffs": "(1, -0.5"},
    {"im": 1, "in": 1, "icoeffs": "1)+(2, -0.5"},
    {"icoeffs": ",".join(["0"] * 101)},
])
def test_zfilter2_rejects_invalid_coefficient_layout(params) -> None:
    with pytest.raises(CompilationError):
        CompilerService(OpcodeService("/static/icons")).compile_patch(
            _zdf_filter_patch("zfilter2", params), midi_input="0", rtmidi_module="alsaseq",
        )


def test_zfilter2_preserves_ordered_connected_coefficients_and_guards_dynamic_counts() -> None:
    patch = _zdf_filter_patch("zfilter2", {"im": 1, "in": 1})
    for id, value, port in [("numerator", 1, "im"), ("b0", 0.5, "icoeffs"), ("a1", -0.5, "icoeffs")]:
        patch.graph.nodes.insert(0, NodeInstance(id=id, opcode="const_i", params={"value": value}))
        patch.graph.connections.append(Connection(from_node_id=id, from_port_id="iout", to_node_id="filter", to_port_id=port))
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if " zfilter2 " in line)
    assert line.endswith("i_numerator_iout_3, 1, i_b0_iout_2, i_a1_iout_1")
    assert "== 2 then" in artifact.orc
    assert "voice stopped" in artifact.orc
    patch.graph.ui_layout = {"input_formulas": {"filter::icoeffs": {"expression": "in1 + in2"}}}
    with pytest.raises(CompilationError) as error:
        CompilerService(OpcodeService("/static/icons")).compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    assert any("ordered connections" in item for item in error.value.diagnostics)


def _stk_patch(name: str, params: dict | None = None) -> PatchDocument:
    return PatchDocument(
        name=f"{name} compile test",
        graph=PatchGraph(
            nodes=[NodeInstance(id="stk", opcode=name, params=params or {}), NodeInstance(id="out", opcode="outs")],
            connections=[
                Connection(from_node_id="stk", from_port_id="asignal", to_node_id="out", to_port_id="left"),
                Connection(from_node_id="stk", from_port_id="asignal", to_node_id="out", to_port_id="right"),
            ],
        ),
    )


@pytest.mark.parametrize("name", STK_CONTROLLERS)
def test_stk_compile_defaults_preserve_instrument_controls(name: str) -> None:
    service = OpcodeService(icon_prefix="/static/icons")
    opcode = service.get_opcode(name)
    assert opcode is not None
    # The frontend copies every non-null default into the new node's params.
    params = {port.id: port.default for port in opcode.inputs if port.default is not None}
    artifact = CompilerService(service).compile_patch(_stk_patch(name, params), midi_input="0", rtmidi_module="alsaseq")
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {name} " in line)
    assert line == f"a_stk_asignal_1 {name} {60 if name == 'STKDrummer' else 440}, 0.2"
    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc


@pytest.mark.parametrize("name", [name for name, controllers in STK_CONTROLLERS.items() if controllers])
@pytest.mark.parametrize("selection", ["first", "last", "all"])
def test_stk_compile_independent_controller_pairs_in_manual_order(name: str, selection: str) -> None:
    controllers = STK_CONTROLLERS[name]
    pairs = list(enumerate(controllers, start=1))
    if selection == "first":
        pairs = pairs[:1]
    elif selection == "last":
        pairs = pairs[-1:]
    params = {"ifrequency": 220, "iamplitude": 0.125}
    expected = ["220", "0.125"]
    for index, (_, number) in pairs:
        # Include zero: it is an explicitly enabled control, not an omitted value.
        params[f"kv{index}"] = index - 1
        expected.extend([str(number), str(index - 1)])
    artifact = CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(
        _stk_patch(name, params), midi_input="0", rtmidi_module="alsaseq",
    )
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if f" {name} " in line)
    assert line == f"a_stk_asignal_1 {name} " + ", ".join(expected)
    assert "__VS_OPTIONAL_OMIT__" not in artifact.orc


@pytest.mark.parametrize(
    ("source_opcode", "source_port", "target_port", "valid"),
    [
        ("const_i", "iout", "ifrequency", True),
        ("const_k", "kout", "ifrequency", False),
        ("const_a", "aout", "iamplitude", False),
        ("const_i", "iout", "kv7", True),
        ("const_k", "kout", "kv7", True),
        ("const_a", "aout", "kv7", False),
        ("const_i", "iout", "kinstr", True),
        ("const_k", "kout", "kinstr", True),
        ("const_a", "aout", "kinstr", False),
    ],
)
def test_stk_connected_inputs_enforce_init_and_control_rates(
    source_opcode: str, source_port: str, target_port: str, valid: bool,
) -> None:
    patch = _stk_patch("STKBandedWG", {"kv7": 3})
    patch.graph.nodes.insert(0, NodeInstance(id="control", opcode=source_opcode, params={"value": 16}))
    patch.graph.connections.append(Connection(
        from_node_id="control", from_port_id=source_port, to_node_id="stk", to_port_id=target_port,
    ))
    compiler = CompilerService(OpcodeService(icon_prefix="/static/icons"))
    if not valid:
        with pytest.raises(CompilationError) as error:
            compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
        assert any("Signal type mismatch" in diagnostic for diagnostic in error.value.diagnostics)
        return
    artifact = compiler.compile_patch(patch, midi_input="0", rtmidi_module="alsaseq")
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if " STKBandedWG " in line)
    source_var = f"{source_port[0]}_control_{source_port}_1"
    assert source_var in line
    if target_port == "kv7":
        assert line.endswith(f", 16, {source_var}")
    elif target_port == "kinstr":
        assert line.endswith(f", {source_var}, 3")
    else:
        assert f" STKBandedWG {source_var}, 0.2, 16, 3" in line


def test_stk_controller_formula_and_override_skip_middle_pairs() -> None:
    patch = _stk_patch("STKBandedWG", {"kpress": 4, "kv1": 0})
    patch.graph.ui_layout = {"input_formulas": {"stk::kv7": {"expression": "1 + 2", "inputs": []}}}
    artifact = CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch(
        patch, midi_input="0", rtmidi_module="alsaseq",
    )
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if " STKBandedWG " in line)
    assert line == "a_stk_asignal_1 STKBandedWG 440, 0.2, 4, 0, 16, (1 + 2)"


def test_midi_legato_separates_note_collectors_from_audio_and_maxalloc() -> None:
    from backend.tests.csound_test_support import load_patch_fixture
    from backend.app.services.compiler_common import PatchInstrumentTarget
    patch = load_patch_fixture('midi_legato')
    compiler = CompilerService(OpcodeService(icon_prefix='/static/icons'))
    artifact = compiler.compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=1, assignment_id='flute')],
        midi_input='0', rtmidi_module='none', performance_input_mode='score')
    assert artifact.manifest['noteInstrumentReferences'] == {'flute': '1'}
    assert artifact.manifest['instrumentReferences'] == {'flute': '2'}
    assert 'maxalloc "vcs_instr_1", 1' in artifact.orc
    assert 'maxalloc 1,' not in artifact.orc
    assert artifact.orc.index('instr 1') < artifact.orc.index('instr vcs_instr_1')
    assert 'alwayson "vcs_instr_1"' in artifact.orc
    assert 'portk' in artifact.orc and '/ 128, 0.01' in artifact.orc


def test_legato_does_not_assign_unassigned_rack_targets_to_all_channels() -> None:
    from backend.tests.csound_test_support import load_patch_fixture
    from backend.app.services.compiler_common import PatchInstrumentTarget
    patch = load_patch_fixture('midi_legato')
    compiler = CompilerService(OpcodeService(icon_prefix='/static/icons'))
    artifact = compiler.compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=0, assignment_id='unassigned'),
         PatchInstrumentTarget(patch=patch, midi_channel=1, assignment_id='assigned')],
        midi_input='0', rtmidi_module='none')
    assignments = [line for line in artifact.orc.splitlines() if line.startswith('massign ')]
    assert assignments == ['massign 0, 0', 'massign 1, 3']


@pytest.mark.parametrize('mixer', [False, True])
@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_waveguide_helpers_emit_once_for_multiple_voices(mixer, mode):
    from backend.tests.csound_test_support import load_patch_fixture
    from backend.app.services.compiler_common import PatchInstrumentTarget
    from backend.app.models.audio import AudioGraph, AudioRoute
    patch = load_patch_fixture('steel_string_waveguide')
    targets = [PatchInstrumentTarget(patch=patch, midi_channel=i+1, assignment_id=f'g{i}') for i in range(2)]
    routes = [AudioRoute(id=f'r{i}{side}',sourceId=f'g{i}',sourcePort=side,targetId='$output',targetPort=side)
              for i in range(2) for side in ['left','right']]
    artifact = CompilerService(OpcodeService('/static/icons')).compile_patch_bundle(
        targets, midi_input='0',rtmidi_module='none',performance_input_mode=mode,
        audio_graph=AudioGraph(routes=routes) if mixer else None)
    assert artifact.orc.count('opcode vcs_waveguide_string,') == 1
    assert artifact.orc.count('opcode vcs_wg_rail,') == 1
    assert artifact.orc.count('opcode vcs_wg_dc,') == 1
    assert artifact.orc.count(' mode ') == 24
    assert 'setksmps 1' in artifact.orc
    assert 'gk_vcs_waveguide' not in artifact.orc
    assert not any(line.strip().startswith('seed ') for line in artifact.orc.splitlines())


def test_waveguide_helper_absent_without_waveguide():
    from backend.tests.csound_test_support import load_patch_fixture
    artifact = CompilerService(OpcodeService('/static/icons')).compile_patch(
        load_patch_fixture('steel_string_guitar_polyphonic'),midi_input='0',rtmidi_module='none')
    assert 'opcode vcs_waveguide_string' not in artifact.orc


@pytest.mark.parametrize("mode", ["ftgen", "ftgenonce"])
@pytest.mark.parametrize("normalize", [True, False])
def test_gen19_structured_partials_compile_in_csound_order(mode, normalize) -> None:
    patch = _compress2_pareq_hsboscil_patch("hsboscil")
    patch.graph.ui_layout["gen_nodes"]["window"] = {
        "routineNumber": 19, "mode": mode, "normalize": normalize, "tableSize": 1025,
        "startTime": 2,
        "gen19Partials": [
            {"partial": 0.5, "strength": -2, "phase": 270, "offset": 2},
            {"partial": 3, "strength": 0.25, "phase": -90, "offset": -0.5},
        ],
        "rawArgs": [1, 1, 0, 0],
    }
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(
        patch, midi_input="0", rtmidi_module="alsaseq",
    )
    line = next(line.strip() for line in orc_code_lines(artifact.orc) if "i_window_ift" in line and f" {mode} " in line)
    assert line.endswith(f"{mode} 0, {2 if mode == 'ftgen' else 0}, 1025, {19 if normalize else -19}, 0.5, -2, 270, 2, 3, 0.25, -90, -0.5")


@pytest.mark.parametrize(("config", "tail"), [
    ({}, "1, 1, 0, 0"),
    ({"rawArgs": [1, 0.5, 270, 0.5]}, "1, 0.5, 270, 0.5"),
    ({"rawArgsText": "1, 1/2, 270, 0.5", "gen19Partials": None}, "1, 1/2, 270, 0.5"),
    ({"rawArgsText": "1, expr:1/2, 270, 0.5", "gen19Partials": None}, "1, 1/2, 270, 0.5"),
])
def test_gen19_defaults_and_legacy_raw_args(config, tail) -> None:
    patch = _compress2_pareq_hsboscil_patch("hsboscil")
    patch.graph.ui_layout["gen_nodes"]["window"] = {"routineNumber": 19, "tableSize": 1024, **config}
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(
        patch, midi_input="0", rtmidi_module="alsaseq",
    )
    assert any(line.strip().endswith(f"ftgen 0, 0, 1024, 19, {tail}") for line in orc_code_lines(artifact.orc))


@pytest.mark.parametrize("mode", ["ftgen", "ftgenonce"])
@pytest.mark.parametrize(("normalize", "expected"), [(False, [3, 1, 3, 5]), (True, [0.6, 0.2, 0.6, 1])])
def test_gen19_native_table_values(mode, normalize, expected, tmp_path) -> None:
    import re
    import shutil
    import subprocess

    csound = shutil.which("csound")
    if not csound:
        pytest.skip("Csound executable is unavailable")
    patch = _compress2_pareq_hsboscil_patch("hsboscil")
    patch.graph.ui_layout["gen_nodes"]["window"] = {
        "routineNumber": 19, "mode": mode, "tableSize": 1024, "normalize": normalize,
        "gen19Partials": [
            {"partial": 1, "strength": -2, "phase": 0, "offset": 2},
            {"partial": 0.5, "strength": 0, "phase": 90, "offset": 1},
        ],
    }
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(
        patch, midi_input="0", rtmidi_module="alsaseq",
    )
    table_line = next(line.strip() for line in orc_code_lines(artifact.orc) if "i_window_ift" in line and f" {mode} " in line)
    table_var = table_line.split()[0]
    path = tmp_path / "gen19.csd"
    path.write_text("\n".join([
        "<CsoundSynthesizer>", "<CsOptions>", "-n -d -m0", "</CsOptions>",
        "<CsInstruments>", "sr = 48000", "ksmps = 1", "nchnls = 1", "0dbfs = 1", "instr 1",
        table_line,
        *[f'iV{i} table {i * 256}, {table_var}' for i in range(4)],
        'prints "GEN19_VALUES %.6f %.6f %.6f %.6f\\n", iV0, iV1, iV2, iV3',
        "endin", "</CsInstruments>", "<CsScore>", "i 1 0 0.01", "e", "</CsScore>", "</CsoundSynthesizer>",
    ]))
    result = subprocess.run([csound, str(path)], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    match = re.search(r"GEN19_VALUES ([\d. -]+)", result.stdout + result.stderr)
    assert match, result.stderr
    assert [float(value) for value in match[1].split()] == pytest.approx(expected)


@pytest.mark.parametrize('params,tail', [
    ({}, '1, 0, 1, 80'),
    ({'kscal': 0.5}, '0.5, 0, 1, 80'),
    ({'kscal': 2, 'kkeepform': 1, 'kgain': 0.5, 'kcoefs': 40}, '2, 1, 0.5, 40'),
])
def test_pvscale_argument_order_and_optional_defaults(params, tail):
    patch = PatchDocument(name='Pitch test', graph=PatchGraph(nodes=[
        NodeInstance(id='source', opcode='const_a', params={'value': 0}),
        NodeInstance(id='analysis', opcode='pvsanal'),
        NodeInstance(id='shift', opcode='pvscale', params=params),
        NodeInstance(id='synth', opcode='pvsynth'),
        NodeInstance(id='out', opcode='outs'),
    ], connections=[
        Connection(from_node_id='source', from_port_id='aout', to_node_id='analysis', to_port_id='ain'),
        Connection(from_node_id='analysis', from_port_id='fsig', to_node_id='shift', to_port_id='fsigin'),
        Connection(from_node_id='shift', from_port_id='fsig', to_node_id='synth', to_port_id='fsrc'),
        *[Connection(from_node_id='synth', from_port_id='aout', to_node_id='out', to_port_id=side)
          for side in ('left', 'right')],
    ]))
    compiled = CompilerService(OpcodeService('/static/icons')).compile_patch(patch, '0', 'none')
    line = next(line for line in orc_code_lines(compiled.orc) if ' pvscale ' in line)
    assert line.split(' pvscale ')[1].split(', ', 1)[1] == tail


@pytest.mark.parametrize('mixer', [False, True])
@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_capture_helpers_are_instance_local_and_emitted_once(mixer, mode):
    from backend.tests.csound_test_support import load_patch_fixture
    from backend.app.services.compiler_common import PatchInstrumentTarget
    from backend.app.models.audio import AudioGraph, AudioRoute
    patch = load_patch_fixture('granular_capture')
    targets = [PatchInstrumentTarget(patch=patch, midi_channel=0, always_on=True, assignment_id=f'g{i}',
                                    performance_controller_values={'gc_channel': i + 2}) for i in range(2)]
    routes = [AudioRoute(id=f'r{i}{side}', sourceId=f'g{i}', sourcePort=side,
                        targetId='$output', targetPort=side) for i in range(2) for side in ['left', 'right']]
    artifact = CompilerService(OpcodeService('/static/icons')).compile_patch_bundle(
        targets, midi_input='0', rtmidi_module='none', performance_input_mode=mode,
        audio_graph=AudioGraph(routes=routes) if mixer else None)
    assert artifact.orc.count('opcode vcs_stereo_capture,') == 1
    assert artifact.orc.count('opcode vcs_capture_read,') == 1
    assert artifact.orc.count(' ftgentmp ') == 4
    assert not any(line.strip().startswith('seed ') for line in artifact.orc.splitlines())
    controls = artifact.manifest['performanceControllers']
    assert controls['g0']['gc_channel']['value'] == 2
    assert controls['g1']['gc_channel']['value'] == 3
    assert controls['g0']['gc_channel']['channel'] != controls['g1']['gc_channel']['channel']


@pytest.mark.parametrize('table', [None, 0, 7])
@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_ctrl7_optional_table_and_continuous_score_channel(table, mode):
    from backend.tests.csound_test_support import load_patch_fixture
    from backend.tools.stereo_delay_audio import compile_probe
    patch = load_patch_fixture('granular_capture')
    reader = next(n for n in patch.graph.nodes if n.id == 'gc_midi_freeze')
    if table is not None:
        reader.params['ifn'] = table
    orc = compile_probe(patch, mode=mode).orc
    lines = [line for line in orc.splitlines() if 'k_gc_midi_freeze_kout_' in line]
    if mode == 'midi':
        line = next(line for line in lines if ' ctrl7 ' in line)
        assert line.endswith(', 0, 127' + (f', {table}' if table is not None else ''))
    else:
        line = next(line for line in lines if 'gk_vcs_score_cc' in line)
        assert 'int(limit(' in line
        assert any('table(' in candidate for candidate in lines) == (table is not None)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_stereo_moog_filter_compiles_independent_instance_settings(mode):
    from backend.app.services.compiler_common import PatchInstrumentTarget
    from backend.tests.csound_test_support import load_patch_fixture, orc_code_lines

    patch = load_patch_fixture("stereo_moog_filter")
    targets = [
        PatchInstrumentTarget(patch, 0, assignment_id=f"filter-{i}", always_on=True,
                              performance_controller_values=dict(
                                  smf_channel=i + 2, smf_cutoff=1000 * (i + 1), smf_resonance=.2 * (i + 1)))
        for i in range(2)
    ]
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode=mode)
    code = "\n".join(orc_code_lines(artifact.orc))
    assert code.count(" moogvcf ") == 4
    assert code.count("initc7 ") == (4 if mode == "midi" else 0)
    assert code.count("init ((1) * 127 + 0.5)") == (4 if mode == "score" else 0)
    settings = artifact.manifest["performanceControllers"]
    for i in range(2):
        assert settings[f"filter-{i}"]["smf_channel"]["value"] == i + 2
        assert settings[f"filter-{i}"]["smf_cutoff"]["value"] == 1000 * (i + 1)
    assert settings["filter-0"]["smf_cutoff"]["channel"] != settings["filter-1"]["smf_cutoff"]["channel"]
