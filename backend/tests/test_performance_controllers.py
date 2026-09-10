from __future__ import annotations

from copy import deepcopy
from io import BytesIO
import json
import struct
import shutil
import subprocess
import zipfile

import numpy as np
import pytest

from backend.app.models.audio import AudioGraph, MixerState, MixerStrip
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchDocument, PatchGraph
from backend.app.services.compiler_common import CompilationError, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tests.api_test_support import _client
from backend.tests.test_api import _performance_csd_export_payload
from backend.tests.test_mixer_audio import engine, render


def controller_patch(*, always_on=False, params=None, ksmps=32):
    return PatchDocument(id="controller-patch", name="Controller patch", always_on=always_on, graph=PatchGraph(
        nodes=[NodeInstance(id="setting", opcode="perf_controller", params=params or {}),
               NodeInstance(id="audio", opcode="upsamp"), NodeInstance(id="output", opcode="outs")],
        connections=[Connection(from_node_id="setting", from_port_id="iout", to_node_id="audio", to_port_id="ksig"),
                     *[Connection(from_node_id="audio", from_port_id="aout", to_node_id="output", to_port_id=side) for side in ("left", "right")]],
        engine_config=EngineConfig(sr=48000, ksmps=ksmps),
    ))


def compile_targets(targets, *, mixer=False, mode="midi"):
    return CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode=mode,
        audio_graph=AudioGraph() if mixer else None,
        mixer=MixerState(strips={"one": MixerStrip(gainDb=-6.020599913279624)}) if mixer else None,
    )


@pytest.mark.parametrize("params", [
    {"min": 1, "max": 1}, {"min": 2, "max": 1}, {"default": 2}, {"scale": "logarithmic"},
    {"min": float("nan")}, {"max": float("inf")}, {"default": True}, {"label": " "}, {"scale": "other"},
])
def test_invalid_controller_definitions_fail_compilation(params):
    with pytest.raises(CompilationError, match="Patch compilation failed"):
        compile_targets([PatchInstrumentTarget(controller_patch(params=params), 1)])


def test_catalog_and_standalone_defaults():
    service = OpcodeService(icon_prefix="/static/icons")
    opcode = service.get_opcode("perf_controller")
    assert opcode.inputs == []
    assert [(p.id, p.signal_type.value) for p in opcode.outputs] == [("iout", "i")]
    patch = controller_patch()
    artifact = CompilerService(service).compile_patch(patch, "0", "none")
    binding = artifact.manifest["performanceControllers"]["instrument-1"]["setting"]
    assert binding["value"] == 0.5
    assert f'chnset 0.5, "{binding["channel"]}"' in artifact.orc
    assert "perf_controller " not in artifact.orc
    assert patch.graph.nodes[0].params == {}


def test_duplicate_labels_keep_independent_node_identities():
    patch = controller_patch(params={"label": "Time"})
    patch.graph.nodes.append(NodeInstance(id="second", opcode="perf_controller", params={"label": "Time"}))
    target = PatchInstrumentTarget(patch, 1, assignment_id="one", performance_controller_values={"setting": 0.2, "second": 0.8})
    controllers = compile_targets([target]).manifest["performanceControllers"]["one"]
    assert [item["value"] for item in controllers.values()] == [0.2, 0.8]
    assert controllers["setting"]["channel"] != controllers["second"]["channel"]


@pytest.mark.parametrize("mixer", [False, True])
@pytest.mark.parametrize("ksmps", [1, 32])
def test_i_rate_held_notes_next_notes_and_independent_instances(mixer, ksmps):
    patch = controller_patch(ksmps=ksmps)
    targets = [PatchInstrumentTarget(patch, 1, assignment_id="one", performance_controller_values={"setting": 0.2}),
               PatchInstrumentTarget(patch, 2, assignment_id="two", performance_controller_values={"setting": 0.3})]
    artifact = compile_targets(targets, mixer=mixer)
    bindings = artifact.manifest["performanceControllers"]
    assert bindings["one"]["setting"]["channel"] != bindings["two"]["setting"]["channel"]
    refs = artifact.manifest.get("instrumentReferences", {"one": "1", "two": "2"})
    gain = 0.5 if mixer else 1
    with engine(artifact, f'i {refs["one"]} 0 1\ni {refs["two"]} 0 1\nf 0 2') as cs:
        np.testing.assert_allclose(render(cs, 3), 0.2 * gain + 0.3, atol=1e-9)
        cs.setControlChannel(bindings["one"]["setting"]["channel"], 0.4)
        np.testing.assert_allclose(render(cs, 3), 0.2 * gain + 0.3, atol=1e-9)
        cs.inputMessage(f'i {refs["one"]} 0 1')
        np.testing.assert_allclose(render(cs, 3)[-1], 0.6 * gain + 0.3, atol=1e-9)


@pytest.mark.parametrize("mixer", [False, True])
def test_continuous_settings_are_initialized_before_alwayson_and_change_on_restart(mixer):
    target = PatchInstrumentTarget(controller_patch(always_on=True), 0, assignment_id="one", always_on=True,
                                   performance_controller_values={"setting": 0.2})
    artifact = compile_targets([target], mixer=mixer)
    binding = artifact.manifest["performanceControllers"]["one"]["setting"]
    assert artifact.orc.index('chnset 0.2') < artifact.orc.index("alwayson")
    gain = 0.5 if mixer else 1
    with engine(artifact) as cs:
        np.testing.assert_allclose(render(cs, 3), 0.2 * gain, atol=1e-9)
        cs.setControlChannel(binding["channel"], 0.8)
        np.testing.assert_allclose(render(cs, 3), 0.2 * gain, atol=1e-9)
    target.performance_controller_values = {"setting": 0.8}
    with engine(compile_targets([target], mixer=mixer)) as cs:
        np.testing.assert_allclose(render(cs, 3), 0.8 * gain, atol=1e-9)


def test_session_updates_reset_validation_persistence_and_restart(tmp_path):
    with _client(tmp_path) as client:
        saved = client.post("/api/patches", json=controller_patch().model_dump(mode="json", by_alias=True)).json()
        patch_id = saved["id"]
        listed = next(p for p in client.get("/api/patches").json() if p["id"] == patch_id)
        assert listed["performance_controllers"][0]["default"] == 0.5
        assignments = [{"id": name, "patch_id": patch_id, "midi_channel": channel, "performance_controller_values": {"setting": value}}
                       for name, channel, value in [("one", 1, 0.2), ("two", 2, 0.3)]]
        response = client.post("/api/sessions", json={"instruments": assignments})
        assert response.status_code == 201, response.text
        session = response.json()["session_id"]
        assert response.json()["instruments"][0]["performance_controller_values"] == {"setting": 0.2}
        endpoint = f"/api/sessions/{session}/instruments/one/performance-controllers"
        assert client.post(f"/api/sessions/{session}/start").status_code == 200
        for values in [{"setting": -1}, {"unknown": 0.5}, {"setting": True}, {"setting": "bad"}]:
            assert client.put(endpoint, json={"values": values}).status_code == 422
        assert client.put(endpoint.replace("/one/", "/missing/"), json={"values": {}}).status_code == 404
        assert client.put(endpoint, json={"values": {"setting": 0.7}}).json() == {"values": {"setting": 0.7}}
        state = client.get(f"/api/sessions/{session}").json()
        assert state["state"] == "running"
        assert [i["performance_controller_values"] for i in state["instruments"]] == [{"setting": 0.7}, {"setting": 0.3}]
        assert client.post(f"/api/sessions/{session}/stop").status_code == 200
        compiled = client.post(f"/api/sessions/{session}/compile").json()
        assert compiled["manifest"]["performanceControllers"]["one"]["setting"]["value"] == 0.7
        assert client.put(endpoint, json={"values": {}}).json() == {"values": {}}
        compiled = client.post(f"/api/sessions/{session}/compile").json()
        assert compiled["manifest"]["performanceControllers"]["one"]["setting"]["value"] == 0.5
        assert client.post(f"/api/sessions/{session}/start").status_code == 200
        changed_graph = saved["graph"]
        changed_graph["nodes"][0]["params"]["default"] = 0.6
        assert client.put(f"/api/patches/{patch_id}", json={"graph": changed_graph}).status_code == 200
        assert client.put(endpoint, json={"values": {"setting": 0.8}}).status_code == 409
        assert client.post(f"/api/sessions/{session}/stop").status_code == 200
        assert client.put(endpoint, json={"values": {"setting": 0.8}}).status_code == 200
        assert client.post(f"/api/sessions/{session}/start").status_code == 200
        config = {"version": 12, "instruments": [{"id": "one", "patchId": patch_id, "midiChannel": 1, "performanceControllerValues": {"setting": 0.7}}]}
        performance = client.post("/api/performances", json={"name": "Settings", "config": config}).json()
        assert client.get(f'/api/performances/{performance["id"]}').json()["config"] == config


@pytest.mark.parametrize("archive_format", ["json", "zip"])
def test_native_bundle_roundtrip_preserves_controller_definitions_and_overrides(tmp_path, archive_format):
    payload = _performance_csd_export_payload()["performanceExport"]
    payload["patch_definitions"][0]["graph"] = controller_patch(params={"label": "Attack", "min": 0.01, "max": 10, "default": 0.1, "scale": "logarithmic"}).graph.model_dump(mode="json", by_alias=True)
    payload["performance"]["config"] = {"version": 12, "instruments": [
        {"id": "one", "patchId": "patch-1", "midiChannel": 1, "performanceControllerValues": {"setting": 0.3}},
        {"id": "two", "patchId": "patch-1", "midiChannel": 2, "performanceControllerValues": {}},
    ]}
    with _client(tmp_path) as client:
        exported = client.post("/api/bundles/export/performance", json=payload)
        assert exported.status_code == 200
        data = exported.content
        if archive_format == "zip":
            buffer = BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                archive.writestr("performance.orch.json", data)
            data = buffer.getvalue()
        imported = client.post("/api/bundles/import/expand", content=data,
                               headers={"Content-Type": "application/octet-stream", "X-File-Name": f"settings.orch.{archive_format}"})
        assert imported.status_code == 200, imported.text
        restored = imported.json()
        assert restored["performance"]["config"] == payload["performance"]["config"]
        assert restored["patch_definitions"][0]["graph"] == payload["patch_definitions"][0]["graph"]
        assert json.loads(exported.content) == payload


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_both_export_modes_render_instance_settings_without_client(tmp_path, mode):
    if not shutil.which("csound"):
        pytest.skip("Csound executable is not installed")
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    exported = payload["performanceExport"]
    exported["patch_definitions"][0]["graph"] = controller_patch().graph.model_dump(mode="json", by_alias=True)
    exported["performance"]["config"] = {"version": 12, "instruments": [
        {"id": "one", "patchId": "patch-1", "midiChannel": 1, "performanceControllerValues": {"setting": 0.2}},
        {"id": "two", "patchId": "patch-1", "midiChannel": 2, "performanceControllerValues": {"setting": 0.3}},
    ]}
    second = deepcopy(payload["sequencerConfig"]["tracks"][0])
    second.update(track_id="voice-2", midi_channel=2)
    payload["sequencerConfig"]["tracks"].append(second)
    payload["sequencerConfig"]["controller_tracks"] = []
    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200, response.text
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        archive.extractall(tmp_path / "render")
    csd = next((tmp_path / "render").rglob("*.csd"))
    text = csd.read_text()
    assert "__vcs_perf_" in text
    result = subprocess.run(["csound", csd.name], cwd=csd.parent, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode()
    wav = next(csd.parent.glob("*.wav")).read_bytes()
    offset = 12
    samples = None
    while offset + 8 <= len(wav):
        kind, size = struct.unpack_from("<4sI", wav, offset)
        chunk = wav[offset + 8:offset + 8 + size]
        if kind == b"fmt ":
            format_code, channels, rate = struct.unpack_from("<HHI", chunk)
            assert format_code == 3 and channels == 2 and rate == 48000
        if kind == b"data":
            samples = np.frombuffer(chunk, dtype="<f4")
        offset += 8 + size + (size % 2)
    assert samples is not None and len(samples) > 0
    assert samples.max() == pytest.approx(0.5, abs=1e-7)
    # The retained defaults in the patch definition are independent of performance overrides.
    assert exported["patch_definitions"][0]["graph"]["nodes"][0]["params"] == {}
