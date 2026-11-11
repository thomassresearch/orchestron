"""DSP checks against the independent Stereo Auto Wah Wah fixture."""

import numpy as np
import pytest

from backend.app.models.patch import Connection, NodeInstance
from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.granular_capture_audio import render_capture

SR = 48000


def source(seconds=.6):
    t = np.arange(round(seconds * SR)) / SR
    return np.column_stack([
        .12 * np.sin(2 * np.pi * 330 * t) + .04 * np.sin(2 * np.pi * 3300 * t),
        .06 * np.sin(2 * np.pi * 550 * t) + .03 * np.sin(2 * np.pi * 5500 * t),
    ])


def render(audio, *, stage=None, **kwargs):
    patch = load_patch_fixture("stereo_auto_wah_wah")
    if stage:
        # Observe internal control values without approximating the DSP in Python.
        for side in ("left", "right"):
            probe = f"probe_{side}"
            if stage == "cutoff":
                patch.graph.nodes.append(NodeInstance(id=probe, opcode="limit", params=dict(xmin=-1e9, xmax=1e9)))
                formula = patch.graph.ui_layout["input_formulas"][f"saw_filter_{side}::xfco"]
                patch.graph.ui_layout["input_formulas"][f"{probe}::xin"] = formula
                patch.graph.connections.extend([
                    Connection(from_node_id=b["from_node_id"], from_port_id=b["from_port_id"],
                               to_node_id=probe, to_port_id="xin") for b in formula["inputs"]])
                port = "xout"
            else:
                patch.graph.nodes.append(NodeInstance(id=probe, opcode="upsamp"))
                patch.graph.connections.append(Connection(from_node_id=f"saw_{stage}_{side}",
                    from_port_id="kout", to_node_id=probe, to_port_id="ksig"))
                port = "aout"
            for connection in patch.graph.connections:
                if connection.to_node_id == f"saw_out_{side}":
                    connection.from_node_id, connection.from_port_id = probe, port
    return render_capture(patch, audio, **kwargs)


@pytest.mark.parametrize("mode", ["midi", "score"])
@pytest.mark.parametrize("ksmps", [1, 32, 64])
def test_stereo_link_and_phase_independence(mode, ksmps):
    x = source()
    linked = render(x, stage="smooth", mode=mode, ksmps=ksmps)
    np.testing.assert_array_equal(linked[:, 0], linked[:, 1])
    inverted = x.copy()
    inverted[:, 1] *= -1
    np.testing.assert_array_equal(render(inverted, stage="smooth", mode=mode, ksmps=ksmps), linked)
    own = render(x, stage="smooth", mode=mode, ksmps=ksmps, values={"saw_link": 0})
    assert np.mean(own[-4800:, 0]) > np.mean(own[-4800:, 1]) + 8
    opposite = np.column_stack([x[:, 0], -x[:, 0]])
    y = render(opposite, mode=mode, ksmps=ksmps)
    np.testing.assert_allclose(y[:, 0], -y[:, 1], atol=1e-12)
    x[:, 1] = 0
    for link in (0, 1):
        y = render(x, mode=mode, ksmps=ksmps, values={"saw_link": link})
        assert np.max(abs(y[:, 0])) > .01
        np.testing.assert_array_equal(y[:, 1], 0)


@pytest.mark.parametrize("mode,ksmps", [("midi", 1), ("score", 32), ("midi", 64)])
@pytest.mark.parametrize("step", [0, 1, 7, 12, 24])
def test_quantization_targets_and_continuous_bypass(mode, ksmps, step):
    # Slowly rising level crosses multiple thresholds, then returns to silence.
    x = np.repeat(np.linspace(0, .14, SR)[:, None], 2, axis=1)
    values = {"saw_quantization": step, "saw_integration": 1}
    raw = render(x, stage="offset", values=values, mode=mode, ksmps=ksmps)
    target = render(x, stage="quantized", values=values, mode=mode, ksmps=ksmps)
    if step == 0:
        np.testing.assert_array_equal(target, raw)
    else:
        np.testing.assert_allclose(target / step, np.round(target / step), atol=1e-12)
        assert len(np.unique(target)) >= (3 if step == 24 else 5)
        assert np.max(abs(target - raw)) <= step / 2 + 1e-10
    cutoff = render(x, stage="cutoff", values=values, mode=mode, ksmps=ksmps)
    assert cutoff.min() >= 200 - 1e-10
    assert cutoff.max() <= 3200 + 1e-8


def test_linked_energy_and_sensitivity():
    x = np.tile([.06, .08], (SR, 1))
    values = {"saw_integration": 1, "saw_sensitivity": 2}
    envelope = render(x, stage="envelope", values=values)
    np.testing.assert_allclose(envelope[-1000:], 2 * np.sqrt((.06 ** 2 + .08 ** 2) / 2), atol=1e-9)
    own = render(x, stage="envelope", values={**values, "saw_link": 0})
    np.testing.assert_allclose(own[-1000:], np.tile([.12, .16], (1000, 1)), atol=1e-9)
    louder = render(2 * x, stage="offset", values=values)
    normal = render(x, stage="offset", values=values)
    np.testing.assert_allclose(louder[-1000:], 2 * normal[-1000:], atol=1e-8)


def test_integration_and_transition_are_separate():
    x = np.zeros((SR, 2))
    x[SR // 5:3 * SR // 5] = .125
    fast = render(x, stage="offset", values={"saw_integration": 1})
    slow = render(x, stage="offset", values={"saw_integration": 300})
    assert fast[SR // 4, 0] > slow[SR // 4, 0] + 10
    assert slow[4 * SR // 5, 0] > fast[4 * SR // 5, 0] + 10
    values = dict(saw_integration=1, saw_quantization=12)
    np.testing.assert_array_equal(
        render(x, stage="offset", values={**values, "saw_transition": 1}),
        render(x, stage="offset", values={**values, "saw_transition": 100}))
    quick = render(x, stage="smooth", values={**values, "saw_transition": 1})
    gradual = render(x, stage="smooth", values={**values, "saw_transition": 100})
    assert quick[SR // 4, 0] > gradual[SR // 4, 0] + 15
    # Audio-rate interpolation removes the remaining control-block stairs.
    cutoff = render(x, stage="cutoff", values={**values, "saw_transition": 5}, ksmps=64)
    assert np.max(abs(np.diff(np.log2(cutoff[:, 0])))) < .03


@pytest.mark.parametrize("mode,ksmps", [("midi", 1), ("score", 1), ("midi", 32), ("score", 64)])
def test_extremes_silence_and_cutoff_bounds(mode, ksmps):
    x = source(.3)
    patch = load_patch_fixture("stereo_auto_wah_wah")
    settings = [{}, dict(saw_base=2000, saw_range=6, saw_sensitivity=32, saw_resonance=.95)]
    settings += [{node.id: node.params[end]} for node in patch.graph.nodes if node.opcode == "perf_controller"
                 for end in ("min", "max")]
    for values in settings:
        y = render(x, values=values, mode=mode, ksmps=ksmps)
        assert np.isfinite(y).all()
        assert abs(y).max() < 2
        np.testing.assert_array_equal(render(np.zeros_like(x), values=values, mode=mode, ksmps=ksmps), 0)
    cutoff = render(np.ones_like(x), stage="cutoff", values=settings[1], mode=mode, ksmps=ksmps)
    assert cutoff.min() >= 20 and cutoff.max() <= 18000 + 1e-8
    np.testing.assert_allclose(cutoff[-1000:], 18000, atol=1e-8)
    default = render(x, mode=mode, ksmps=ksmps)
    assert np.max(abs(default)) < 1


def test_zero_sweep_matches_literal_filters_and_seven_semitone_top_is_bounded():
    x = source()
    patch = load_patch_fixture("stereo_auto_wah_wah")
    for node in patch.graph.nodes:
        if node.opcode == "moogvcf":
            node.params["xfco"] = 200
            del patch.graph.ui_layout["input_formulas"][f"{node.id}::xfco"]
    patch.graph.connections = [c for c in patch.graph.connections if c.to_port_id != "xfco"]
    expected = render_capture(patch, x)
    np.testing.assert_allclose(render(x, values={"saw_range": 0}), expected, atol=1e-12)
    cutoff = render(np.full_like(x, .2), stage="cutoff", values={"saw_quantization": 7})
    # Csound 6.18 ampdb's conversion constant differs from exact exp by ~1e-7.
    np.testing.assert_allclose(cutoff[-1000:], 3200, rtol=2e-7, atol=1e-8)
