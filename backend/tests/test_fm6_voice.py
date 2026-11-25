"""FM6 graph, native DSP and controller regressions using a versioned fixture."""

import hashlib
import json

import numpy as np
import pytest
from pydantic import ValidationError

from backend.app.models.fm6 import FM6_DATA, FM6_PRESETS, FM6_WEIGHTS, fm6_voice
from backend.app.models.patch import NodeInstance
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_render_resources import analyze_render_resources
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_controller_service import controller_bindings
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, fundamental, note_events, render, rms


def patch(custom=None):
    result = load_patch_fixture('almost_dx7')
    if custom is not None:
        result.graph.connections = [c for c in result.graph.connections if c.to_node_id != 'fm6' or c.to_port_id in {'kfreq', 'ivelocity'}]
        next(n for n in result.graph.nodes if n.id == 'fm6').params = {'ipreset': 0, **custom}
    return result


def audition(p=None, settings=None, notes=None, seconds=1.2, mode='host', ksmps=None, updates=()):
    artifact, targets = compile_guitars([p or patch()], mode=mode, settings=[settings or {}], ksmps=ksmps)
    audio, _ = render(artifact, targets, note_events(notes or [(.08, 60, 100, .24)]), seconds, mode=mode, controller_updates=updates)
    return audio


@pytest.mark.parametrize('key,value', [('algorithm', 0), ('algorithm', 1.5), ('feedback', 101),
    ('op1_ratio', 0), ('op6_level', float('inf')), ('op3_attack', 0), ('op2_enabled', 2),
    ('op4_sustain', 'hello'), ('op5_detune', -101), ('ipreset', 1.5), ('ipreset', len(FM6_PRESETS) + 1),
    ('weight_5_1', -.01), ('weight_6_5', 1.01), ('weight_2_1', float('nan'))])
def test_invalid_voice_rejected_at_model_boundary(key, value):
    with pytest.raises(ValidationError, match='FM6'):
        NodeInstance(id='fm', opcode='fm6_voice', params={key: value}, position={'x': 0, 'y': 0})


def test_bank_is_stable_and_routing_is_acyclic():
    # Existing preset IDs AND sound definitions are a persistence contract.
    digest = hashlib.sha256(json.dumps(FM6_PRESETS[:12], sort_keys=True).encode()).hexdigest()
    assert digest == 'f9008de934692cc8574cecad0795bff1a62fe32ec4fb56020b2065ffa895d472'
    extension_digest = hashlib.sha256(json.dumps(FM6_PRESETS[12:24], sort_keys=True).encode()).hexdigest()
    assert extension_digest == 'a3d769adab95a2a796d6df737d7a57b24a47cde064944dee276dbc89a51ceef3'
    effects_digest = hashlib.sha256(json.dumps(FM6_PRESETS[24:32], sort_keys=True).encode()).hexdigest()
    assert effects_digest == '4ed5f2d5301cd75b78334ae1c886a93c25c5ae71e7e1d536c24a0ac8fa57ea65'
    assert [p['id'] for p in FM6_PRESETS] == list(range(1, 33))
    assert set(FM6_WEIGHTS) == {f'weight_{a}_{b}' for alg in FM6_DATA['algorithms'] for a, b in alg['edges']}
    for preset in FM6_PRESETS:
        assert fm6_voice(preset['voice']) == preset['voice'] | dict.fromkeys(FM6_WEIGHTS, 1)
    for algorithm in FM6_DATA['algorithms']:
        assert all(1 <= target < source <= 6 for source, target in algorithm['edges'])
        assert set(algorithm['outputs']) == set(range(1, 7)) - {s for s, _ in algorithm['edges']}


def test_compile_is_private_bounded_and_dry():
    artifact, targets = compile_guitars([patch(), patch()], mode='host', settings=[{'fm6_preset': 2}, {'fm6_preset': 6}])
    assert artifact.orc.count('opcode vcs_fm6_voice,') == 1
    assert artifact.orc.count(' vcs_fm6_voice ') == 2
    assert 'setksmps 1' in artifact.orc
    assert not any(n.opcode in {'reverbsc', 'delay', 'outs'} for n in targets[0].patch.graph.nodes)
    analysis = analyze_render_resources(targets, OpcodeService('/static/icons'))
    assert not analysis.blockers
    fm_resources = [r for r in analysis.accesses if r.node == 'fm6']
    assert len(fm_resources) == 2 and all(r.scope == 'voice' for r in fm_resources)


def test_continuous_and_legato_are_rejected():
    p = patch()
    p.always_on = True
    with pytest.raises(CompilationError) as error:
        compile_guitars([p])
    assert 'note-activated' in str(error.value.diagnostics)
    p = patch()
    p.graph.nodes[0].opcode = 'midi_legato'
    with pytest.raises(CompilationError) as error:
        compile_guitars([p])
    assert 'midi_legato' in str(error.value.diagnostics)


@pytest.mark.parametrize('preset', [p['id'] for p in FM6_PRESETS])
def test_presets_sound_and_finish_release(preset):
    voice = FM6_PRESETS[preset - 1]['voice']
    seconds = .32 + max(voice[f'op{i}_release'] for i in range(1, 7)) + .15
    audio = audition(settings={'fm6_preset': preset}, seconds=seconds)
    assert np.isfinite(audio).all()
    assert .002 < abs(audio).max() < .5
    np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=1e-12)
    assert abs(audio[-2400:]).max() < 1e-9


# Independent route definitions: changing the bank graph alone cannot bless wrong DSP.
ROUTES = [([(2, 1), (4, 3), (6, 5)], [1, 3, 5]),
          ([(3, 2), (2, 1), (6, 5), (5, 4)], [1, 4]),
          ([(6, 5), (5, 4), (4, 3), (2, 1)], [1, 3]),
          ([(6, 5), (5, 4), (4, 3), (3, 2), (2, 1)], [1]),
          ([(2, 1), (3, 1), (4, 1), (5, 1), (6, 1)], [1]),
          ([(6, 5), (5, 1), (5, 2), (5, 3), (5, 4)], [1, 2, 3, 4]),
          ([(6, 5), (5, 4), (3, 2)], [1, 2, 4]), ([], [1, 2, 3, 4, 5, 6])]


def steady_voice(algorithm=8):
    values = dict(algorithm=algorithm, feedback=0, igain=0)
    for i, level in enumerate([80, 26, 35, 41, 25, 44], 1):
        values.update({f'op{i}_{k}': v for k, v in dict(ratio=i, level=level, velocity=0,
            attack=.001, decay=.001, sustain=100, release=.08, detune=0, enabled=1).items()})
    return values


@pytest.mark.parametrize('algorithm,weighted', [(i, False) for i in range(1, 9)] + [(i, True) for i in range(1, 8)])
def test_algorithm_matches_independent_phase_modulation_reference(algorithm, weighted):
    values = steady_voice(algorithm)
    edges, carriers = ROUTES[algorithm - 1]
    if weighted:
        values.update({f'weight_{source}_{target}': index / len(edges) for index, (source, target) in enumerate(edges)})
    audio = audition(patch(values), notes=[(.08, 69, 127, .24)], seconds=.5, mode='score')[:, 0]
    start, end = 6000, 12000
    actual = audio[start:end]
    errors = []
    for offset in range(-4, 5):
        time = (np.arange(start, end) - 3840 + offset) / 48000
        ops = {}
        for op in range(6, 0, -1):
            modulation = sum(ops[source] * values.get(f'weight_{source}_{target}', 1) for source, target in edges if target == op)
            ops[op] = np.sin(2 * np.pi * 440 * op * time + 8 * modulation) * values[f'op{op}_level'] / 100
        expected = sum(ops[op] for op in carriers) / 6 / np.sqrt(2)
        errors.append(rms(expected - actual))
    assert min(errors) < 1e-6, errors


def test_feedback_belongs_to_operator_six_and_is_voice_local():
    voice = steady_voice()
    a = audition(patch(voice))
    b = audition(patch(voice | {'feedback': 90}))
    assert rms(a - b) > .005
    muted = voice | {'op6_enabled': 0}
    np.testing.assert_allclose(audition(patch(muted)), audition(patch(muted | {'feedback': 90})), atol=1e-12)
    p = patch(voice | {'feedback': 75})
    notes = [(.08, 57, 100, .24)]
    other = [(.16, 64, 70, .32)]
    combined = audition(p, notes=notes + other)
    np.testing.assert_allclose(combined, audition(p, notes=notes) + audition(p, notes=other), atol=1e-10)


def test_crosswind_swells_and_uses_feedback_during_the_held_note():
    notes = [(.05, 43, 110, 2.5)]
    wind = audition(settings={'fm6_preset': 25}, notes=notes, seconds=3.8)[:, 0]
    without_feedback = audition(patch(FM6_PRESETS[24]['voice'] | {'ifeedback': 0}),
                                notes=notes, seconds=3.8)[:, 0]
    sustained = slice(72000, 96000)
    assert rms(wind[sustained]) > 3 * rms(wind[3360:6720])
    assert rms(wind[sustained] - without_feedback[sustained]) > .1 * rms(wind[sustained])


def test_brake_drum_has_inharmonic_partials_after_the_strike():
    drum = audition(settings={'fm6_preset': 28}, notes=[(.05, 57, 110, 2)], seconds=2.1)[:, 0]
    ring = drum[12000:24000]
    power = abs(np.fft.rfft(ring * np.hanning(len(ring)))) ** 2
    harmonic_number = np.fft.rfftfreq(len(ring), 1 / 48000) / 220
    between_harmonics = abs(harmonic_number - np.rint(harmonic_number)) > .1
    assert power[between_harmonics].sum() > .2 * power.sum()
    assert rms(ring) > 3 * rms(drum[72000:84000])


def test_block_sizes_preserve_sample_feedback_and_release():
    p = patch(steady_voice(4) | {'feedback': 70})
    reference = audition(p, ksmps=1)
    for block in [16, 64]:
        np.testing.assert_allclose(audition(p, ksmps=block), reference, atol=1e-10)


def test_midi_and_score_exports_preserve_sound():
    reference = audition(settings={'fm6_preset': 9}, mode='score')
    midi = audition(settings={'fm6_preset': 9}, mode='midi', ksmps=1)
    np.testing.assert_allclose(reference, midi, atol=1e-10)


def test_preset_change_waits_for_new_note_and_instances_stay_independent():
    p = patch()
    notes = [(.08, 60, 100, .24), (.8, 60, 100, .24)]
    artifact, targets = compile_guitars([p], mode='host')
    channel = controller_bindings(targets[0], 'guitar0')['fm6_preset']['channel']
    changed, _ = render(artifact, targets, note_events(notes), 1.8, mode='host', controller_updates=[(.16, channel, 8)])
    before = audition(settings={'fm6_preset': 1}, notes=notes, seconds=1.8)
    after = audition(settings={'fm6_preset': 8}, notes=notes, seconds=1.8)
    np.testing.assert_allclose(changed[:36000], before[:36000], atol=1e-10)
    # Original piano's release is over before the second note.
    np.testing.assert_allclose(changed[38400:], after[38400:], atol=1e-10)
    artifact, targets = compile_guitars([p, p], mode='host', settings=[{'fm6_preset': 1}, {'fm6_preset': 8}])
    audio, _ = render(artifact, targets, note_events(notes) + note_events(notes, channel=1), 1.8, mode='host')
    np.testing.assert_allclose(audio, before + after, atol=1e-10)


def test_velocity_brightness_envelope_scales_gain_and_tuning():
    voice = steady_voice(1) | {'op1_velocity': 100, 'op3_velocity': 100, 'op5_velocity': 100}
    hard = audition(patch(voice), notes=[(.08, 60, 100, .24)])
    soft = audition(patch(voice), notes=[(.08, 60, 50, .24)])
    np.testing.assert_allclose(soft, hard * .5, atol=1e-10)
    np.testing.assert_allclose(audition(patch(voice | {'igain': -6})), hard * 10 ** (-6 / 20), atol=1e-10)
    assert rms(hard - audition(patch(voice | {'ibrightness': 0}))) > .01
    slow = audition(patch(voice | {'op1_attack': .2, 'op3_attack': .2, 'op5_attack': .2, 'iattack_scale': 4}))
    assert rms(slow[4800:9600]) < rms(hard[4800:9600]) * .3
    long = audition(patch(voice | {'irelease_scale': 4}))
    assert rms(long[21000:24000]) > .001 and abs(hard[21000:24000]).max() == 0
    single = steady_voice() | {f'op{i}_enabled': 0 for i in range(2, 7)}
    detuned = audition(patch(single | {'op1_ratio': 2, 'op1_detune': 100}), notes=[(.08, 69, 100, .8)])
    spectrum = abs(np.fft.rfft(detuned[9600:33600, 0] * np.hanning(24000)))
    frequency = np.argmax(spectrum) * 2
    assert frequency == pytest.approx(880 * 2 ** (100 / 1200), abs=2)


@pytest.mark.parametrize('preset', range(13, 21))
def test_bass_bank_has_tuned_low_end_velocity_response_and_short_release(preset):
    notes = [(.08 + i, note, 110, .65) for i, note in enumerate([28, 36, 40, 48, 52])]
    audio = audition(settings={'fm6_preset': preset}, notes=notes, seconds=5.2)
    assert np.isfinite(audio).all() and .005 < abs(audio).max() < .5
    for start, note, _, _ in notes:
        expected = 440 * 2 ** ((note - 69) / 12)
        body = audio[round((start + .2) * 48000):round((start + .6) * 48000), 0]
        assert rms(body) > .001
        measured = fundamental(body, expected)
        assert abs(1200 * np.log2(measured / expected)) < 20, (preset, note, measured)
        # A useful bass needs actual energy at the played fundamental, not only upper partials.
        spectrum = abs(np.fft.rfft(body * np.hanning(len(body)))) ** 2
        frequencies = np.fft.rfftfreq(len(body), 1 / 48000)
        assert spectrum[abs(frequencies - expected) < 5].sum() / spectrum.sum() > .05
    soft = audition(settings={'fm6_preset': preset}, notes=[(.08, 36, 40, .65)])
    hard = audition(settings={'fm6_preset': preset}, notes=[(.08, 36, 110, .65)])
    assert rms(hard) > rms(soft) * 1.05
    assert abs(audio[-2400:]).max() < 1e-9


@pytest.mark.parametrize("before,changes", [
    (steady_voice(8), {"algorithm": 1, "op3_ratio": 2.5, "igain": -12}),
    (steady_voice(6) | {"weight_5_1": .8, "weight_5_2": 1}, {"weight_5_1": 0, "weight_5_2": .35}),
])
def test_preview_edits_and_rollback_latch_at_note_start(before, changes):
    from backend.app.services.compiler_fm6 import preview_channel

    p = patch(before)
    artifact, targets = compile_guitars([p], mode="host", fm6_preview=True)
    resources = analyze_render_resources(targets, OpcodeService("/static/icons"))
    channels = {r.resource for r in resources.accesses if r.stage == "patch:guitar0" and r.scope == "host"}
    assert {"channel:" + preview_channel("guitar0", "fm6", k) for k in changes} <= channels
    # Edit during the first held note and cancel during the second.
    notes = [(.08, 60, 96, .45), (.25, 66, 105, .45), (.49, 71, 90, .28)]
    updates = [(t, preview_channel("guitar0", "fm6", k), v)
               for t, values in [(.16, changes), (.38, {k: before[k] for k in changes})]
               for k, v in values.items()]
    actual, _ = render(artifact, targets, note_events(notes), 1, mode="host", controller_updates=updates)
    expected = (audition(p, notes=[notes[0], notes[2]], seconds=1) +
                audition(patch(before | changes), notes=[notes[1]], seconds=1))
    np.testing.assert_allclose(actual, expected, atol=1e-10)
