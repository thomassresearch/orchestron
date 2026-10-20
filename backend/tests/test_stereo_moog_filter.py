"""Audio regressions from an independent Stereo Moog Filter fixture."""

import numpy as np
import pytest

from backend.app.models.patch import PatchDocument
from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.granular_capture_audio import render_capture as render_cc

SR = 48000


def source(seconds=0.5):
    t = np.arange(round(seconds * SR)) / SR
    return np.column_stack([
        .08 * np.sin(2 * np.pi * 440 * t) + .03 * np.sin(2 * np.pi * 4000 * t),
        .06 * np.sin(2 * np.pi * 700 * t) + .02 * np.sin(2 * np.pi * 6000 * t),
    ])


def render(audio, events=(), **kwargs):
    return render_cc(load_patch_fixture("stereo_moog_filter"), audio, events, **kwargs)


def fixed_filter(audio, cutoff, resonance, **kwargs):
    """Reference native filters with literal parameters, no controller graph."""
    patch = load_patch_fixture("stereo_moog_filter")
    patch.graph.nodes = [n for n in patch.graph.nodes if n.opcode in {"inleta", "outleta", "moogvcf"}]
    ids = {n.id for n in patch.graph.nodes}
    patch.graph.connections = [c for c in patch.graph.connections
                               if c.from_node_id in ids and c.to_node_id in ids]
    patch.graph.ui_layout["input_formulas"] = {}
    for node in patch.graph.nodes:
        if node.opcode == "moogvcf":
            node.params.update(xfco=cutoff, xres=resonance)
    return render_cc(patch, audio, **kwargs)


@pytest.mark.parametrize("mode,ksmps", [("midi", 1), ("score", 1), ("midi", 32), ("score", 32), ("midi", 64)])
def test_startup_is_full_scale_without_midi_and_stereo_is_linked(mode, ksmps):
    x = source()
    expected = fixed_filter(x, 1000, .3, mode=mode, ksmps=ksmps)
    np.testing.assert_allclose(render(x, mode=mode, ksmps=ksmps), expected, atol=1e-12)
    x[:, 1] = x[:, 0]
    linked = render(x, [(.1, 16, 20, 64), (.2, 16, 21, 100)], mode=mode, ksmps=ksmps)
    np.testing.assert_array_equal(linked[:, 0], linked[:, 1])
    x[:, 1] = 0
    np.testing.assert_array_equal(render(x, mode=mode, ksmps=ksmps)[:, 1], 0)


@pytest.mark.parametrize("mode", ["midi", "score"])
@pytest.mark.parametrize("cc,value", [(20, 0), (20, 64), (20, 127), (21, 0), (21, 64), (21, 127)])
def test_cc_scaling_matches_fixed_filter_and_later_events_replace_initialization(mode, cc, value):
    x = source(.8)
    cutoff = 4000 * (value / 127 if cc == 20 else 1)
    resonance = .3 * (value / 127 if cc == 21 else 1)
    actual = render(x, [(.1, 16, cc, value)], mode=mode,
                    values={"smf_cutoff": 4000, "smf_resonance": .3})
    expected = fixed_filter(x, cutoff, resonance, mode=mode)
    if cutoff == 0:
        # At zero cutoff the ladder's existing state still decays nonlinearly,
        # but new input cannot enter it. This is not an output mute.
        changed = x.copy()
        changed[SR // 5:] = 0
        without_input = render(changed, [(.1, 16, cc, value)], mode=mode,
                               values={"smf_cutoff": 4000, "smf_resonance": .3})
        np.testing.assert_array_equal(actual[SR // 5:], without_input[SR // 5:])
    else:
        np.testing.assert_allclose(actual[SR // 2:], expected[SR // 2:], atol=1e-9)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_zero_cutoff_recovers_and_channel_selection_is_respected(mode):
    x = source(1)
    events = [(.1, 16, 20, 0), (.35, 16, 21, 0), (.5, 16, 20, 127)]
    actual = render(x, events, mode=mode)
    assert np.isfinite(actual).all()
    expected = fixed_filter(x, 1000, 0, mode=mode)
    np.testing.assert_allclose(actual[int(.8 * SR):], expected[int(.8 * SR):], atol=1e-10)
    remapped = [(t, 3, cc, v) for t, _, cc, v in events]
    np.testing.assert_array_equal(render(x, remapped, mode=mode, values={"smf_channel": 2.8}), actual)
    np.testing.assert_array_equal(render(x, remapped, mode=mode), render(x, mode=mode))


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_time_zero_controller_events_override_startup(mode):
    x = source()
    actual = render(x, [(0, 16, 20, 64), (0, 16, 21, 0)], mode=mode, ksmps=1)
    expected = fixed_filter(x, 1000 * 64 / 127, 0, mode=mode, ksmps=1)
    np.testing.assert_allclose(actual[SR // 5:], expected[SR // 5:], atol=1e-10)


@pytest.mark.parametrize("mode,ksmps", [("midi", 32), ("midi", 64), ("midi", 1), ("score", 1)])
def test_parameter_endpoints_and_silence_are_finite(mode, ksmps):
    x = source(.3)
    for cutoff in (20, 1000, 20000):
        for resonance in (0, .3, 1):
            values = dict(smf_cutoff=cutoff, smf_resonance=resonance)
            actual = render(x, mode=mode, ksmps=ksmps, values=values)
            assert np.isfinite(actual).all()
            assert np.max(abs(actual)) < 2
    np.testing.assert_array_equal(render(np.zeros_like(x), mode=mode, ksmps=ksmps), 0)


def test_lowpass_and_resonance_frequency_response():
    t = np.arange(SR) / SR
    x = np.column_stack([.01 * np.sin(2 * np.pi * 250 * t), .01 * np.sin(2 * np.pi * 8000 * t)])
    low = render(x, values={"smf_cutoff": 1000, "smf_resonance": 0})
    rms = np.sqrt(np.mean(low[SR // 2:] ** 2, axis=0))
    assert rms[0] > .005
    assert rms[1] < rms[0] / 100
    x[:] = (.01 * np.sin(2 * np.pi * 1000 * t))[:, None]
    plain = render(x, values={"smf_cutoff": 1000, "smf_resonance": 0})
    resonant = render(x, values={"smf_cutoff": 1000, "smf_resonance": .8})
    assert np.sqrt(np.mean(resonant[SR // 2:] ** 2)) > 2 * np.sqrt(np.mean(plain[SR // 2:] ** 2))


def init_probe(value):
    """Expose raw CC state, independently of the filter's endpoint clamping."""
    return PatchDocument.model_validate(dict(
        id="init-probe", name="init probe", instrument_type="continuous",
        graph=dict(nodes=[
            *[dict(id="in_" + side, opcode="inleta", params=dict(sname=side))
              for side in ("left", "right")],
            dict(id="initializer", opcode="initc7", params=dict(ichan=16, ictlno=20, ivalue=value)),
            dict(id="reader", opcode="ctrl7", params=dict(ichan=16, ictlno=20, kmin=0, kmax=127)),
            dict(id="audio", opcode="upsamp"),
            *[dict(id=side, opcode="outleta", params=dict(sname=side)) for side in ("left", "right")],
        ], connections=[
            dict(from_node_id="reader", from_port_id="kout", to_node_id="audio", to_port_id="ksig"),
            *[dict(from_node_id="audio", from_port_id="aout", to_node_id=side, to_port_id="asignal")
              for side in ("left", "right")],
        ])))


@pytest.mark.parametrize("value", [0, .5, 1])
def test_initc7_score_matches_native_fractional_state_and_runs_only_once(value):
    x = np.zeros((SR // 3, 2))
    events = [(.1, 16, 20, 20), (.2, 16, 20, 80)]
    for mode in ("midi", "score"):
        actual = render_cc(init_probe(value), x, events, mode=mode, ksmps=1)
        np.testing.assert_array_equal(actual[:4000], value * 127 + .5)
        np.testing.assert_array_equal(actual[6000:9000], 20)
        np.testing.assert_array_equal(actual[11000:], 80)
