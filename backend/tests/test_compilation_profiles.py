"""The offline profile only specializes generated mixer processing."""

from dataclasses import replace
from copy import deepcopy
from io import BytesIO
import re
import shutil
import struct
import subprocess
import zipfile

import numpy as np
import pytest

from backend.app.models.audio import AudioGraph, AudioInterface, AudioPortGroup, MixerSend, MixerState, MixerStrip
from backend.app.models.patch import Connection, NodeInstance
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tests.csound_test_support import load_patch_fixture, orc_code_lines
from backend.tests.test_mixer_audio import compile_audio, effect, engine, render, route, source
from backend.tests.test_performance_controllers import controller_patch
from backend.tests.api_test_support import _client
from backend.tests.test_api import _performance_csd_export_payload


@pytest.mark.parametrize("mode", ["midi", "score"])
@pytest.mark.parametrize("legato", [False, True])
def test_profile_preserves_graph_manifest_and_live_default(mode, legato):
    compiler = CompilerService(OpcodeService("/static/icons"))
    targets = [source(ksmps=1, always_on=False)]
    if legato:
        patch = load_patch_fixture("midi_legato")
        patch.graph.engine_config = targets[0].patch.graph.engine_config.model_copy(deep=True)
        targets.append(PatchInstrumentTarget(patch=patch, assignment_id="legato", midi_channel=2))
    kwargs = dict(targets=targets, midi_input="0", rtmidi_module="none",
                  audio_graph=AudioGraph(), mixer=MixerState(), performance_input_mode=mode)
    default = compiler.compile_patch_bundle(**kwargs)
    live = compiler.compile_patch_bundle(**kwargs, profile=CompilationProfile.LIVE)
    offline = compiler.compile_patch_bundle(**kwargs, profile=CompilationProfile.OFFLINE)
    assert default == live
    assert live.manifest["meters"]
    assert offline.manifest == {**live.manifest, "meters": {}}
    assert offline.diagnostics == live.diagnostics
    assert "vcs_mixer_ramp" in live.orc and "__vcs_mixer_meter_" in live.orc
    for absent in ("vcs_mixer_ramp", "__vcs_mixer_", "max_k", "rms", "metro", "a_meter_"):
        assert absent not in "\n".join(orc_code_lines(offline.orc))

    def topology(orc):
        return [line for line in orc_code_lines(orc)
                if line.startswith(("instr ", "alwayson ", "connect ", "massign "))]

    assert topology(offline.orc) == topology(live.orc)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_legacy_without_mixer_graph_is_unchanged(mode):
    compiler = CompilerService(OpcodeService("/static/icons"))
    kwargs = dict(targets=[source()], midi_input="0", rtmidi_module="none", performance_input_mode=mode)
    assert compiler.compile_patch_bundle(**kwargs, profile=CompilationProfile.OFFLINE) == compiler.compile_patch_bundle(**kwargs)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_patch_analysis_and_controller_channels_are_not_stripped(mode):
    target = source(ksmps=1)
    target.patch = controller_patch(always_on=True, ksmps=1)
    target.patch.graph.nodes += [NodeInstance(id="meter", opcode="rms")]
    target.patch.graph.connections += [Connection(from_node_id="audio", from_port_id="aout",
                                                   to_node_id="meter", to_port_id="asig")]
    target.performance_controller_values = {"setting": 0.37}
    live = compile_audio([target], mode=mode)
    offline = compile_audio([target], mode=mode, profile=CompilationProfile.OFFLINE)
    # Compare the entire patch body, not just a list of opcodes safe to remove.
    pattern = r"; mixer stage patch:source.*?\ninstr [^\n]+\n(.*?)\nendin"
    body = re.search(pattern, live.orc, re.S)[1]
    assert re.search(pattern, offline.orc, re.S)[1] == body
    assert " rms " in body and " chnget " in body
    binding = offline.manifest["performanceControllers"]["source"]["setting"]
    assert f'chnset 0.37, "{binding["channel"]}"' in offline.orc
    with engine(offline) as cs:
        np.testing.assert_allclose(render(cs, 8), 0.37, atol=1e-9, rtol=0)


def _snapshot_case(case):
    """Synthetic inputs independent of the developer example library."""
    note = source(ksmps=1, always_on=False, copies=2)
    graph = AudioGraph()
    mixer = MixerState()
    targets = [note]
    if case == "polyphonic_stereo":
        note.patch.graph.nodes += [NodeInstance(id="right", opcode="const_a", params={"value": 0.1})]
        for connection in note.patch.graph.connections:
            if connection.to_port_id == "right":
                connection.from_node_id = "right"
        targets += [replace(note, assignment_id="other", midi_channel=2)]
        mixer = MixerState(strips={"source": MixerStrip(gainDb=-6, balance=0.3),
                                   "other": MixerStrip(gainDb=None)})
    elif case in {"pre", "post", "mute"}:
        note = source(ksmps=1, direct=False, always_on=False)
        targets = [note, effect("insert", ksmps=1, factor=2), effect("return", ksmps=1)]
        graph = AudioGraph(masterId="$master", insertOwners={"insert": "source"}, routes=[
            route("insert-in", "source", "insert", kind="insert", sourceStage="raw"),
            route("insert-out", "insert", "source", kind="insert", targetStage="strip"),
            route("dry", "source", "$master"),
            route("send", "source", "return", kind="send"),
            route("return", "return", "$master", target_port="right"),
        ])
        mixer = MixerState(strips={"source": MixerStrip(gainDb=-6, mute=case == "mute"),
                                   "$master": MixerStrip(gainDb=-3)},
                           sends={"send": MixerSend(gainDb=-4, tap="post" if case == "post" else "pre")})
    elif case == "solo_sidechain":
        fx = effect(ksmps=1)
        fx.patch.graph.audio_interface = AudioInterface(groups=[AudioPortGroup(
            id="side", name="Sidechain", direction="input", layout="mono", ports=["left"], purpose="sidechain")])
        targets = [source(direct=False, ksmps=1), source("other", direct=False, ksmps=1), fx]
        graph = AudioGraph(routes=[route("dry", "source"), route("other-dry", "other"),
                                   route("feed", "source", "effect"), route("side", "other", "effect"),
                                   route("return", "effect", target_port="right")])
        mixer = MixerState(strips={"source": MixerStrip(solo=True), "effect": MixerStrip(solo=True)})
    elif case == "mono_pan":
        mono = source(direct=False, ksmps=1)
        mono.patch.graph.audio_interface = AudioInterface(groups=[AudioPortGroup(
            id="mono", name="Mono", direction="output", layout="mono", ports=["left"])], mainOutput="mono")
        targets = [mono]
        graph = AudioGraph(routes=[route("left", "source"), route("right", "source", target_port="right")])
        mixer = MixerState(strips={"source": MixerStrip(balance=-0.3)})
    elif case == "master_and_direct":
        targets = [source(direct=False, ksmps=1), source("direct", ksmps=1)]
        graph = AudioGraph(masterId="$master", routes=[route("main", "source", "$master")])
        mixer = MixerState(strips={"$master": MixerStrip(gainDb=-6), "direct": MixerStrip(gainDb=-12)})
    return targets, graph, mixer


@pytest.mark.parametrize("case", ["polyphonic_stereo", "pre", "post", "mute", "solo_sidechain", "mono_pan", "master_and_direct"])
def test_offline_snapshot_audio_matches_live(case):
    targets, graph, mixer = _snapshot_case(case)
    outputs = []
    for profile in CompilationProfile:
        artifact = compile_audio(targets, graph, mixer, profile=profile)
        notes = [f'i {artifact.manifest["instrumentReferences"][t.assignment_id]} {start} 0.015'
                 for t in targets if not t.always_on for start in (0, 0.01)]
        with engine(artifact, "\n".join([*notes, "f 0 0.05"])) as cs:
            outputs.append(render(cs, 1800))
    np.testing.assert_allclose(outputs[1], outputs[0], atol=1e-9, rtol=0)
    assert np.isfinite(outputs[1]).all()
    if case == "mute":
        assert not outputs[1].any()
    else:
        assert np.max(np.abs(outputs[1])) > 0.01
    if case in {"polyphonic_stereo", "pre", "post", "mute"}:
        assert not outputs[1][-200:].any()


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_offline_note_release_and_downstream_delay_tail(mode):
    note = source(ksmps=1, always_on=False, direct=False)
    note.patch.graph.nodes[0] = NodeInstance(id="env", opcode="madsr", params={
        "iatt": 0.001, "idec": 0.001, "islev": 0.2, "irel": 0.02})
    note.patch.graph.nodes += [NodeInstance(id="signal", opcode="upsamp")]
    note.patch.graph.connections += [Connection(from_node_id="env", from_port_id="kenv",
                                                to_node_id="signal", to_port_id="ksig")]
    delay = effect(ksmps=1)
    delay.patch.graph.nodes = [NodeInstance(id="in", opcode="inleta", params={"sname": "left"}),
                               NodeInstance(id="delay", opcode="delay", params={"idlt": 0.015}),
                               NodeInstance(id="out", opcode="outleta", params={"sname": "left"})]
    delay.patch.graph.connections = [
        Connection(from_node_id="in", from_port_id="asignal", to_node_id="delay", to_port_id="asig"),
        Connection(from_node_id="delay", from_port_id="aout", to_node_id="out", to_port_id="asignal")]
    outputs = []
    for profile in CompilationProfile:
        artifact = compile_audio([note, delay], AudioGraph(routes=[route("feed", "source", "effect"),
                                                                  route("return", "effect")]), profile=profile, mode=mode)
        ref = artifact.manifest["instrumentReferences"]["source"]
        with engine(artifact, f"i {ref} 0 0.02\nf 0 0.08") as cs:
            outputs.append(render(cs, 3360))
    np.testing.assert_allclose(outputs[1], outputs[0], atol=1e-9, rtol=0)
    assert np.max(outputs[1][1920:2400, 0]) > 0.01  # After note-off plus its release, the delay still rings.
    assert not outputs[1][-480:].any()


def _render_archive(content, directory):
    with zipfile.ZipFile(BytesIO(content)) as archive:
        archive.extractall(directory)
    csd = next(directory.rglob("*.csd"))
    result = subprocess.run(["csound", "-m0", csd.name], cwd=csd.parent, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode()
    wav = next(csd.parent.glob("*.wav")).read_bytes()
    offset = 12
    samples = None
    while offset + 8 <= len(wav):
        kind, size = struct.unpack_from("<4sI", wav, offset)
        chunk = wav[offset + 8:offset + 8 + size]
        if kind == b"fmt ":
            assert struct.unpack_from("<HHI", chunk) == (3, 2, 48000)
        elif kind == b"data":
            samples = np.frombuffer(chunk, dtype="<f4").reshape(-1, 2)
        offset += 8 + size + size % 2
    assert samples is not None and len(samples) == 120000  # 0.5 seconds plus the two-second export tail.
    return samples


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_export_render_keeps_controller_curve_settings_and_tail(tmp_path, monkeypatch, mode):
    if not shutil.which("csound"):
        pytest.skip("Csound executable is not installed")
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    exported = payload["performanceExport"]
    graph = exported["patch_definitions"][0]["graph"]
    graph["nodes"] = [
        {"id": "setting", "opcode": "perf_controller"},
        {"id": "cc", "opcode": "midictrl", "params": {"inum": 1, "imin": 0, "imax": 1}},
        {"id": "scale", "opcode": "upsamp"}, {"id": "signal", "opcode": "upsamp"},
        {"id": "product", "opcode": "a_mul"},
        {"id": "out", "opcode": "outleta", "params": {"sname": "left"}},
    ]
    graph["connections"] = [
        {"from_node_id": a, "from_port_id": ap, "to_node_id": b, "to_port_id": bp}
        for a, ap, b, bp in [("setting", "iout", "scale", "ksig"), ("cc", "kval", "signal", "ksig"),
                             ("scale", "aout", "product", "a"), ("signal", "aout", "product", "b"),
                             ("product", "aout", "out", "asignal")]
    ]
    delay_graph = {**deepcopy(graph), "nodes": [
        {"id": "in", "opcode": "inleta", "params": {"sname": "left"}},
        {"id": "delay", "opcode": "delay", "params": {"idlt": 0.02}},
        {"id": "out", "opcode": "outs"},
    ], "connections": [
        {"from_node_id": a, "from_port_id": ap, "to_node_id": b, "to_port_id": bp}
        for a, ap, b, bp in [("in", "asignal", "delay", "asig"), ("delay", "aout", "out", "left"),
                             ("delay", "aout", "out", "right")]
    ]}
    exported["patch_definitions"].append({"sourcePatchId": "delay", "name": "Delay", "schema_version": 1,
                                           "alwaysOn": True, "graph": delay_graph})
    exported["performance"]["config"] = {
        "version": 18, "instruments": [
            {"id": "source", "patchId": "patch-1", "midiChannel": 1, "performanceControllerValues": {"setting": 0.2}},
            {"id": "delay", "patchId": "delay", "midiChannel": 0},
        ],
        "audioGraph": {"masterId": None, "insertOwners": {}, "routes": [
            {"id": "feed", "sourceId": "source", "sourcePort": "left", "targetId": "delay", "targetPort": "left"}]},
        "mixer": {"strips": {"source": {"gainDb": -6.020599913279624}}, "sends": {}},
    }
    payload["sequencerConfig"]["controller_tracks"][0]["pads"][0]["keypoints"] = [
        {"position": 0, "value": 32}, {"position": 0.5, "value": 127}]
    with _client(tmp_path) as client:
        offline = client.post("/api/bundles/export/performance-csd", json=payload)
        assert offline.status_code == 200, offline.text
        original = CompilerService.compile_patch_bundle

        def force_live(self, *args, **kwargs):
            assert kwargs["profile"] == CompilationProfile.OFFLINE
            return original(self, *args, **{**kwargs, "profile": CompilationProfile.LIVE})

        with monkeypatch.context() as context:
            context.setattr(CompilerService, "compile_patch_bundle", force_live)
            live = client.post("/api/bundles/export/performance-csd", json=payload)
        assert live.status_code == 200, live.text
    rendered = _render_archive(offline.content, tmp_path / "offline")
    baseline = _render_archive(live.content, tmp_path / "live")
    np.testing.assert_allclose(rendered, baseline, atol=1e-7, rtol=0)
    assert not rendered[:900].any()  # Delay onset is preserved.
    assert 0 < rendered.max() <= 0.1  # Instance setting 0.2 times the saved 0.5 fader.
    assert rendered[4800:5280].mean() > rendered[1920:2400].mean()  # Authored CC curve still moves.
    assert rendered[6240:6720].max() > 0  # Delay output continues after the note ends at 0.125 s.
    assert not rendered[8000:].any()
