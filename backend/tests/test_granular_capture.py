"""Independent DSP and MIDI regression oracles for Granular Capture."""
import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tools.granular_capture_audio import render_capture

SR = 48000


def source(seconds=1.5):
    t = np.arange(round(seconds * SR)) / SR
    return np.column_stack([.1 * np.sin(2 * np.pi * 400 * t), .08 * np.sin(2 * np.pi * 700 * t)])


def render(x, events=(), **kwargs):
    return render_capture(load_patch_fixture('granular_capture'), x, events, **kwargs)


@pytest.mark.parametrize('mode,ksmps', [('midi', 1), ('score', 1), ('midi', 32), ('score', 32), ('midi', 64), ('midi', 128)])
def test_dry_bypass_mix_zero_and_wrong_midi_channel(mode, ksmps):
    x = source(.5)
    values = {'gc_output': 0}
    np.testing.assert_allclose(render(x, mode=mode, ksmps=ksmps, values=values), x, atol=4e-9)
    events = [(.1, 15, 20, 127), (.2, 15, 23, 127)]
    np.testing.assert_allclose(render(x, events, mode=mode, ksmps=ksmps, values=values), x, atol=4e-9)
    values['gc_mix'] = 0
    events = [(.1, 16, 20, 127), (.2, 16, 23, 127), (.3, 16, 21, 127)]
    np.testing.assert_allclose(render(x, events, mode=mode, ksmps=ksmps, values=values), x, atol=4e-9)


@pytest.mark.parametrize('mode', ['midi', 'score'])
@pytest.mark.parametrize('cc', [20, 21])
def test_stutter_and_freeze_hold_history_and_reset(mode, cc):
    x = source()
    x[int(.4*SR):] = 0
    audio = render(x, [(.3, 16, cc, 127), (1.1, 16, cc, 0)], mode=mode, values={'gc_output': 0})
    assert np.sqrt(np.mean(audio[int(.6*SR):SR] ** 2)) > .04
    # 125 ms period is preserved by capturing an extra 5 ms for the seam.
    np.testing.assert_allclose(audio[24000:28000], audio[30000:34000], atol=1e-9)
    assert np.max(abs(audio[int(1.12*SR):])) < 1e-12


def test_capture_requires_rising_edge_and_can_recapture_while_frozen():
    x = source(1.5)
    x[int(.5*SR):] = 0
    base = [(.3, 16, 21, 127), (.35, 16, 22, 127)]
    held = render(x, base + [(.8, 16, 22, 127)])
    assert np.max(abs(held[SR:])) > .04
    captured = render(x, base + [(.7, 16, 22, 0), (.8, 16, 22, 127)])
    assert np.max(abs(captured[int(.82*SR):])) == 0


def test_freeze_snapshot_survives_ring_wrap_and_stutter_toggle():
    x = source(3.2)
    x[int(.5*SR):] = 0
    events = [(.3, 16, 21, 127), (2.5, 16, 20, 127), (2.7, 16, 20, 0)]
    audio = render(x, events)
    assert np.sqrt(np.mean(audio[3*SR:] ** 2)) > .02


@pytest.mark.parametrize('granular', [False, True])
def test_stereo_isolation_linking_silence_and_restart(granular):
    x = source()
    x[:, 1] = 0
    events = [(.25, 16, 21, 127)] + ([(.3, 16, 23, 127)] if granular else [])
    audio = render(x, events)
    np.testing.assert_array_equal(audio[:, 1], 0)
    x[:, 1] = -x[:, 0]
    linked = render(x, events)
    np.testing.assert_allclose(linked[:, 0], -linked[:, 1], atol=1e-12)
    np.testing.assert_array_equal(render(np.zeros_like(x), events), 0)


@pytest.mark.parametrize('pitch', [-12, 0, 12, 24])
def test_grain_transposition_measured_frequency(pitch):
    x = source(2.5)
    events = [(1.2, 16, 21, 127), (1.2, 16, 23, 127)]
    audio = render(x, events, values={'gc_pitch': pitch, 'gc_grain': 100, 'gc_density': 40,
                                    'gc_slice': 1000, 'gc_spread': 0})
    spectrum = abs(np.fft.rfft(audio[int(1.5*SR):, 0] * np.hanning(SR)))
    assert abs(np.argmax(spectrum) - 400 * 2 ** (pitch / 12)) < 3


def test_granular_freeze_release_resumes_live_source():
    x = source(2)
    x[SR:] = 0
    audio = render(x, [(.3, 16, 23, 127), (.5, 16, 21, 127), (1.5, 16, 21, 0)])
    assert np.sqrt(np.mean(audio[int(1.2*SR):int(1.4*SR)] ** 2)) > .01
    assert np.max(abs(audio[int(1.8*SR):])) == 0


def test_controller_mapping_and_integer_rounding():
    x = source()
    expected = render(x, [(.3, 16, 20, 127)])
    actual = render(x, [(.3, 3, 41, 127)], values={'gc_channel': 2.8, 'gc_cc_stutter': 40.7})
    np.testing.assert_array_equal(actual, expected)


def test_all_dsp_endpoints_finite_bounded_and_reset_tails():
    patch = load_patch_fixture('granular_capture')
    controls = [n for n in patch.graph.nodes if n.opcode == 'perf_controller' and n.id not in
                {'gc_channel', 'gc_cc_stutter', 'gc_cc_freeze', 'gc_cc_capture', 'gc_cc_granular'}]
    x = np.random.default_rng(49).uniform(-.2, .2, (SR, 2))
    x[int(.7*SR):] = 0
    events = [(.2, 16, 20, 127), (.3, 16, 23, 127), (.8, 16, 20, 0), (.8, 16, 23, 0)]
    for values in [{}] + [{n.id: n.params[end]} for n in controls for end in ('min', 'max')]:
        audio = render(x, events, values=values)
        assert np.isfinite(audio).all()
        assert np.max(abs(audio)) <= .201
        assert np.max(abs(audio[int(.82*SR):])) == 0


def test_score_and_midi_cc_paths_match_away_from_event_block():
    x = source()
    events = [(.3, 16, 20, 127), (.6, 16, 23, 127), (1.2, 16, 20, 0), (1.2, 16, 23, 0)]
    midi = render(x, events, ksmps=1)
    score = render(x, events, mode='score', ksmps=1)
    # SCORE controller instrument executes after effect, so changes arrive one sample later.
    np.testing.assert_allclose(midi[int(.32*SR):int(.58*SR)], score[int(.32*SR)+1:int(.58*SR)+1], atol=.006)
    np.testing.assert_allclose(midi[int(1.22*SR):], score[int(1.22*SR):], atol=1e-12)


def test_real_step_sequencer_events_drive_capture_and_reset():
    from pathlib import Path
    from backend.app.models.session import SessionSequencerConfigRequest
    from backend.app.services.sequencer_runtime import SessionSequencerRuntime
    from backend.tests.test_sequencer_runtime import _FakeMidiService
    request = SessionSequencerConfigRequest.model_validate_json(
        (Path(__file__).parent / 'fixtures/sequencers/granular_capture_steps.json').read_text())
    midi = _FakeMidiService()
    runtime = SessionSequencerRuntime(session_id='capture-test', midi_service=midi, midi_input_selector='test',
        controller_default_channels=(1,), clock_mode='render_driven', publish_event=lambda *_: None)
    runtime.configure(request)
    runtime.start()
    events = []
    cursor = 0
    for sample in range(0, int(2.1 * SR), 32):
        runtime.advance_render_block(sample_rate=SR, ksmps=32, block_start_sample=sample)
        for _, batch, delay in midi.calls[cursor:]:
            events += [(sample / SR + (delay or 0), (m[0] & 15) + 1, m[1], m[2])
                       for m in batch if m[0] & 240 == 176]
        cursor = len(midi.calls)
    assert not runtime._running
    assert {event[1] for event in events} == {16}
    for cc in (20, 21, 22, 23):
        values = [e[3] for e in events if e[2] == cc]
        assert values[0] == values[-1] == 0 and 127 in values
    x = source(2.2)
    x[int(1.7*SR):] = 0
    audio = render(x, events)
    assert np.max(abs(audio[int(.3*SR):int(.7*SR)] - x[int(.3*SR):int(.7*SR)] * 10**(-6/20))) > .01
    assert np.max(abs(audio[int(2.05*SR):])) == 0


@pytest.mark.parametrize('key', ['stutter', 'freeze', 'capture', 'granular'])
@pytest.mark.parametrize('cc', [0, 95])
@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_cc_mapping_endpoints_actually_control_audio(key, cc, mode):
    x = source(1)
    x[int(.5*SR):] = 0
    original_cc = {'stutter': 20, 'freeze': 21, 'capture': 22, 'granular': 23}[key]
    events = [(0,16,n,0) for n in (20,21,22,23)] + [(.3,16,21,127), (.35,16,20,127),
              (.4,16,23,127), (.7,16,22,127)]
    remapped = [(t,ch,cc if n == original_cc else n,v) for t,ch,n,v in events]
    expected = render(x, events, mode=mode)
    actual = render(x, remapped, mode=mode, values={'gc_cc_'+key: cc})
    np.testing.assert_array_equal(actual, expected)


@pytest.mark.parametrize('mode', ['midi', 'score'])
def test_ctrl7_explicit_zero_table_does_not_delete_continuous_instrument(mode):
    patch = load_patch_fixture('granular_capture')
    next(n for n in patch.graph.nodes if n.id == 'gc_midi_freeze').params['ifn'] = 0
    x = source(.5)
    events = [(.25, 16, 21, 127)]
    actual = render_capture(patch, x, events, mode=mode)
    np.testing.assert_array_equal(actual, render(x, events, mode=mode))
