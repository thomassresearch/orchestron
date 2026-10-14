"""Audio contracts for the expanded instrument, using frozen test fixtures only."""
import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.analog_drumkit_audio import compile_kit, render


@pytest.fixture(scope="module")
def kit():
    return load_patch_fixture("analog_drumkit_breakbeat")


@pytest.fixture(scope="module")
def compiled(kit):
    return compile_kit(kit)


@pytest.mark.parametrize("note", [35, 36, 38, 42, 46])
def test_original_voices_remain_sample_identical(compiled, note):
    legacy = compile_kit(load_patch_fixture("analog_drumkit_library_original"))
    events = [(.05, note, 40, .015), (1, note, 127, .02)]
    np.testing.assert_allclose(render(compiled, events, 2), render(legacy, events, 2), rtol=1e-12, atol=1e-12)


@pytest.mark.parametrize("note", [37, 39, 40, 41, 43, 45, 47, 48, 49, 50, 51, 54])
def test_new_voices_velocity_stereo_tail_and_headroom(compiled, note):
    soft = render(compiled, [(.05, note, 40, .015)], 3)
    hard = render(compiled, [(.05, note, 127, .015)], 3)
    assert np.isfinite(hard).all()
    assert (np.sqrt(np.mean(hard ** 2, axis=0)) > .001).all()
    assert np.max(np.abs(hard)) < 1
    np.testing.assert_allclose(soft * (127 / 40), hard, rtol=1e-9, atol=1e-10)
    # Very short MIDI-style gates must not kill the acoustic tail.
    assert np.max(np.abs(hard[4800:6000])) > 1e-6
    assert np.max(np.abs(hard[-4800:])) < 1e-7


@pytest.mark.parametrize("control,notes", [
    ("bd_snappiness", [35, 36]), ("hihat_tuning", [42, 46]), ("snare_tuning", [38]),
    ("side_stick_tuning", [37]), ("clap_decay", [39]), ("electric_snare_snap", [40]),
    *[(f"tom_{note}_tuning", [note]) for note in [41, 43, 45, 47, 48, 50]],
    ("crash_decay", [49]), ("ride_brightness", [51]), ("tambourine_decay", [54]),
])
def test_each_control_changes_its_voice_at_both_extremes(kit, compiled, control, notes):
    definition = next(n.params for n in kit.graph.nodes if n.id == control)
    for note in notes:
        events = [(.05, note, 90, .015)]
        default = render(compiled, events, 3)
        for bound in ("min", "max"):
            audio = render(compile_kit(kit, {control: definition[bound]}), events, 3)
            assert np.isfinite(audio).all()
            assert np.max(np.abs(audio)) < 1
            assert np.sqrt(np.mean((audio - default) ** 2)) > .0001


def test_unmapped_notes_stay_silent(compiled):
    events = [(.05 + .1 * i, note, 127, .02) for i, note in enumerate([0, 34, 44, 52, 53, 55, 81, 127])]
    assert np.max(np.abs(render(compiled, events, 2))) == 0


def test_existing_controller_definitions_and_case_assignments_are_preserved(kit):
    original = load_patch_fixture("analog_drumkit_library_original")
    controllers = {n.id: n.params for n in kit.graph.nodes if n.opcode == "perf_controller"}
    for node in original.graph.nodes:
        if node.opcode == "perf_controller":
            assert controllers[node.id] == node.params
    cases = {case.id: case for case in kit.graph.control_flow["kit"].cases}
    for case in original.graph.control_flow["kit"].cases:
        assert cases[case.id] == case
    assert {case.value for case in cases.values()} == {
        35, 36, 37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 54, None,
    }
    assert len(controllers) == 19
