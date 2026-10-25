"""Audio contracts from frozen Trance Gate fixtures and an analytic phase oracle."""

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.granular_capture_audio import render_capture

SR = 48000
LEVEL = .125


def render(events=(), *, seconds=2, values=None, mode="midi", ksmps=32,
           output="envelope", source=None, fixture="trance_gate"):
    patch = load_patch_fixture(fixture)
    if output != "envelope":
        target, port = (("tg_lfo", "apan" if output == "pan" else "agate")
                        if output in {"gate", "pan"} else ("tg_target_audio", "aout"))
        for connection in patch.graph.connections:
            if connection.to_node_id.startswith("tg_gain_") and connection.to_port_id == "b":
                connection.from_node_id, connection.from_port_id = target, port
            if output == "command" and connection.to_node_id == "tg_target_audio":
                connection.from_node_id = "tg_lfo_cc"
            if connection.to_node_id.startswith("tg_out_"):
                connection.from_node_id = connection.to_node_id.replace("tg_out_", "tg_gain_")
        if output == "command":
            next(n for n in patch.graph.nodes if n.id == "tg_lfo_cc").params["kmax"] = 1
    source = np.full((round(seconds * SR), 2), LEVEL) if source is None else source
    return render_capture(patch, source, events, values=values, mode=mode, ksmps=ksmps)


def analytic_gate(commands, start, end, duration, threshold, *, with_pan=False):
    """Integrate each linear-frequency segment analytically, not sample by sample."""
    gate = np.zeros(len(commands))
    pan = np.full(len(commands), .5)
    held_pan = .5
    boundaries = np.r_[0, np.flatnonzero(np.diff(commands)) + 1, len(commands)]
    on, travel, phase = False, 0., 0.
    duration = round(duration * SR) / SR
    for first, last in zip(boundaries[:-1], boundaries[1:]):
        command = commands[first]
        requested = True if command == 127 else False if command == 0 else on
        if requested and not on:
            travel, phase = 0., 0.
        on = requested
        elapsed = np.arange(last - first) / SR
        segment_duration = (last - first) / SR
        ramp_time = duration - travel if on else travel
        if not on and start == end:
            ramp_time = 0
        direction = 1 if on else -1
        initial_frequency = start + (end - start) * travel / duration
        slope = direction * (end - start) / duration

        def cycles(t):
            ramp = np.minimum(t, ramp_time)
            endpoint = end if on else start
            return initial_frequency * ramp + .5 * slope * ramp ** 2 + endpoint * np.maximum(0, t - ramp_time)

        active = np.ones(len(elapsed), dtype=bool) if on else elapsed < ramp_time - 1e-10
        triangle = 1 - np.abs(2 * ((phase + cycles(elapsed)) % 1) - 1)
        # Exact threshold equality stays closed despite floating-point phase error.
        gate[first:last] = active & (triangle > threshold + 1e-10)
        if np.any(active):
            held_pan = triangle[active][-1]
        pan[first:last] = np.where(active, triangle, held_pan)
        phase = (phase + cycles(segment_duration if on else min(segment_duration, ramp_time))) % 1
        travel = min(duration, travel + segment_duration) if on else max(0, travel - segment_duration)
    return (gate, pan) if with_pan else gate


@pytest.mark.parametrize("mode,ksmps", [("midi", 1), ("midi", 32), ("midi", 64), ("score", 1), ("score", 32)])
@pytest.mark.parametrize("start,end", [(2, 19), (19, 2), (7, 7)])
def test_sweep_hold_return_and_retrigger_follow_analytic_phase(mode, ksmps, start, end):
    events = [(0, 16, 29, 127), (.128, 16, 29, 127), (.256, 16, 29, 64),
              (.768, 16, 29, 0), (.896, 16, 29, 127), (1.024, 16, 29, 0),
              (1.408, 16, 29, 127), (1.6, 16, 29, 0)]
    values = dict(tg_lfo_start=start, tg_lfo_end=end, tg_lfo_time=.512, tg_lfo_threshold=.37)
    options = dict(values=values, mode=mode, ksmps=ksmps)
    # Read actual CC delivery independently: the host quantizes events to its blocks.
    commands = np.rint(render(events, output="command", **options)[:, 0] / LEVEL * 127)
    expected = analytic_gate(commands, start, end, .512, .37)
    actual = render(events, output="gate", **options)[:, 0] / LEVEL
    np.testing.assert_array_equal(np.unique(actual), [0, 1])
    # Accumulated floating-point phase can move an exact threshold crossing by
    # one sample compared with the analytic integral, but never a whole block.
    np.testing.assert_allclose(np.flatnonzero(np.diff(actual)), np.flatnonzero(np.diff(expected)),
                               atol=1, rtol=0)
    assert np.any(actual[:SR]) and not np.any(actual[int(1.9 * SR):])


@pytest.mark.parametrize("mode,ksmps", [("midi", 1), ("midi", 32), ("midi", 64), ("score", 1), ("score", 32)])
def test_cc24_only_is_sample_identical_to_original(mode, ksmps):
    events = [(.128, 16, 24, 127), (.256, 16, 24, 32), (.384, 16, 24, 64),
              (.512, 16, 24, 0), (.524, 16, 24, 127), (.528, 16, 24, 0)]
    for values in ({}, dict(tg_attack=1, tg_release=1), dict(tg_attack=500, tg_release=1000)):
        options = dict(mode=mode, ksmps=ksmps, values=values)
        np.testing.assert_array_equal(render(events, **options),
                                      render(events, fixture="trance_gate_original", **options))


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_switch_latching_channel_isolation_and_threshold_endpoints(mode):
    events = [(.128, 16, 29, 127), (.768, 16, 29, 0)]
    base = render(events, mode=mode, output="gate")
    extras = sorted(events + [(.256, 16, 29, 127), (.384, 16, 29, 1),
                              (.512, 16, 29, 126), (.896, 16, 29, 64)])
    np.testing.assert_array_equal(base, render(extras, mode=mode, output="gate"))
    np.testing.assert_array_equal(render([(t, 15, cc, v) for t, _, cc, v in events], mode=mode), 0)
    np.testing.assert_array_equal(render([(0, 16, 29, 64)], mode=mode), 0)
    np.testing.assert_array_equal(render(events, mode=mode, values={"tg_lfo_threshold": 1}), 0)
    assert np.max(render(events, mode=mode, values={"tg_lfo_threshold": 0})) > .124
    np.testing.assert_array_equal(render(mode=mode), 0)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_shared_envelope_matches_exponential_oracle_and_stereo_is_linked(mode):
    events = [(0, 16, 29, 127), (.256, 16, 24, 64), (.512, 16, 29, 0),
              (.896, 16, 24, 127), (1.28, 16, 24, 0)]
    values = dict(tg_lfo_time=.25, tg_attack=3, tg_release=7)
    options = dict(mode=mode, ksmps=1, values=values)
    lfo = render(events, output="gate", **options)[:, 0] / LEVEL
    manual = render(events, output="manual", **options)[:, 0] / LEVEL
    target = np.maximum(lfo, manual)
    expected = np.empty(len(target))
    gain = 0.
    boundaries = np.r_[0, np.flatnonzero(np.diff(target)) + 1, len(target)]
    for first, last in zip(boundaries[:-1], boundaries[1:]):
        value = target[first]
        half_time = .003 if value > gain else .007
        expected[first:last] = value + (gain - value) * 2 ** (-np.arange(1, last-first+1) / (SR * half_time))
        gain = expected[last-1]
    actual = render(events, **options)
    np.testing.assert_allclose(actual[:, 0], LEVEL * expected, atol=2e-12)
    np.testing.assert_array_equal(actual[:, 0], actual[:, 1])
    x = np.column_stack([np.full(len(target), LEVEL), np.zeros(len(target))])
    isolated = render(events, source=x, **options)
    np.testing.assert_array_equal(isolated[:, 1], 0)
    np.testing.assert_array_equal(isolated[:, 0], actual[:, 0])
    assert actual[-1, 0] < 1e-12


@pytest.mark.parametrize("start,end,duration,threshold", [
    (.1, 40, .01, 0), (40, .1, .01, .999), (.1, 40, 60, .5), (40, .1, 60, 1),
])
def test_parameter_extremes_have_bounded_finite_output(start, end, duration, threshold):
    values = dict(tg_lfo_start=start, tg_lfo_end=end, tg_lfo_time=duration,
                  tg_lfo_threshold=threshold)
    events = [(.128, 16, 29, 127), (.768, 16, 29, 0)]
    output = render(events, values=values)
    assert np.isfinite(output).all()
    assert np.max(abs(output)) <= LEVEL
    assert np.max(abs(output[-100:])) < 1e-12
    np.testing.assert_array_equal(render(events, values=values, source=np.zeros_like(output)), 0)


@pytest.mark.parametrize("mode", ["midi", "score"])
def test_instances_share_commands_but_have_independent_phase_and_settings(mode):
    from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
    from backend.app.services.compiler_common import PatchInstrumentTarget
    from backend.app.services.compiler_service import CompilerService
    from backend.app.services.opcode_service import OpcodeService
    from backend.tools.stereo_delay_audio import probe_source, render_probe

    patch = load_patch_fixture("trance_gate")
    settings = [{"tg_lfo_start": 3, "tg_lfo_end": 9, "tg_lfo_time": .25},
                {"tg_lfo_start": 13, "tg_lfo_end": 5, "tg_lfo_time": .5}]
    targets = [PatchInstrumentTarget(probe_source(1), 0, assignment_id="source", always_on=True)]
    routes = []
    for index, side in enumerate(("left", "right")):
        identity = f"gate{index}"
        targets.append(PatchInstrumentTarget(patch, 0, assignment_id=identity, always_on=True,
                                             performance_controller_values=settings[index]))
        routes.extend([
            AudioRoute(id=f"in{index}", sourceId="source", sourcePort="left", sourceStage="raw",
                       targetId=identity, targetPort="left"),
            AudioRoute(id=f"out{index}", sourceId=identity, sourcePort="left",
                       targetId="$master", targetPort=side),
        ])
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode=mode,
        audio_graph=AudioGraph(routes=routes, masterId="$master"), mixer=MixerState())
    # Initial shared command predates both effect instances; no instance may reset it.
    if mode == "midi":
        artifact.orc = artifact.orc.replace("massign 0, 0", "massign 0, 0\ninstr 9998\ninitc7 16, 29, (126.5 / 127)\nendin\nalwayson 9998")
    else:
        artifact.orc = artifact.orc.replace("gk_vcs_score_cc[] init 2048",
                                            "gk_vcs_score_cc[] init 2048\ngk_vcs_score_cc[1949] init 127")
    x = np.full((SR, 2), LEVEL)
    actual = render_probe(artifact, x, 1)
    commands = render([(0, 16, 29, 127)], seconds=1, mode=mode, ksmps=1, output="command")
    # SCORE's time-zero setter performs after initialization; seeded state is
    # already present at sample zero, so align to the observed command delivery.
    delay = np.flatnonzero(commands[:, 0])[0]
    for index, values in enumerate(settings):
        expected = render([(0, 16, 29, 127)], seconds=1, mode=mode, ksmps=1, values=values)
        np.testing.assert_allclose(actual[:SR-delay, index], expected[delay:, 0], atol=1e-12)
    assert not np.array_equal(actual[:, 0], actual[:, 1])


@pytest.mark.parametrize('mode,ksmps', [('midi', 1), ('midi', 32), ('score', 1), ('score', 32)])
def test_stereo_zero_preserves_previous_lfo_and_manual_audio(mode, ksmps):
    events = [(0, 16, 29, 127), (.256, 16, 24, 64), (.512, 16, 29, 0),
              (.768, 16, 29, 127), (1.024, 16, 29, 0), (1.28, 16, 24, 0)]
    options = dict(mode=mode, ksmps=ksmps, values={'tg_lfo_time': .25})
    np.testing.assert_array_equal(render(events, **options),
                                  render(events, fixture='trance_gate_lfo_original', **options))


@pytest.mark.parametrize('mode,ksmps', [('midi', 1), ('midi', 32), ('score', 1), ('score', 32)])
@pytest.mark.parametrize('start,end', [(2, 19), (19, 2), (7, 7)])
def test_lfo_pan_follows_current_triangle_through_return_and_retrigger(mode, ksmps, start, end):
    events = [(0, 16, 29, 127), (.128, 16, 29, 127), (.256, 16, 29, 64),
              (.768, 16, 29, 0), (.896, 16, 29, 127), (1.024, 16, 29, 0)]
    values = dict(tg_lfo_start=start, tg_lfo_end=end, tg_lfo_time=.512)
    options = dict(mode=mode, ksmps=ksmps, values=values)
    commands = np.rint(render(events, output='command', **options)[:, 0] / LEVEL * 127)
    _, expected = analytic_gate(commands, start, end, .512, .5, with_pan=True)
    pan = render(events, output='pan', **options)[:, 0] / LEVEL
    np.testing.assert_allclose(pan, expected, atol=2e-10)
    envelope = render(events, **options)[:, 0]
    for depth in (.5, 1):
        actual = render(events, mode=mode, ksmps=ksmps, values={**values, 'tg_stereo': depth})
        np.testing.assert_allclose(actual[:, 0], envelope * (1 - depth * expected), atol=3e-11)
        np.testing.assert_allclose(actual[:, 1], envelope * (1 - depth * (1 - expected)), atol=3e-11)
        assert np.max(abs(actual[-100:])) < 1e-12


@pytest.mark.parametrize('mode,ksmps', [('midi', 1), ('midi', 32), ('score', 1), ('score', 32)])
def test_manual_pan_samples_only_new_openings_and_holds_through_release(mode, ksmps):
    events = [(0, 16, 24, 127), (.128, 16, 24, 127), (.256, 16, 24, 64),
              (.384, 16, 24, 0), (.512, 16, 24, 1), (.640, 16, 24, 0),
              (.768, 16, 24, 127), (.896, 16, 24, 0)]
    pan = render(events, mode=mode, ksmps=ksmps, output='pan')[:, 0] / LEVEL
    manual = render(events, mode=mode, ksmps=ksmps, output='manual')[:, 0]
    openings = np.flatnonzero((manual > 0) & np.r_[True, manual[:-1] == 0])
    assert len(openings) == 3
    assert np.all((pan >= 0) & (pan <= 1))
    assert len(np.unique(pan[openings])) == len(openings)
    for first, last in zip(openings, np.r_[openings[1:], len(pan)]):
        np.testing.assert_array_equal(pan[first:last], pan[first])
    actual = render(events, mode=mode, ksmps=ksmps, values={'tg_stereo': 1})
    # The sum removes the random position, independent of the particular noise draw.
    envelope = render(events, mode=mode, ksmps=ksmps)[:, 0]
    np.testing.assert_allclose(actual.sum(axis=1), envelope, atol=1e-12)
    assert np.max(abs(actual[-100:])) < 1e-12


@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_lfo_pan_has_priority_over_manual_and_releases_to_held_random_position(mode):
    # With equal endpoints, off stops immediately; the manual gate remains open.
    events = [(0, 16, 24, 127), (.128, 16, 29, 127), (.512, 16, 29, 0)]
    values = dict(tg_lfo_start=2, tg_lfo_end=2)
    options = dict(mode=mode, ksmps=1, values=values)
    pan = render(events, output='pan', **options)[:, 0] / LEVEL
    lfo_only = render(events[1:], output='pan', **options)[:, 0] / LEVEL
    commands = render(events[1:], output='command', **options)[:, 0]
    active = commands > 0
    np.testing.assert_array_equal(pan[active], lfo_only[active])
    np.testing.assert_array_equal(pan[int(.6 * SR):], pan[int(.1 * SR)])
    wrong_channel = [(t, 15, cc, value) for t, _, cc, value in events]
    np.testing.assert_array_equal(render(wrong_channel, output='pan', **options), LEVEL * .5)
    np.testing.assert_array_equal(render(wrong_channel, values={'tg_stereo': 1}, mode=mode), 0)


@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_stereo_balance_keeps_channels_separate_and_reaches_both_sides(mode):
    events = [(0, 16, 29, 127), (.768, 16, 29, 0)]
    values = dict(tg_stereo=1, tg_lfo_start=2, tg_lfo_end=2, tg_lfo_threshold=0)
    actual = render(events, values=values, mode=mode, ksmps=1)
    for index in (0, 1):
        source = np.zeros_like(actual)
        source[:, index] = LEVEL
        isolated = render(events, source=source, values=values, mode=mode, ksmps=1)
        np.testing.assert_array_equal(isolated[:, 1-index], 0)
        np.testing.assert_array_equal(isolated[:, index], actual[:, index])
        assert isolated[:, index].max() > .12
        assert np.isfinite(isolated).all()
