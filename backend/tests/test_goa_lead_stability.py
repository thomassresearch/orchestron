"""Statevar pole stability and native sound preservation for the guarded lead."""

import numpy as np
import pytest

from backend.app.services.compiler_formula import render_formula_expression
from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.goa_lead_audio import CUTOFF_ID, Q_ID, SAVED_VALUES, render

FILTERS = ("f7a78046-4533-4b1b-b6e6-9e93bfaefe68", "c6aada3f-f49d-409f-8055-730cbf5f17ab")


def evaluate(config, **values):
    expression = render_formula_expression(config["expression"], {key: key for key in values}, "stability probe")
    return eval(expression, {"__builtins__": {}, "abs": np.abs}, values)


def test_saved_formulas_keep_poles_strictly_inside_unit_circle_over_full_midi_range():
    patch = load_patch_fixture("goa_trance_fm_lead_guarded")
    formulas = patch.graph.ui_layout["input_formulas"]
    # Exercise every MIDI pitch, both Q endpoints, sample-rate limits, cutoff
    # extremes, and the asymmetric velocity mapping. The oracle uses sin(),
    # independently of the polynomial stored in the graph.
    notes, q, multiplier, velocity, sr = np.meshgrid(
        np.arange(128), [.1, .5, 1, 5], [.1, .5, 5.0395263882509385, 10],
        [1, 64, 100, 127], [22000, 44100, 48000], indexing="ij",
    )
    ceiling = evaluate(formulas["07817312-2bf6-4a88-8465-db474d02b0fe::xmax"], in1=18000, sr=sr)
    cutoff = np.clip(440 * 2 ** ((notes - 69) / 12) * multiplier, 10, ceiling)
    for index, filter_id in enumerate(FILTERS):
        effective_cutoff = cutoff * (.1 + .9 * velocity / 128) if index == 0 else cutoff
        inputs = dict(in1=cutoff, sr=sr)
        if index == 0:
            inputs["in2"] = velocity / 128
        coefficient = evaluate(formulas[f"goa_stability_coefficient_{index}::xin"], **inputs)
        effective_q = evaluate(formulas[f"{filter_id}::xq"], in1=q, in2=coefficient)
        f = 2 * np.sin(np.pi * effective_cutoff / (3 * sr))
        # Alternating Taylor remainder is positive and very small. Permit only
        # floating roundoff below the true sine coefficient.
        assert np.min(coefficient - f) > -1e-15
        assert np.max(coefficient - f) < 1.3e-11
        damping = np.maximum(1 / effective_q, (2 - f) * .05 / 3)
        assert np.all(damping > f)
        assert np.all(damping < 2 / f + f / 2)
        trace = 2 - damping * f
        determinant = 1 - damping * f + f * f
        root = np.lib.scimath.sqrt(trace * trace - 4 * determinant)
        radius = np.maximum(np.abs((trace + root) / 2), np.abs((trace - root) / 2))
        assert np.max(radius) < 1
        untouched = (q >= 2 * coefficient / (.98 * (4 + coefficient ** 2))) & (q <= .98 / coefficient)
        np.testing.assert_allclose(effective_q[untouched], q[untouched], rtol=1e-11, atol=1e-11)


@pytest.mark.parametrize("note", [60, 81])
@pytest.mark.parametrize("velocity", [1, 100, 127])
def test_stable_original_sound_is_preserved(note, velocity):
    notes = [(0, .3, note, velocity)]
    original = render(load_patch_fixture("goa_trance_fm_lead_crossfm_original"), notes, values=SAVED_VALUES)
    guarded = render(load_patch_fixture("goa_trance_fm_lead_guarded"), notes, values=SAVED_VALUES)
    np.testing.assert_allclose(guarded, original, rtol=1e-8, atol=1e-8)


def test_reproduces_asharp5_runaway_and_stops_it():
    notes = [(0, .3, 82, 100)]
    original = render(load_patch_fixture("goa_trance_fm_lead_crossfm_original"), notes, values=SAVED_VALUES)
    guarded = render(load_patch_fixture("goa_trance_fm_lead_guarded"), notes, values=SAVED_VALUES)
    assert np.max(np.abs(original[:, 1])) > 1e9
    assert np.isfinite(guarded).all()
    assert .01 < np.max(np.abs(guarded)) < 4


@pytest.mark.parametrize("sr,ksmps,mode", [(48000, 32, "midi"), (22000, 32, "midi"), (48000, 1, "score")])
@pytest.mark.parametrize("q,multiplier", [(.1, 10), (.5, .5), (5, .1), (5, 5.0395263882509385), (5, 10)])
def test_controller_corners_retriggers_chords_and_release_are_bounded(sr, ksmps, mode, q, multiplier):
    notes = [(0, .25, 82, 100), (.1, .25, 96, 1), (.35, .2, 82, 127),
             (.6, .4, 120, 127), (.6, .4, 124, 127), (.6, .4, 127, 127)]
    audio = render(load_patch_fixture("goa_trance_fm_lead_guarded"), notes,
                   values={**SAVED_VALUES, Q_ID: q, CUTOFF_ID: multiplier}, sr=sr, ksmps=ksmps, mode=mode)
    assert np.isfinite(audio).all()
    assert np.max(np.abs(audio)) < 100  # raw resonance gain is deliberately retained
    assert np.max(np.abs(audio), axis=0).min() > 1e-4
    assert np.max(np.abs(audio[-sr // 10:])) < 1e-8
