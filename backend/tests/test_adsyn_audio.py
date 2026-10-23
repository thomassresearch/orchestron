"""Real Csound tests for the uploaded analysis source, including branch placement."""
import numpy as np
import pytest

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.tests.adsyn_test_support import ANALYSIS_FILE, adsyn_compiler, adsyn_patch
from backend.tests.test_control_flow import branch_patch


def render_adsyn(tmp_path, *, branch=None, **params):
    patch = adsyn_patch(**params)
    if branch:
        result = branch_patch(kind=branch)
        tone = next(n for n in result.graph.nodes if n.id == "tone")
        tone.opcode, tone.params = "adsyn", params
        for connection in result.graph.connections:
            if connection.from_node_id == "tone":
                connection.from_port_id = "ares"
        result.graph.ui_layout = patch.graph.ui_layout
        patch = result
    orc = adsyn_compiler(tmp_path).compile_patch(patch, midi_input="0", rtmidi_module="none").orc
    # No external MIDI is required: choose the first branch by literal selector.
    if branch:
        orc = orc.replace(" notnum", " = 36 ; notnum")
    cs = load_ctcsound_module().Csound()
    try:
        from backend.app.engine.csound_worker import CsoundWorker
        worker = CsoundWorker(gen_audio_assets_dir=str(tmp_path))
        worker._apply_gen_audio_search_dir_option(cs)
        text = f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n<CsInstruments>\n{orc}\n</CsInstruments>\n<CsScore>\ni 1 0 0.9\nf 0 1\n</CsScore>\n</CsoundSynthesizer>"
        assert cs.compileCsdText(text) == 0
        assert cs.start() == 0
        frames = []
        while cs.performKsmps() == 0:
            frames.append(cs.spout().copy().reshape(-1, 2)[:, 0])
        return np.concatenate(frames), cs.sr()
    finally:
        cs.cleanup()
        cs.reset()


def test_adsyn_native_amplitude_pitch_speed_and_branches(tmp_path):
    (tmp_path / ANALYSIS_FILE.name).write_bytes(ANALYSIS_FILE.read_bytes())
    base, sr = render_adsyn(tmp_path)
    assert np.isfinite(base).all() and np.max(np.abs(base)) > 0.1
    quieter, _ = render_adsyn(tmp_path, kamod=0.5)
    np.testing.assert_allclose(quieter, base * 0.5, atol=1e-6)
    higher, _ = render_adsyn(tmp_path, kfmod=2)
    def peak(signal):
        segment = signal[int(sr * 0.05):int(sr * 0.3)]
        return np.argmax(abs(np.fft.rfft(segment * np.hanning(len(segment))))) * sr / len(segment)
    assert peak(base) == pytest.approx(440, abs=5)
    assert peak(higher) == pytest.approx(880, abs=5)
    faster, _ = render_adsyn(tmp_path, ksmod=2)
    def rms(signal, start, end):
        return np.sqrt(np.mean(signal[int(sr * start):int(sr * end)] ** 2))
    assert rms(faster, .2, .3) < rms(base, .2, .3) * .6
    for branch in ("if", "switch"):
        branched, _ = render_adsyn(tmp_path, branch=branch)
        np.testing.assert_allclose(branched, base, atol=1e-6)


@pytest.mark.parametrize("data", [b"This is not hetro analysis data.\n", b"", b"HETRO 1\n-1,0,10,32767\n",
                                  b"HETRO 1\n-1,0,10,5", b"HETRO 9\n-1,0,1,32767\n-2,0,440,32767\n"])
def test_adsyn_malformed_file_reports_compile_error(tmp_path, data):
    from backend.app.services.compiler_common import CompilationError
    (tmp_path / ANALYSIS_FILE.name).write_bytes(data)
    with pytest.raises(CompilationError) as error:
        adsyn_compiler(tmp_path).compile_patch(adsyn_patch(), midi_input="0", rtmidi_module="none")
    assert "adsyn node" in " ".join(error.value.diagnostics)


def test_adsyn_legacy_binary_matches_text_analysis(tmp_path):
    from array import array
    import re
    data = ANALYSIS_FILE.read_bytes()
    (tmp_path / ANALYSIS_FILE.name).write_bytes(data)
    text_audio, _ = render_adsyn(tmp_path)
    values = array("h", (int(t) for t in re.findall(rb"-?[0-9]+", data.partition(b"\n")[2])))
    (tmp_path / ANALYSIS_FILE.name).write_bytes(values.tobytes())
    binary_audio, _ = render_adsyn(tmp_path)
    np.testing.assert_allclose(binary_audio, text_audio, atol=1e-6)
