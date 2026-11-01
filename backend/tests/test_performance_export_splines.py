"""Original-curve export must reproduce captured CCs and note initialization."""
from copy import deepcopy
from io import BytesIO
import re
import zipfile

import numpy as np
import pytest

from backend.app.models.export import PerformanceCsdExportRequest
from backend.app.services.compiler_service import CompilerService
from backend.app.services.gen_asset_service import GenAssetService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_export_service import PerformanceExportService
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.test_api import _performance_csd_export_payload
from backend.tests.test_performance_export_compaction import render


def spline_payload():
    payload = _performance_csd_export_payload()
    payload["eventSource"] = "score"
    graph = load_patch_fixture("performance_controller_midi").graph.model_dump(mode="json")
    # Left channel samples an I-rate mapping, right channel follows the raw CC.
    graph["nodes"].extend([
        {"id": "cc", "opcode": "midictrl", "params": {"inum": 21, "imax": 127}},
        {"id": "cc_audio", "opcode": "upsamp", "params": {}},
    ])
    graph["connections"] = [c for c in graph["connections"]
                             if not (c["to_node_id"] == "output" and c["to_port_id"] == "right")]
    graph["connections"].extend([
        dict(from_node_id="cc", from_port_id="kval", to_node_id="cc_audio", to_port_id="ksig"),
        dict(from_node_id="cc_audio", from_port_id="aout", to_node_id="output", to_port_id="right"),
    ])
    exported = payload["performanceExport"]
    exported["patch_definitions"][0]["graph"] = graph
    exported["performance"]["config"] = {"version": 22, "instruments": [{
        "id": "one", "patchId": "patch-1", "midiChannel": 1,
        "performanceControllerValues": {"setting": .2}, "performanceControllerMidiCCs": {"setting": 21}}]}
    config = payload["sequencerConfig"]
    config["playback_end_step"] = 48
    config["tracks"][0]["pads"][0]["steps"] = [{"note": 60 + i, "velocity": 100} for i in range(4)]
    track = config["controller_tracks"][0]
    track.update(controller_number=21, target_channels=[1], pad_loop_enabled=True, pad_loop_sequence=[0, -1, 1], pad_loop_repeat=True)
    track["pads"][0]["keypoints"] = [dict(position=x, value=y) for x, y in [(0, 10), (.2, 110), (.7, 20), (1, 70)]]
    track["pads"].append({**deepcopy(track["pads"][0]), "pad_index": 1,
        "keypoints": [dict(position=x, value=y) for x, y in [(0, 100), (.35, 5), (1, 80)]]})
    return payload


def export_csd(payload, tmp_path):
    service = PerformanceExportService(CompilerService(OpcodeService("/static/icons")), GenAssetService(tmp_path / "assets"))
    archive = service.build_performance_csd_archive(PerformanceCsdExportRequest.model_validate(payload))
    with zipfile.ZipFile(BytesIO(archive)) as z:
        return z.read("Offline_Export/Offline_Export.csd").decode()


def render_csd(csd):
    orc = csd.split("<CsInstruments>")[1].split("</CsInstruments>")[0]
    score = csd.split("<CsScore>")[1].split("</CsScore>")[0]
    return render(orc, score.splitlines())


@pytest.mark.parametrize("variant", ["basic", "seek", "rational", "tempo162", "finite", "queued", "logarithmic", "integer", "bool"])
def test_original_splines_match_exact_cc_and_mapped_note_samples(tmp_path, variant):
    payload = spline_payload()
    config = payload["sequencerConfig"]
    track = config["controller_tracks"][0]
    if variant == "seek":
        config["playback_start_step"] = 3
    elif variant == "rational":
        config["timing"]["tempo_bpm"] = 137
        track["timing"].update(beat_rate_numerator=3, beat_rate_denominator=2)
    elif variant == "tempo162":
        # Six-decimal score times can cross a half-sample boundary here.
        config["timing"]["tempo_bpm"] = 162
    elif variant == "finite":
        track["pad_loop_repeat"] = False
    elif variant == "queued":
        track.update(pad_loop_enabled=False, queued_pad=1)
    elif variant in {"logarithmic", "integer", "bool"}:
        params = next(n["params"] for n in payload["performanceExport"]["patch_definitions"][0]["graph"]["nodes"] if n["id"] == "setting")
        if variant == "logarithmic":
            params.update(min=.001, max=1000, default=.2, scale="logarithmic")
        elif variant == "integer":
            params.update(min=-8, max=8, default=0, controller_type="integer")
        else:
            params.update(min=0, max=1, default=0, controller_type="bool")
        payload["performanceExport"]["performance"]["config"]["instruments"][0]["performanceControllerValues"] = {}
    original = export_csd(payload, tmp_path)
    assert "opcode VcsSplineI" in original and "i_vcs_cc VcsSplineI" in original
    payload["approximateControllerCurves"] = False
    exact = export_csd(payload, tmp_path)
    before, after = render_csd(exact), render_csd(original)
    np.testing.assert_array_equal(after[:, 1], before[:, 1])
    np.testing.assert_allclose(after[:, 0], before[:, 0], rtol=1e-14, atol=1e-14)
    assert [line for line in exact.splitlines() if line.startswith(";")] == [
        line for line in original.splitlines() if line.startswith(";") and "Original Catmull" not in line]


@pytest.mark.parametrize("variant", ["competing", "initc7", "step", "midi", "optout", "legato"])
def test_original_spline_fallbacks_preserve_explicit_events(tmp_path, variant):
    payload = spline_payload()
    config = payload["sequencerConfig"]
    graph = payload["performanceExport"]["patch_definitions"][0]["graph"]
    if variant == "competing":
        other = deepcopy(config["controller_tracks"][0])
        other["track_id"] = "competitor"
        config["controller_tracks"].append(other)
    elif variant == "initc7":
        graph["nodes"].append(dict(id="init", opcode="initc7", params=dict(ichan=1, ictlno=21, ivalue=.5)))
    elif variant == "step":
        config["controller_tracks"][0].update(controller_mode="step")
        for pad in config["controller_tracks"][0]["pads"]:
            pad["steps"] = [10, None, 100, 0]
    elif variant == "midi":
        payload["eventSource"] = "midiFile"
    elif variant == "optout":
        payload["useOriginalControllerCurves"] = False
    elif variant == "legato":
        graph["nodes"].extend(n.model_dump(mode="json") for n in load_patch_fixture("midi_legato").graph.nodes if n.opcode in {"midi_legato", "madsr"})
    csd = export_csd(payload, tmp_path)
    assert "i_vcs_cc VcsSplineI" not in csd
    assert len(re.findall(r"^i 1 ", csd, re.MULTILINE)) > 5
    if variant in {"competing", "initc7", "step", "midi", "optout"}:
        assert "opcode VcsSplineI" not in csd
