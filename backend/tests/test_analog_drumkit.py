"""Audio contracts for the expanded instrument, using frozen test fixtures only."""
import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.analog_drumkit_audio import compile_kit, render


@pytest.fixture(scope="module")
def kit():
    return load_patch_fixture("analog_drumkit_cymbals")


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


@pytest.mark.parametrize("note", [35, 36, 37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 50, 54])
def test_cymbal_revision_preserves_every_other_voice(compiled, note):
    previous = compile_kit(load_patch_fixture("analog_drumkit_breakbeat"))
    events = [(.05, note, 40, .015), (.9, note, 127, .02)]
    np.testing.assert_array_equal(render(compiled, events, 3), render(previous, events, 3))


def test_cymbal_revision_preserves_all_controller_definitions(kit):
    previous = load_patch_fixture("analog_drumkit_breakbeat")
    assert {n.id: n.params for n in kit.graph.nodes if n.opcode == "perf_controller"} == {
        n.id: n.params for n in previous.graph.nodes if n.opcode == "perf_controller"
    }


def _power_spectrum(audio, start, end):
    mono = audio[round(start * 48000):round(end * 48000)].mean(axis=1)
    frames = np.lib.stride_tricks.sliding_window_view(mono, 4096)[::512]
    power = (abs(np.fft.rfft(frames * np.hanning(4096))) ** 2).mean(axis=0)
    return np.fft.rfftfreq(4096, 1 / 48000), power


def test_crash_tail_retains_broadband_wash(compiled):
    audio = render(compiled, [(.1, 49, 100, .015)], 3)
    frequencies, power = _power_spectrum(audio, .6, 1)
    band = power[(frequencies >= 1500) & (frequencies <= 12000)]
    flatness = np.exp(np.mean(np.log(band + 1e-30))) / np.mean(band)
    # The rejected FM tail measured ~0.055 here; guard against that tonal collapse.
    assert flatness > .35
    assert np.sqrt(np.mean(audio[28800:43200] ** 2)) > .001


def test_ride_has_high_frequency_wash(compiled):
    audio = render(compiled, [(.1, 51, 100, .015)], 3)
    frequencies, power = _power_spectrum(audio, .1, .6)
    # The old seven-sine ride had only ~2% of its early energy above 4 kHz.
    assert power[frequencies >= 4000].sum() / power.sum() > .5
    assert power[frequencies < 1500].sum() / power.sum() < .1


@pytest.mark.parametrize("note,control", [(49, "crash_decay"), (51, "ride_brightness")])
@pytest.mark.parametrize("bound", ["min", "default", "max"])
def test_cymbal_gate_independence_and_tail_at_control_extremes(kit, note, control, bound):
    definition = next(n.params for n in kit.graph.nodes if n.id == control)
    artifact = compile_kit(kit, {control: definition[bound]})
    short = render(artifact, [(.1, note, 127, .015)], 4)
    held = render(artifact, [(.1, note, 127, .8)], 4)
    np.testing.assert_array_equal(short, held)
    assert np.isfinite(short).all() and abs(short).max() < 1
    assert abs(short[-4800:]).max() < 1e-7


def test_layered_cymbal_retriggers_keep_headroom(kit):
    artifact = compile_kit(kit, {"crash_decay": 2.6, "ride_brightness": 1.5})
    events = [(.1 + i * .125, note, 127, .015) for i in range(16) for note in (49, 51)]
    audio = render(artifact, events, 6)
    assert np.isfinite(audio).all() and abs(audio).max() < 1
    assert abs(audio[-4800:]).max() < 1e-7
