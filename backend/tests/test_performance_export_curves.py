import math

import numpy as np
import pytest

from backend.app.models.session import SessionControllerSequencerTrackConfig
from backend.app.services.compiler_orchestra import OrchestraEmitter
from backend.app.services.performance_export_curves import (
    approximate_controller_events, curve_controller_indices,
    curve_orchestra_lines, linear_breakpoints,
)
from backend.app.services.performance_export_service import ScoreControllerEvent


def test_curve_eligibility_excludes_steps_and_competing_destinations():
    def lane(identity, cc, channels, mode="curve", enabled=True):
        return SessionControllerSequencerTrackConfig(track_id=identity, controller_number=cc,
            target_channels=channels, controller_mode=mode, enabled=enabled)
    tracks = [lane("one", 10, []), lane("two", 10, [2]), lane("steps", 11, [1], "step"),
              lane("curve", 11, [1]), lane("disabled", 12, [1], enabled=False)]
    assert curve_controller_indices(tracks, (1, 2)) == {10}


@pytest.mark.parametrize("tolerance", [1, 5, 10])
@pytest.mark.parametrize("shape", ["linear", "sine", "stairs", "random"])
def test_linear_breakpoints_bound_every_sample_and_reduce_smooth_curves(shape, tolerance):
    rng = np.random.default_rng(17)
    times = np.arange(1000) * 48
    values = {"linear": np.arange(1000) * 127 / 999,
              "sine": 64 + 60 * np.sin(np.arange(1000) / 60),
              "stairs": (np.arange(1000) // 100) * 12,
              "random": rng.integers(0, 128, 1000)}[shape].round().astype(int)
    points = [(0, int(values[0]))]
    for i in range(1, len(times)):
        points.extend([(int(times[i]) - 1, int(values[i - 1])), (int(times[i]), int(values[i]))])
    reduced = linear_breakpoints(points, tolerance)
    assert reduced[0] == points[0] and reduced[-1] == points[-1]
    actual = np.interp([t for t, _ in points], [t for t, _ in reduced], [v for _, v in reduced])
    assert np.max(np.abs(actual - [v for _, v in points])) <= tolerance + 1e-10
    if shape == "linear":
        assert len(reduced) < len(points) / 20


@pytest.mark.parametrize("tolerance", [1, 5, 10])
def test_piecewise_linseg_render_obeys_error_bound_and_keeps_resets(tolerance):
    from backend.app.engine.ctcsound_loader import load_ctcsound_module

    messages = [(0, 10, 0), (0, 10, 0), (0, 11, 40)]
    messages += [(i / 1000, 10, round(63 + 60 * math.sin(i / 100))) for i in range(1, 1000)]
    messages += [(1, 10, 127), (1.1, 10, 0), (1.2, 10, 0), (.4, 11, 100), (.8, 11, 0)]
    messages.sort(key=lambda row: row[0])
    events = [ScoreControllerEvent(t, 1, cc, value, seq) for seq, (t, cc, value) in enumerate(messages)]
    kept, curves = approximate_controller_events(events, {10}, 48000, tolerance=tolerance)
    assert curves and len(kept) + len(curves) < len(events) / 2
    for cc in (10, 11):
        assert [e for e in kept if e.controller_number == cc and (cc == 11 or e.time_seconds in {0, 1, 1.1, 1.2})] == [
            e for e in events if e.controller_number == cc and (cc == 11 or e.time_seconds in {0, 1, 1.1, 1.2})]

    def render(rows, segments):
        score = [(e.time_seconds, f"i 9000 {e.time_seconds:.6f} .000021 {e.controller_number} {e.value}") for e in rows]
        score.extend(segments)
        csd = '\n'.join(['<CsoundSynthesizer>', '<CsOptions>', '-n -d -m0', '</CsOptions>',
            '<CsInstruments>', 'sr=48000', 'ksmps=1', 'nchnls=2', '0dbfs=1',
            *OrchestraEmitter.score_controller_header_lines(), *curve_orchestra_lines(tolerance),
            'instr 2', 'a_left upsamp gk_vcs_score_cc[10]', 'a_right upsamp gk_vcs_score_cc[11]',
            'outs a_left, a_right', 'endin', '</CsInstruments>', '<CsScore>', 'i 2 0 1.3',
            *[line for _, line in sorted(score, key=lambda pair: pair[0])],
            'f 0 1.3', '</CsScore>', '</CsoundSynthesizer>'])
        cs = load_ctcsound_module().Csound()
        try:
            assert cs.compileCsdText(csd) == 0
            assert cs.start() == 0
            samples = []
            while cs.performKsmps() == 0:
                samples.append(cs.spout().copy())
            return np.array(samples)
        finally:
            cs.cleanup()
            cs.reset()
    original, compact = render(events, []), render(kept, curves)
    np.testing.assert_array_equal(compact[:, 1], original[:, 1])
    assert np.max(np.abs(compact[:, 0] - original[:, 0])) <= tolerance + 1e-8
    for time in (1, 1.1, 1.2):
        sample = round(time * 48000) + 1
        assert compact[sample, 0] == original[sample, 0]


def test_short_curves_and_jumps_keep_original_events():
    events = [ScoreControllerEvent(i / 10, 1, 10, value, i) for i, value in enumerate([0, 127, 0, 1, 0])]
    assert approximate_controller_events(events, {10}, 48000) == (events, [])
