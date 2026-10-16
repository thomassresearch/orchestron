"""Live/offline insert bypass semantics, including actual rendered audio."""
from copy import deepcopy
import math

import numpy as np
import pytest

from backend.app.models.audio import AudioGraph, MixerState, MixerStrip
from backend.app.models.export import PerformanceCsdExportRequest
from backend.app.services.compiler_common import CompilationError, CompilationProfile
from backend.app.services.compiler_mixer import channel, token
from backend.app.services.performance_export_selection import select_performance_csd_instruments
from backend.tests.api_test_support import _client
from backend.tests.test_mixer_audio import source, effect, route, compile_audio, engine, render
from backend.tests.test_performance_csd_selection import add_instrument, read_export
from backend.tests.test_api import _performance_csd_export_payload
from backend.tests.test_control_flow import sound


def chain(ksmps=32, *, nested=False, master=False):
    targets = [source(direct=False, ksmps=ksmps), effect("first", factor=2, ksmps=ksmps),
               effect("second", factor=3, ksmps=ksmps)]
    owner = "$master" if master else "source"
    owner_port = "$direct.left" if master else "left"
    routes = [route("feed", "source", "$master")] if master else [route("output", "source")]
    routes += [route("in", owner, "first", owner_port, kind="insert", sourceStage="raw")]
    if nested:
        routes += [route("nested-in", "first", "second", kind="insert", sourceStage="raw"),
                   route("nested-out", "second", "first", kind="insert", targetStage="strip"),
                   route("out", "first", owner, target_port=owner_port, kind="insert", targetStage="strip")]
    else:
        routes += [route("between", "first", "second", kind="insert"),
                   route("out", "second", owner, target_port=owner_port, kind="insert", targetStage="strip")]
    return targets, AudioGraph(masterId="$master" if master else None, routes=routes,
                              insertOwners={"first": owner, "second": "first" if nested else owner})


@pytest.mark.parametrize("ksmps", [1, 32, 1920])
def test_live_bypass_ramps_both_directions_without_restarting(ksmps):
    targets, graph = chain(ksmps)
    artifact = compile_audio(targets, graph)
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs, 2)[:, 0], 1.2, atol=1e-8)
        cs.setControlChannel(channel("strip", "first", "bypass"), 1)
        samples = render(cs, math.ceil(1440 / ksmps))[:, 0]
        np.testing.assert_allclose(samples[960:], 0.6, atol=1e-8)
        assert np.max(np.abs(np.diff(samples))) < 0.002
        assert np.all(np.diff(samples) <= 1e-9)
        cs.setControlChannel(channel("strip", "first", "bypass"), 0)
        samples = render(cs, math.ceil(1440 / ksmps))[:, 0]
        np.testing.assert_allclose(samples[960:], 1.2, atol=1e-8)
        assert np.all(np.diff(samples) >= -1e-9)


@pytest.mark.parametrize("mode", ["midi", "score"])
@pytest.mark.parametrize("nested,master", [(False, False), (True, False), (False, True)])
@pytest.mark.parametrize("bypassed,expected", [(["first"], 0.6), (["second"], 0.4), (["first", "second"], 0.2)])
def test_saved_bypass_live_offline_equivalence_and_omitted_synthesis(mode, nested, master, bypassed, expected):
    targets, graph = chain(1, nested=nested, master=master)
    mixer = MixerState(strips={identity: MixerStrip(bypass=True) for identity in bypassed})
    for profile in (CompilationProfile.LIVE, CompilationProfile.OFFLINE):
        artifact = compile_audio(targets, graph, mixer, profile=profile, mode=mode)
        with engine(artifact) as cs:
            samples = render(cs, 200)
        np.testing.assert_allclose(samples[:, 0], expected, atol=1e-8)
        np.testing.assert_allclose(samples[:, 1], 0, atol=1e-8)
        for identity in bypassed:
            if profile == CompilationProfile.OFFLINE:
                assert "vcs_mix_" + token("patch:" + identity) not in artifact.orc
                assert identity not in artifact.manifest["instrumentReferences"]
            else:
                assert identity in artifact.manifest["instrumentReferences"]
        if profile == CompilationProfile.OFFLINE:
            assert "vcs_mixer_ramp" not in artifact.orc
            assert "a_bypass" not in artifact.orc


@pytest.mark.parametrize("identity", ["source", "second"])
def test_rejects_bypass_for_noninsert_or_noncontinuous(identity):
    targets, graph = chain()
    if identity == "second":
        targets[-1].always_on = False
        targets[-1].midi_channel = 1
    with pytest.raises(CompilationError) as error:
        compile_audio(targets, graph, MixerState(strips={identity: MixerStrip(bypass=True)}))
    assert "continuous insert" in error.value.diagnostics[0]


def export_payload(mode="score", *, missing_asset=False):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    targets, graph = chain(1)
    exported = payload["performanceExport"]
    config = exported["performance"]["config"]
    config["instruments"][0]["id"] = "source"
    exported["patch_definitions"][0]["graph"] = targets[0].patch.graph.model_dump(mode="json", by_alias=True)
    for target in targets[1:]:
        add_instrument(payload, target.assignment_id, always_on=True,
                       patch={"graph": target.patch.graph.model_dump(mode="json", by_alias=True)})
    config.update(version=19, audioGraph=graph.model_dump(by_alias=True),
                  mixer={"strips": {"first": {"bypass": True}}, "sends": {}})
    if missing_asset:
        asset_graph = _performance_csd_export_payload(sfload_node_config={"sampleAsset": {
            "asset_id": "absent", "original_name": "unused.sf2", "stored_name": "unused.sf2",
            "content_type": "audio/sf2", "size_bytes": 42,
        }})["performanceExport"]["patch_definitions"][0]["graph"]
        fx = exported["patch_definitions"][1]["graph"]
        fx["nodes"].append(asset_graph["nodes"][-1])
        fx["ui_layout"].update(asset_graph["ui_layout"])
    return payload


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_csd_archive_omits_bypassed_synthesis_assets_and_renders_active_chain(tmp_path, mode):
    payload = export_payload(mode, missing_asset=True)
    original = deepcopy(payload)
    with _client(tmp_path) as client:
        csd, files = read_export(client, payload)
    assert payload == original
    assert "sfload" not in csd
    assert not any("/assets/" in name for name in files)
    assert "vcs_mix_" + token("patch:first") not in csd
    assert "vcs_mix_" + token("patch:second") in csd
    orc = csd.split("<CsInstruments>\n")[1].split("</CsInstruments>")[0]
    score = csd.split("<CsScore>\n")[1].split("</CsScore>")[0]
    midi_file = None
    if mode == "midiFile":
        midi_file = tmp_path / "bypass.mid"
        midi_file.write_bytes(next(value for name, value in files.items() if name.endswith(".mid")))
    with sound(orc, score, midi_file=midi_file) as cs:
        samples = render(cs, 10000)
    np.testing.assert_allclose(samples[3000:6000, 0], 0.6, atol=1e-8)


def test_shared_active_definition_keeps_assets_and_native_input_is_unchanged():
    payload = export_payload(missing_asset=True)
    exported = payload["performanceExport"]
    exported["performance"]["config"]["instruments"][2]["patchId"] = "first"
    request = PerformanceCsdExportRequest.model_validate(payload)
    result = select_performance_csd_instruments(request)
    shared = next(p for p in result.patch_definitions if p.source_patch_id == "first")
    assert any(node.opcode == "sfload" for node in shared.graph.nodes)
    assert shared == next(p for p in request.performance_export.patch_definitions if p.source_patch_id == "first")


def test_bypass_stereo_mapping_and_multiple_direct_outputs_match_offline():
    from backend.app.models.audio import AudioInterface, AudioPortGroup
    from backend.app.models.patch import Connection, NodeInstance

    src = source()
    fx = effect(direct=True, factor=7)
    # Two direct outputs must sum only on the wet path, never duplicate dry audio.
    fx.patch.graph.nodes += [NodeInstance(id="other-in", opcode="inleta", params={"sname": "right"}),
                             NodeInstance(id="out2", opcode="outs")]
    fx.patch.graph.connections += [Connection(from_node_id="multiply", from_port_id="aout",
                                              to_node_id="out2", to_port_id=side) for side in ("left", "right")]
    fx.patch.graph.audio_interface = AudioInterface(mainInput="in", mainOutput="out", groups=[
        AudioPortGroup(id="in", name="Input", direction="input", ports=["right", "left"]),
        AudioPortGroup(id="out", name="Output", direction="output", ports=["$direct.left", "$direct.right"]),
    ])
    graph = AudioGraph(insertOwners={"effect": "source"}, routes=[
        route("in", "source", "effect", source_port="$direct.left", target_port="right", sourceStage="raw", kind="insert"),
        route("wet-left", "effect", "source", source_port="$direct.left", target_port="$direct.left", targetStage="strip", kind="insert"),
        route("wet-right", "effect", "source", source_port="$direct.right", target_port="$direct.right", targetStage="strip", kind="insert"),
        # Explicit main routes suppress the effect's implicit direct exits.
    ])
    for r in graph.routes[1:]:
        r.kind = "main"
    mixer = MixerState(strips={"effect": MixerStrip(bypass=True)})
    for profile in (CompilationProfile.LIVE, CompilationProfile.OFFLINE):
        with engine(compile_audio([src, fx], graph, mixer, profile=profile)) as cs:
            samples = render(cs)
        np.testing.assert_allclose(samples[:, 0], 0.2, atol=1e-8)
        np.testing.assert_allclose(samples[:, 1], 0, atol=1e-8)


@pytest.mark.parametrize("bypassed,expected", [(False, [0.4, 0.9]), (True, [0.2, 0.3])])
def test_live_crossfade_stage_preserves_both_stereo_channels(bypassed, expected):
    from backend.app.models.patch import Connection, NodeInstance
    src = source(direct=False)
    src.patch.graph.nodes += [NodeInstance(id="right-signal", opcode="const_a", params={"value": 0.3}),
                             NodeInstance(id="right-out", opcode="outleta", params={"sname": "right"})]
    src.patch.graph.connections.append(Connection(from_node_id="right-signal", from_port_id="aout",
                                                  to_node_id="right-out", to_port_id="asignal"))
    fx = effect(factor=2)
    right_fx = effect(factor=3)
    fx.patch.graph.nodes += [node.model_copy(update={"id": "r-" + node.id,
        "params": {**node.params, **({"sname": "right"} if node.opcode in {"inleta", "outleta"} else {})}})
        for node in right_fx.patch.graph.nodes]
    fx.patch.graph.connections += [edge.model_copy(update={"from_node_id": "r-" + edge.from_node_id,
        "to_node_id": "r-" + edge.to_node_id}) for edge in right_fx.patch.graph.connections]
    routes = []
    for side in ("left", "right"):
        routes += [route("in-" + side, "source", "effect", source_port=side, target_port=side, kind="insert", sourceStage="raw"),
                   route("out-" + side, "effect", "source", source_port=side, target_port=side, kind="insert", targetStage="strip"),
                   route("output-" + side, "source", source_port=side, target_port=side)]
    artifact = compile_audio([src, fx], AudioGraph(routes=routes, insertOwners={"effect": "source"}),
                             MixerState(strips={"effect": MixerStrip(bypass=bypassed)}))
    with engine(artifact) as cs:
        samples = render(cs)
    np.testing.assert_allclose(samples, np.broadcast_to(expected, samples.shape), atol=1e-8)
