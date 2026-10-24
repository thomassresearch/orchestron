"""Native regressions for the audio-output limit node's accepted input rates."""
import shutil
import subprocess

import numpy as np
import pytest

from backend.app.models.patch import Connection, NodeInstance, PatchDocument, PatchGraph
from backend.app.models.audio import AudioGraph
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.engine.csound_worker import CsoundWorker
from backend.tests.csound_test_support import load_patch_fixture, orc_code_lines


@pytest.mark.parametrize("source", ["literal", "formula", "i", "k", "a", "mixed_formula"])
def test_limit_native_accepts_input_rates(source, tmp_path):
    patch = PatchDocument(name="Limit rates", graph=PatchGraph(
        nodes=[NodeInstance(id="clamp", opcode="limit", params={"xin": 2, "xmin": -.5, "xmax": .5}),
               NodeInstance(id="out", opcode="outs")],
        connections=[Connection(from_node_id="clamp", from_port_id="xout", to_node_id="out", to_port_id=side)
                     for side in ["left", "right"]],
    ))
    if source in {"i", "k", "a", "mixed_formula"}:
        for rate in (["i", "k"] if source == "mixed_formula" else [source]):
            patch.graph.nodes.append(NodeInstance(id=rate, opcode=f"const_{rate}", params={"value": 2}))
            patch.graph.connections.append(Connection(from_node_id=rate, from_port_id=f"{rate}out", to_node_id="clamp", to_port_id="xin"))
    if source in {"formula", "mixed_formula"}:
        patch.graph.ui_layout["input_formulas"] = {"clamp::xin": {
            "expression": "in1 * in2" if source == "mixed_formula" else "2 * 3",
            "inputs": [{"token": f"in{index}", "from_node_id": rate, "from_port_id": f"{rate}out"}
                       for index, rate in enumerate(["i", "k"], 1)] if source == "mixed_formula" else [],
        }}
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch(patch, "0", "null")
    line = next(line for line in orc_code_lines(artifact.orc) if " limit " in line)
    assert (" limit a(" in line) == (source != "a")
    csound = shutil.which("csound")
    if not csound:
        pytest.skip("Csound executable unavailable")
    csd = tmp_path / "limit.csd"
    csd.write_text(artifact.csd)
    result = subprocess.run([csound, "--syntax-check-only", "-n", str(csd)], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr


def test_goa_lead_starts_and_renders_with_mixer(monkeypatch):
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)
    worker = CsoundWorker()
    if worker.backend != "ctcsound":
        pytest.skip("Native Csound unavailable")
    patch = load_patch_fixture("goa_trance_fm_lead")
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=5, assignment_id="lead")], "0", "null",
        audio_graph=AudioGraph.model_validate({"masterId": "$master", "routes": [
            {"id": side, "sourceId": "lead", "sourcePort": side, "targetId": "$master", "targetPort": side}
            for side in ["left", "right"]
        ]}),
    )
    try:
        worker.start(artifact.csd, "internal:loopback", "null")
        worker.configure_mixer(artifact.manifest, artifact.manifest.get("initialControls", {}))
        assert worker.queue_midi_message([0x94, 60, 100])
        audio = np.frombuffer(worker.render_blocks(block_count=512, target_sample_rate=48000).pcm_f32le, dtype="<f4")
        assert np.isfinite(audio).all()
        assert np.max(np.abs(audio)) > 1e-5
    finally:
        worker.stop()
