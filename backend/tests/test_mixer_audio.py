"""Numerical tests against real Csound, at both live and export control rates."""

from contextlib import contextmanager
import math

import numpy as np
import pytest

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState, MixerStrip
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchDocument, PatchGraph
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_mixer import channel
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


def source(identity="source", *, ksmps=32, direct=True, copies=1, always_on=True):
    nodes = [NodeInstance(id="signal", opcode="const_a", params={"value": 0.2})]
    connections = []
    for index in range(copies):
        name = f"out{index}"
        nodes.append(
            NodeInstance(id=name, opcode="outs" if direct else "outleta", params={} if direct else {"sname": "left"})
        )
        for port in ["left", "right"] if direct else ["asignal"]:
            connections.append(Connection(from_node_id="signal", from_port_id="aout", to_node_id=name, to_port_id=port))
    patch = PatchDocument(
        name=identity,
        always_on=always_on,
        graph=PatchGraph(nodes=nodes, connections=connections, engine_config=EngineConfig(sr=48000, ksmps=ksmps)),
    )
    return PatchInstrumentTarget(
        patch=patch, midi_channel=0 if always_on else 1, assignment_id=identity, always_on=always_on
    )


def compile_audio(targets, graph=None, mixer=None):
    return CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch_bundle(
        targets, audio_graph=graph or AudioGraph(), mixer=mixer or MixerState(), midi_input="0", rtmidi_module="none"
    )


@contextmanager
def engine(artifact, score="f 0 1"):
    cs = load_ctcsound_module().Csound()
    csd = f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n<CsInstruments>\n{artifact.orc}\n</CsInstruments>\n<CsScore>\n{score}\n</CsScore>\n</CsoundSynthesizer>"
    try:
        assert cs.compileCsdText(csd) == 0
        assert cs.start() == 0
        yield cs
    finally:
        cs.cleanup()
        cs.reset()


def render(cs, blocks=60):
    frames = []
    for _ in range(blocks):
        assert cs.performKsmps() == 0
        frames.append(cs.spout().copy().reshape(-1, 2))
    return np.concatenate(frames)


@pytest.mark.parametrize("ksmps", [1, 32, 1920])
def test_stored_gain_initial_value_dynamic_ramp_and_exact_silence(ksmps):
    artifact = compile_audio(
        [source(ksmps=ksmps)], mixer=MixerState(strips={"source": MixerStrip(gainDb=-6.020599913279624)})
    )
    with engine(artifact) as cs:
        samples = render(cs, min(80, max(1, 4800 // ksmps)))
        np.testing.assert_allclose(samples, 0.1, atol=1e-9)
        cs.setControlChannel(channel("strip", "source", "gain"), 0)
        samples = render(cs, math.ceil(0.03 * 48000 / ksmps))
        assert abs(samples[-1]).max() == 0
        np.testing.assert_allclose(samples[960:], 0, atol=1e-12)
        assert np.diff(samples[:, 0]).max() < 1e-9


def test_multiple_outs_sum_and_balance_preserves_other_channel():
    artifact = compile_audio([source(copies=2)], mixer=MixerState(strips={"source": MixerStrip(balance=1)}))
    with engine(artifact) as cs:
        samples = render(cs)
        np.testing.assert_allclose(samples[:, 0], 0, atol=1e-9)
        np.testing.assert_allclose(samples[:, 1], 0.4, atol=1e-9)


def test_polyphonic_voices_use_manifest_reference_and_shared_strip():
    artifact = compile_audio([source(always_on=False)])
    ref = artifact.manifest["instrumentReferences"]["source"]
    with engine(artifact, f"i {ref} 0 0.5\ni {ref} 0 0.5\nf 0 1") as cs:
        np.testing.assert_allclose(render(cs), 0.4, atol=1e-9)
        cs.setControlChannel(channel("strip", "source", "gain"), 0.5)
        samples = render(cs)
        np.testing.assert_allclose(samples[-32:], 0.2, atol=1e-9)


def test_explicit_channel_mapping_does_not_duplicate_mono():
    artifact = compile_audio(
        [source(direct=False)],
        AudioGraph(
            routes=[AudioRoute(id="left", sourceId="source", sourcePort="left", targetId="$output", targetPort="left")]
        ),
    )
    with engine(artifact) as cs:
        samples = render(cs)
        np.testing.assert_allclose(samples[:, 0], 0.2, atol=1e-9)
        np.testing.assert_allclose(samples[:, 1], 0, atol=1e-9)


def effect(identity="effect", *, direct=False, factor=1, ksmps=32):
    nodes = [
        NodeInstance(id="in", opcode="inleta", params={"sname": "left"}),
        NodeInstance(id="factor", opcode="const_a", params={"value": factor}),
        NodeInstance(id="multiply", opcode="a_mul"),
        NodeInstance(id="out", opcode="outs" if direct else "outleta", params={} if direct else {"sname": "left"}),
    ]
    connections = [
        Connection(from_node_id="in", from_port_id="asignal", to_node_id="multiply", to_port_id="a"),
        Connection(from_node_id="factor", from_port_id="aout", to_node_id="multiply", to_port_id="b"),
    ]
    for port in ["left", "right"] if direct else ["asignal"]:
        connections.append(Connection(from_node_id="multiply", from_port_id="aout", to_node_id="out", to_port_id=port))
    patch = PatchDocument(
        name=identity,
        always_on=True,
        graph=PatchGraph(nodes=nodes, connections=connections, engine_config=EngineConfig(sr=48000, ksmps=ksmps)),
    )
    return PatchInstrumentTarget(patch=patch, midi_channel=0, assignment_id=identity, always_on=True)


def route(identity, source_id, target_id="$output", source_port="left", target_port="left", **kwargs):
    return AudioRoute(
        id=identity, sourceId=source_id, sourcePort=source_port, targetId=target_id, targetPort=target_port, **kwargs
    )


@pytest.mark.parametrize("tap, expected", [("pre", 0.4), ("post", 0.2)])
def test_send_tap_and_return_fader_follow_effect_processing(tap, expected):
    from backend.app.models.audio import MixerSend

    graph = AudioGraph(
        routes=[
            route("dry", "source"),
            route("send", "source", "effect", kind="send"),
            route("return", "effect", target_port="right"),
        ]
    )
    mixer = MixerState(
        strips={"source": MixerStrip(gainDb=-6.020599913279624)}, sends={"send": MixerSend(gainDb=0, tap=tap)}
    )
    artifact = compile_audio([source(direct=False), effect(factor=2)], graph, mixer)
    with engine(artifact) as cs:
        samples = render(cs)
        np.testing.assert_allclose(samples, np.tile([0.1, expected], (len(samples), 1)), atol=1e-9)
        cs.setControlChannel(channel("strip", "effect", "gain"), 0.5)
        samples = render(cs)
        np.testing.assert_allclose(samples[-1], [0.1, expected * 0.5], atol=1e-9)


def test_insert_after_voice_sum_before_owner_fader_is_not_a_cycle():
    from backend.app.services.compiler_common import CompilationError

    graph = AudioGraph(
        insertOwners={"insert": "source"},
        routes=[
            route("in", "source", "insert", kind="insert", sourceStage="raw"),
            route("out", "insert", "source", kind="insert", targetStage="strip"),
            route("dry", "source"),
        ],
    )
    artifact = compile_audio(
        [source(direct=False, always_on=False), effect("insert", factor=2)],
        graph,
        MixerState(strips={"source": MixerStrip(gainDb=-6.020599913279624)}),
    )
    ref = artifact.manifest["instrumentReferences"]["source"]
    with engine(artifact, f"i {ref} 0 0.5\ni {ref} 0 0.5\nf 0 1") as cs:
        np.testing.assert_allclose(render(cs)[-1], [0.4, 0], atol=1e-9)
    graph.routes[0].source_stage = "strip"
    with pytest.raises(CompilationError):
        compile_audio([source(direct=False), effect("insert", factor=2)], graph)


def test_master_leaves_direct_paths_independent_and_final_meter_includes_both():
    graph = AudioGraph(masterId="master", routes=[route("to-master", "source", "master")])
    artifact = compile_audio(
        [source(direct=False), source("direct"), effect("master", direct=True)],
        graph,
        MixerState(
            strips={"direct": MixerStrip(gainDb=-6.020599913279624), "master": MixerStrip(gainDb=-12.041199826559248)}
        ),
    )
    with engine(artifact) as cs:
        samples = render(cs, 200)
        np.testing.assert_allclose(samples[-1], [0.15, 0.15], atol=1e-9)
        assert cs.controlChannel(artifact.manifest["meters"]["$output"]["peakL"])[0] == pytest.approx(0.15)
        cs.setControlChannel(channel("strip", "master", "gain"), 0)
        np.testing.assert_allclose(render(cs)[-1], [0.1, 0.1], atol=1e-9)


@pytest.mark.parametrize("solo, expected", [("effect", [0, 0.4]), ("source", [0.2, 0.2])])
def test_return_solo_excludes_source_dry_branches(solo, expected):
    graph = AudioGraph(
        routes=[
            route("dry", "source"),
            route("other-dry", "other"),
            route("send", "source", "effect"),
            route("other-send", "other", "effect"),
            route("return", "effect", target_port="right"),
        ]
    )
    artifact = compile_audio(
        [source(direct=False), source("other", direct=False), effect()],
        graph,
        MixerState(strips={solo: MixerStrip(solo=True)}),
    )
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs)[-1], expected, atol=1e-9)


def test_mute_blocks_pre_fader_send():
    from backend.app.models.audio import MixerSend

    graph = AudioGraph(routes=[route("send", "source", "effect", kind="send"), route("return", "effect")])
    artifact = compile_audio(
        [source(direct=False), effect()],
        graph,
        MixerState(strips={"source": MixerStrip(mute=True)}, sends={"send": MixerSend(gainDb=0, tap="pre")}),
    )
    with engine(artifact) as cs:
        assert np.max(np.abs(render(cs))) == 0


def test_muting_source_keeps_downstream_delay_tail_running():
    from backend.app.services.compiler_mixer import mixer_control_values

    delay = effect()
    delay.patch.graph.nodes = [
        NodeInstance(id="in", opcode="inleta", params={"sname": "left"}),
        NodeInstance(id="delay", opcode="delay", params={"idlt": 0.05}),
        NodeInstance(id="out", opcode="outleta", params={"sname": "left"}),
    ]
    delay.patch.graph.connections = [
        Connection(from_node_id="in", from_port_id="asignal", to_node_id="delay", to_port_id="asig"),
        Connection(from_node_id="delay", from_port_id="aout", to_node_id="out", to_port_id="asignal"),
    ]
    artifact = compile_audio(
        [source(direct=False), delay],
        AudioGraph(routes=[route("feed", "source", "effect"), route("return", "effect")]),
    )
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs, 150)[-1], [0.2, 0], atol=1e-9)
        targets = mixer_control_values(artifact.manifest, MixerState(strips={"source": MixerStrip(mute=True)}))
        for name, value in targets.items():
            cs.setControlChannel(name, value)
        np.testing.assert_allclose(render(cs, 20)[-1], [0.2, 0], atol=1e-9)
        assert np.max(np.abs(render(cs, 150)[-32:])) == 0


def test_explicit_mono_to_stereo_has_equal_power_pan():
    from backend.app.models.audio import AudioInterface, AudioPortGroup

    mono = source(direct=False)
    mono.patch.graph.audio_interface = AudioInterface(
        groups=[AudioPortGroup(id="mono", name="Mono", direction="output", layout="mono", ports=["left"])],
        mainOutput="mono",
    )
    graph = AudioGraph(routes=[route("l", "source"), route("r", "source", target_port="right")])
    artifact = compile_audio([mono], graph)
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs)[-1], [0.2 / math.sqrt(2)] * 2, atol=1e-9)


def test_score_mode_numeric_manifest_with_controller_instrument():
    target = source(always_on=False)
    artifact = CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch_bundle(
        [target],
        audio_graph=AudioGraph(),
        mixer=MixerState(),
        midi_input="0",
        rtmidi_module="none",
        performance_input_mode="score",
    )
    ref = artifact.manifest["instrumentReferences"]["source"]
    with engine(artifact, f"i {ref} 0 0.5\nf 0 1") as cs:
        np.testing.assert_allclose(render(cs)[-1], [0.2, 0.2], atol=1e-9)


def test_outs_formulas_keep_multiple_resolved_inputs_and_additive_outputs():
    target = source(copies=2)
    target.patch.graph.ui_layout["input_formulas"] = {
        "out0::left": {
            "expression": "0.25 * in1",
            "inputs": [{"token": "in1", "from_node_id": "signal", "from_port_id": "aout"}],
        }
    }
    with engine(compile_audio([target])) as cs:
        np.testing.assert_allclose(render(cs)[-1], [0.25, 0.4], atol=1e-9)


def test_independent_instances_of_one_patch_keep_separate_controls():
    from dataclasses import replace

    first = source("first")
    second = replace(first, assignment_id="second")
    artifact = compile_audio(
        [first, second],
        mixer=MixerState(strips={"first": MixerStrip(gainDb=-6.020599913279624), "second": MixerStrip(gainDb=None)}),
    )
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs)[-1], [0.1, 0.1], atol=1e-9)
        cs.setControlChannel(channel("strip", "second", "gain"), 1)
        np.testing.assert_allclose(render(cs)[-1], [0.3, 0.3], atol=1e-9)


def test_multiple_solos_preserve_required_sidechain_and_exclude_its_dry_path():
    from backend.app.models.audio import AudioInterface, AudioPortGroup

    fx = effect()
    fx.patch.graph.audio_interface = AudioInterface(
        groups=[
            AudioPortGroup(
                id="side", name="Sidechain", direction="input", layout="mono", ports=["left"], purpose="sidechain"
            )
        ]
    )
    graph = AudioGraph(
        routes=[
            route("dry", "source"),
            route("otherdry", "other"),
            route("feed", "source", "effect"),
            route("side", "other", "effect"),
            route("return", "effect", target_port="right"),
        ]
    )
    artifact = compile_audio(
        [source(direct=False), source("other", direct=False), fx],
        graph,
        MixerState(strips={"source": MixerStrip(solo=True), "effect": MixerStrip(solo=True)}),
    )
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs)[-1], [0.2, 0.4], atol=1e-9)


def test_sixty_four_instances_compile_without_consuming_midi_channels():
    artifact = compile_audio([source(str(i)) for i in range(64)])
    assert len(artifact.manifest["instrumentReferences"]) == 64
    assert len(set(artifact.manifest["instrumentReferences"].values())) == 64
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs, 2)[-1], [12.8, 12.8], atol=1e-8)
