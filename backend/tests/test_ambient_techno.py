"""Native DSP contracts for independent Ambient Techno patch snapshots."""

import re

import numpy as np
import pytest

from backend.app.models.patch import NodeInstance, Connection
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, render, note_events, fundamental, rms


def patch(kind):
    return load_patch_fixture("ambient_rounded_sub" if kind == "sub" else "ambient_wavetable_cloud")


def cc(time, number, value, channel=16):
    return time, bytes([0xB0 + channel - 1, number, value])


def audition(kind, *, notes=None, events=(), values=None, seconds=3, mode="host", ksmps=32, document=None):
    document = document or patch(kind)
    artifact, targets = compile_guitars([document], mode=mode, settings=[values or {}], ksmps=ksmps)
    notes = notes if notes is not None else [(.1, 48, 100, 1)]
    audio, _ = render(artifact, targets, note_events(notes) + list(events), seconds, mode=mode)
    return audio


def control_probe(kind, key):
    """Observe the effective parameter through audio, independently of synthesis."""
    document = patch(kind)
    prefix = "ars" if kind == "sub" else "awc"
    document.graph.nodes.append(NodeInstance(id="test_probe", opcode="k_to_a"))
    document.graph.connections.append(Connection(
        from_node_id=f"{prefix}_effective_{key}", from_port_id="kout",
        to_node_id="test_probe", to_port_id="kin"))
    for side in ("left", "right"):
        document.graph.connections = [e for e in document.graph.connections if e.to_node_id != "output_" + side]
        document.graph.connections.append(Connection(
            from_node_id="test_probe", from_port_id="aout", to_node_id="output_" + side, to_port_id="asignal"))
        document.graph.ui_layout["input_formulas"].pop("output_" + side + "::asignal", None)
    return document


# Independent expected CC contract, not imported from the authoring generator.
MAPPINGS = [
    ("sub", "body", 24, .15, .5, False), ("sub", "tone", 25, 280, 4000, True),
    ("sub", "warmth", 26, .15, 1, False), ("sub", "pulse_depth", 27, 0, .35, False),
    ("sub", "pulse_rate", 28, .15, 4, True),
    ("cloud", "position", 102, .3, 1, False), ("cloud", "scan", 103, .15, .5, False),
    ("cloud", "motion", 104, .04, 2, True), ("cloud", "drift", 105, 1.5, 8, False),
    ("cloud", "detune", 106, 5, 20, False), ("cloud", "width", 107, .65, 1, False),
    ("cloud", "shimmer", 108, .1, .5, False), ("cloud", "tone", 109, 3500, 16000, True),
]


@pytest.mark.parametrize("kind,key,number,base,maximum,exponential", MAPPINGS)
def test_cc_endpoints_midpoint_smoothing_and_reset(kind, key, number, base, maximum, exponential):
    x = audition(kind, document=control_probe(kind, key), seconds=2.5,
                 notes=[(.1, 48, 100, 3)],
                 events=[cc(.4, number, 64), cc(1, number, 127), cc(1.6, number, 0)])
    expected_mid = min(maximum, base * 4 ** (64 / 127)) if exponential else base + 64 / 127 * (maximum - base)
    expected_max = min(maximum, base * 4) if exponential else maximum
    for time, expected in [(.3, base), (.95, expected_mid), (1.55, expected_max), (2.3, base)]:
        assert x[int(time * 48000), 0] == pytest.approx(expected, rel=2e-5, abs=2e-5)
    # At one half-time the *normalized CC*, before the nonlinear mapping, is half-way.
    u = .5 * 64 / 127
    half = min(maximum, base * 4 ** u) if exponential else base + u * (maximum - base)
    assert x[int(.43 * 48000), 0] == pytest.approx(half, rel=.015, abs=.005)


@pytest.mark.parametrize("mode,ksmps", [("host", 32), ("host", 64), ("midi", 1), ("score", 1)])
@pytest.mark.parametrize("kind,number,key,maximum", [("sub", 24, "body", .5), ("cloud", 108, "shimmer", .5)])
def test_cc_before_notes_retriggers_and_channel_isolation(mode, ksmps, kind, number, key, maximum):
    p = control_probe(kind, key)
    notes = [(.1, 48, 100, .4), (.6, 55, 100, .5), (.8, 60, 100, .5)]
    prefix = "ars" if kind == "sub" else "awc"
    values = {prefix + "_release": .1, prefix + "_channel": 2.8}
    events = [cc(0, number, 127, 3)] + [cc(.4, n, 127, 3) for n in range(20, 24)]
    actual = audition(kind, document=p, notes=notes, events=events, values=values,
                      seconds=1.6, mode=mode, ksmps=ksmps)
    assert actual[int(.4 * 48000), 0] == pytest.approx(maximum, rel=.002)
    assert actual[int(1.05 * 48000), 0] == pytest.approx(2 * maximum, rel=.004)
    assert abs(actual[-2400:]).max() < 1e-10
    wrong = audition(kind, document=p, notes=notes, events=[cc(0, number, 127, 16)],
                     values=values, seconds=1.6, mode=mode, ksmps=ksmps)
    base = .15 if kind == "sub" else .1
    assert wrong[int(1.05 * 48000), 0] == pytest.approx(2 * base, rel=.002)


@pytest.mark.parametrize("kind,prefix", [("sub", "ars"), ("cloud", "awc")])
def test_register_velocity_polyphony_and_release(kind, prefix):
    values = {prefix + "_attack": .05, prefix + "_release": .1}
    if kind == "cloud":
        values.update(awc_drift=0, awc_detune=0, awc_scan=0, awc_shimmer=0, awc_width=0)
    register = [24, 36, 48, 55] if kind == "sub" else [36, 48, 60, 72, 84, 96]
    for n in register:
        x = audition(kind, notes=[(.1, n, 100, .9)], values=values, seconds=1.3)
        expected = 440 * 2 ** ((n - 69) / 12)
        measured = fundamental(x[14400:43200, 0], expected)
        assert abs(1200 * np.log2(measured / expected)) < 3
        assert abs(x[-4800:]).max() < 1e-9
    levels = [rms(audition(kind, notes=[(.1, 48, v, .7)], values=values, seconds=1))
              for v in [24, 64, 127]]
    assert levels[0] < levels[1] < levels[2]
    notes = [(.1, n, 127, 2) for n in [36, 43, 48, 51, 55, 60, 63, 67]]
    chord = audition(kind, notes=notes, seconds=9)
    assert np.isfinite(chord).all() and .01 < abs(chord).max() < .501
    assert abs(chord[-4800:]).max() < 1e-9
    if kind == "sub":
        np.testing.assert_allclose(chord[:, 0], chord[:, 1], atol=1e-12)
    else:
        assert rms(chord[:, 0] - chord[:, 1]) > .001
        assert rms(chord.mean(axis=1)) > .4 * rms(chord)


@pytest.mark.parametrize("kind,prefix", [("sub", "ars"), ("cloud", "awc")])
def test_all_performance_endpoints_and_combined_cc_extremes_are_bounded(kind, prefix):
    p = patch(kind)
    for node in p.graph.nodes:
        if node.opcode != "perf_controller" or node.id.endswith("_channel"):
            continue
        for bound in ("min", "max"):
            values = {prefix + "_attack": .05, prefix + "_release": .1, node.id: node.params[bound]}
            seconds = 1.2 + values[prefix + "_release"]
            x = audition(kind, values=values, seconds=seconds, notes=[(.1, 60, 127, .8)])
            assert np.isfinite(x).all() and abs(x).max() < .5, (node.id, bound)
            assert abs(x[-2400:]).max() < 1e-9, (node.id, bound)
    values = {n.id: n.params["max"] for n in p.graph.nodes
              if n.opcode == "perf_controller" and not n.id.endswith(("_channel", "_attack", "_release"))}
    values.update({prefix + "_attack": .05, prefix + "_release": .1})
    events = [cc(0, number, 127) for k, _, number, *_ in MAPPINGS if k == kind]
    x = audition(kind, values=values, events=events, seconds=1.4,
                 notes=[(.1, n, 127, 1) for n in [24, 48, 72, 96, 108, 120, 127]])
    assert np.isfinite(x).all() and abs(x).max() < .9


def test_timbre_motion_and_stereo_have_audible_effect():
    def high_ratio(x):
        power = abs(np.fft.rfft(x[24000:72000, 0] * np.hanning(48000))) ** 2
        freq = np.fft.rfftfreq(48000, 1 / 48000)
        return power[freq > 300].sum() / power.sum()

    clean = audition("sub", values=dict(ars_body=0, ars_warmth=0, ars_tone=2000),
                     notes=[(.1, 36, 100, 2)], seconds=2.5)
    warm = audition("sub", values=dict(ars_body=.5, ars_warmth=1, ars_tone=2000),
                    notes=[(.1, 36, 100, 2)], seconds=2.5)
    assert high_ratio(warm) > high_ratio(clean) * 10
    settings = dict(awc_attack=.05, awc_scan=0, awc_drift=0, awc_detune=0, awc_shimmer=0, awc_width=0)
    dark = audition("cloud", values={**settings, "awc_position": 0}, seconds=3, notes=[(.1, 60, 100, 2)])
    bright = audition("cloud", values={**settings, "awc_position": 1}, seconds=3, notes=[(.1, 60, 100, 2)])
    assert high_ratio(bright) > high_ratio(dark) * 10
    np.testing.assert_allclose(bright[:, 0], bright[:, 1], atol=1e-12)
    moving = audition("cloud", values={**settings, "awc_scan": .5, "awc_motion": .4}, seconds=8,
                      notes=[(.1, 48, 100, 7)])
    assert rms(moving[48000:96000] - moving[240000:288000]) > .002


def test_performance_controls_refresh_on_new_notes_only():
    p = control_probe("sub", "body")
    artifact, targets = compile_guitars([p], mode="host", ksmps=32)
    channel = re.search(r'i_ars_body_iout_\d+ chnget "([^"]+)"', artifact.orc)[1]
    audio, _ = render(artifact, targets, note_events([(.1, 48, 100, 1.2), (.8, 60, 100, .4)]),
                      2, mode="host", controller_updates=[(.5, channel, .4)])
    assert audio[round(.7 * 48000), 0] == pytest.approx(.15)
    assert audio[round(1 * 48000), 0] == pytest.approx(.55)


@pytest.mark.parametrize("kind,prefix,key,number", [
    ("sub", "ars", "body", 24), ("cloud", "awc", "shimmer", 108),
])
def test_cc_remains_live_in_release_and_same_pitch_retriggers(kind, prefix, key, number):
    # The first CC change occurs after note-off, while the release is running.
    # A same-pitch retrigger and another overlapping note must keep that CC.
    audio = audition(
        kind, document=control_probe(kind, key), values={prefix + "_release": .8},
        notes=[(.1, 48, 100, .2), (.5, 48, 100, .2), (.6, 55, 100, .4)],
        events=[cc(.36, number, 127)], seconds=2.1,
    )
    base = .15 if kind == "sub" else .1
    assert audio[round(.46 * 48000), 0] > base + .8 * (.5 - base)
    assert audio[round(.85 * 48000), 0] == pytest.approx(1.5, rel=.002)
    assert abs(audio[-4800:]).max() < 1e-10
