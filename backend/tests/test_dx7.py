from base64 import b64encode
import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from backend.app.models.dx7 import INIT_VOICE, node_voice, read_sysex
from backend.app.models.patch import Connection, NodeInstance
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_render_resources import analyze_render_resources
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_controller_service import controller_bindings
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, note_events, render

FIXTURES = Path(__file__).parent / "fixtures/dx7"


def test_bundled_presets_are_distinct_playable_voices():
    catalog = Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json"
    presets = json.loads(catalog.read_text())["presets"]
    assert [preset["id"] for preset in presets] == list(range(1, 33))
    voices = [node_voice(preset) for preset in presets]
    assert len({voice[:145] for voice in voices}) == 32
    for preset, voice in zip(presets, voices, strict=True):
        compiled, targets = compile_guitars([patch(voice)], mode="host", ksmps=32)
        events = note_events([(0.032, 60, 108, 1.15)])
        audio, _ = render(compiled, targets, events, 1.4, mode="host")
        assert np.isfinite(audio).all() and 0.001 < abs(audio).max() < 1, preset["name"]
        selected = patch()
        next(n for n in selected.graph.nodes if n.opcode == "fm_dx7").params["ipreset"] = preset["id"]
        selected_orc, selected_targets = compile_guitars([selected], mode="host", ksmps=32)
        actual, _ = render(selected_orc, selected_targets, events, 1.4, mode="host")
        np.testing.assert_array_equal(actual, audio, err_msg=preset["name"])


def patch(voice=INIT_VOICE):
    result = load_patch_fixture("dx7")
    next(n for n in result.graph.nodes if n.opcode == "fm_dx7").params["voice"] = b64encode(voice).decode()
    return result


def controlled_patch():
    result = patch(read_sysex((FIXTURES / "tine_keys.syx").read_bytes())[0])
    result.graph.nodes.append(NodeInstance(
        id="selector", opcode="perf_controller", position={"x": 0, "y": 0},
        params={"label": "DX7 preset", "controller_type": "integer", "min": 0, "max": 32, "default": 0},
    ))
    result.graph.connections.append(Connection(
        from_node_id="selector", from_port_id="iout", to_node_id="dx7", to_port_id="ipreset",
    ))
    return result


@pytest.mark.parametrize("preview", [False, True])
def test_preset_controller_latches_new_notes_and_returns_to_editor_voice(preview):
    p = controlled_patch()
    bank = json.loads((Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json").read_text())["presets"]
    compiled, targets = compile_guitars([p], mode="host", ksmps=32, fm6_preview=preview)
    channel = controller_bindings(targets[0], "guitar0")["selector"]["channel"]
    notes = [(0, 60, 96, .32), (.096, 48, 108, .24), (.192, 72, 96, .18)]
    actual, _ = render(compiled, targets, note_events(notes), .55, mode="host",
                       controller_updates=[(.064, channel, 7), (.16, channel, 0)])
    expected = np.zeros_like(actual)
    for source, events in [(p, [notes[0], notes[2]]), (patch(node_voice(bank[6])), [notes[1]])]:
        artifact, parts = compile_guitars([source], mode="host", ksmps=32)
        signal, _ = render(artifact, parts, note_events(events), .55, mode="host")
        expected += signal
    np.testing.assert_allclose(actual, expected, atol=1e-10)


@pytest.mark.parametrize("mode", ["score", "midi"])
def test_csd_exports_embed_controller_selected_preset(mode):
    preset = json.loads((Path(__file__).resolve().parents[1] / "app/data/dx7-presets.json").read_text())["presets"][-1]
    events = note_events([(.032, 60, 96, .12)])
    def play(instrument, settings):
        artifact, targets = compile_guitars([instrument], mode=mode, ksmps=1, settings=[settings])
        return render(artifact, targets, events, .35, mode=mode)[0]
    np.testing.assert_array_equal(play(controlled_patch(), {"selector": 32}), play(patch(node_voice(preset)), {}))


def pack_voice(voice):
    data = bytearray()
    for i in range(0, 126, 21):
        op = voice[i : i + 21]
        data.extend(op[:11])
        data.extend(
            (op[11] | op[12] << 2, op[13] | op[20] << 3, op[14] | op[15] << 2, op[16], op[17] | op[18] << 1, op[19])
        )
    return (
        data
        + voice[126:135]
        + bytes([voice[135] | voice[136] << 3])
        + voice[137:141]
        + bytes([voice[141] | voice[142] << 1 | voice[143] << 4])
        + voice[144:]
    )


def bank(voices):
    data = b"".join(pack_voice(v) for v in voices)
    return bytes([240, 67, 15, 9, 32, 0]) + data + bytes([-sum(data) % 128, 247])


def test_cartridge_and_invalid_dumps():
    from backend.app.models.dx7 import VOICE_MAX

    voices = [INIT_VOICE] * 30 + [bytes(VOICE_MAX), read_sysex((FIXTURES / "iron_bell.syx").read_bytes())[0]]
    dump = bank(voices)
    assert read_sysex(dump) == voices
    for broken in [
        dump[:-1],
        dump[:-2] + bytes([dump[-2] ^ 1, 247]),
        dump.replace(b"\xf0\x43", b"\xf0\x44", 1),
        dump[:3] + b"\x00" + dump[4:],
        dump + dump,
        bytes([240, 67, 32]) + dump[3:],
    ]:
        with pytest.raises(ValueError):
            read_sysex(broken)
    for bad in ("", True, b64encode(bytes([127]) * 155).decode()):
        with pytest.raises(ValidationError, match="DX7"):
            NodeInstance(id="n", opcode="fm_dx7", params={"voice": bad}, position={"x": 0, "y": 0})
    assert node_voice({}) == INIT_VOICE


def test_dexed_cartridge_preserves_extended_operator_fine():
    extended = bytearray(INIT_VOICE)
    extended[4 * 21 + 19] = 127
    assert read_sysex(bank([INIT_VOICE] * 31 + [extended]))[-1] == bytes(extended)


def test_udo_emitted_once_shared_readonly_voice_and_per_note_state():
    artifact, targets = compile_guitars([patch(), patch()], mode="host")
    assert artifact.orc.count("opcode fm_dx7, ak,") == 1
    assert artifact.orc.count("[] fillarray " + ", ".join(map(str, INIT_VOICE[:145]))) == 1
    assert not analyze_render_resources(targets, OpcodeService("/static/icons")).blockers
    p = patch()
    p.always_on = True
    with pytest.raises(CompilationError):
        compile_guitars([p])


def test_all_algorithms_render_including_multi_operator_feedback():
    voice = bytearray(read_sysex((FIXTURES / "loop_brass.syx").read_bytes())[0])
    for algo in range(32):
        voice[134] = algo
        artifact, targets = compile_guitars([patch(voice)], mode="host")
        audio, _ = render(artifact, targets, note_events([(0, 60, 112, 0.048)]), 0.12, mode="host")
        assert np.isfinite(audio).all() and max(abs(audio[:, 0])) > 0.001, algo


def test_sixteen_notes_equal_independent_voices_with_early_releases():
    (voice,) = read_sysex((FIXTURES / "loop_brass.syx").read_bytes())
    artifact, targets = compile_guitars([patch(voice)], mode="host", ksmps=32)
    notes = [(0, 48 + i, 40 + 4 * i, 0.064 if i % 2 else 0.192) for i in range(16)]

    def play(events):
        audio, _ = render(artifact, targets, note_events(events), 0.384, mode="host")
        return audio[:, 0]

    chord = play(notes)
    singles = [play([n]) for n in notes]
    assert all(np.max(abs(tone)) > 0.001 for tone in singles)
    np.testing.assert_allclose(chord, np.sum(singles, axis=0), atol=1e-8)


def test_exported_midi_and_score_use_same_voice_and_release():
    (voice,) = read_sysex((FIXTURES / "iron_bell.syx").read_bytes())
    notes = note_events([(0.032, 60, 112, 0.064)])
    signals = []
    for mode in ("midi", "score"):
        artifact, targets = compile_guitars([patch(voice)], mode=mode, ksmps=1)
        audio, _ = render(artifact, targets, notes, 0.35, mode=mode)
        assert abs(audio[5000:6000]).max() > 0.0001
        signals.append(audio)
    np.testing.assert_allclose(*signals, atol=1e-8)


def test_preview_latches_operator_algorithm_and_cancel_per_note():
    from backend.app.services.compiler_fm6 import preview_channel, preview_values, preview_writes

    opening, = read_sysex((FIXTURES / "tine_keys.syx").read_bytes())
    edited = bytearray(opening)
    edited[134] = 3  # algorithm 4 includes a three-operator feedback loop
    edited[135] = 7
    edited[5 * 21 + 3] = 35
    edited[5 * 21 + 16] = 70
    before, after = patch(opening), patch(edited)
    compiled, targets = compile_guitars([before], mode="host", ksmps=32, fm6_preview=True)
    initial = preview_values(before)["dx7"]
    values = preview_values(after)["dx7"]
    assert len(initial) == 145 and len(preview_writes("guitar0", "dx7", initial, values)) == 145
    with pytest.raises(ValueError, match="DX7"):
        preview_writes("guitar0", "dx7", initial, {"dx7_134": 32})
    updates = [(time, preview_channel("guitar0","dx7",key), v) for time, changes in [(0.064, values), (.192, initial)]
               for key, v in changes.items()]
    notes = [(0, 60, 112, .24), (.128, 65, 100, .08), (.256, 72, 90, .08)]
    mixed, _ = render(compiled, targets, note_events(notes), .48, mode="host", controller_updates=updates)
    expected = np.zeros_like(mixed)
    for p, events in [(before, [notes[0], notes[2]]), (after, [notes[1]])]:
        ordinary, t = compile_guitars([p], mode="host", ksmps=32)
        signal, _ = render(ordinary, t, note_events(events), .48, mode="host")
        expected += signal
    np.testing.assert_allclose(mixed, expected, atol=1e-9)


def release_patch(preset, seconds=0, voices=None):
    instrument = patch()
    node = next(n for n in instrument.graph.nodes if n.opcode == "fm_dx7")
    node.params.update(ipreset=preset, imaxrelease=seconds)
    if voices is not None:
        instrument.graph.nodes.append(NodeInstance(id="polyphony", opcode="maxalloc", params={"icount": voices}))
    return instrument


def render_observed(instrument, notes, seconds, mode="host", *, block=32):
    artifact, targets = compile_guitars([instrument], mode=mode, ksmps=block)
    # The normal instrument is centered. Add the physical instance count to the
    # right channel after mixing, so subtraction leaves a sample-aligned trace.
    artifact.orc += """
instr dx7_test_observer
 kCount active 1
 outch 2, a(kCount)
endin
alwayson "dx7_test_observer"
"""
    audio, _ = render(artifact, targets, note_events(notes), seconds, mode=mode)
    return audio[:, 0], np.rint(audio[:, 1] - audio[:, 0])


@pytest.mark.parametrize(("mode", "block"), [("host", 32), ("midi", 1), ("score", 1)])
@pytest.mark.parametrize("preset", [9, 30])
def test_fast_dx7_voices_have_smooth_note_edges(mode, block, preset):
    audio, _ = render_observed(release_patch(preset), [(.032, 60, 108, .16)], .23, mode, block=block)
    start, release = 1536, 9216  # Block-aligned at 48 kHz.
    peak = np.max(abs(audio[start:release]))
    assert peak > .01
    assert audio[start] == 0
    assert np.max(abs(audio[start:start + 48])) < .16 * peak
    # The fast R4 used to drop into silence in under 3 ms. Follow the
    # tail through the taper and check that its final cut is inaudible.
    assert np.max(abs(audio[release + 240:release + 384])) > .05 * peak
    assert np.max(abs(audio[release + 480:])) < .001 * peak


@pytest.mark.parametrize(("mode", "block"), [("host", 32), ("midi", 1), ("score", 1)])
def test_release_cap_starts_at_keyup_and_fades_long_patch(mode, block):
    notes = [(0, 60, 96, 1.28)]
    capped, count = render_observed(release_patch(21, 1), notes, 2.35, mode, block=block)
    native, _ = render_observed(release_patch(21), notes, 2.35, mode, block=block)
    np.testing.assert_array_equal(capped[:100000], native[:100000])
    assert np.max(abs(native[-960:])) > .0001
    assert np.max(abs(capped[int(2.28*48000):])) < 1e-10
    assert count[-1] == 0
    # A still-loud Low Mist tapers progressively before the deadline.
    for time, expected in [(2.23, .5), (2.27, .028)]:
        window = slice(int(time * 48000), int(time * 48000) + 32)
        assert np.max(abs(capped[window])) / np.max(abs(native[window])) == pytest.approx(expected, abs=.025)


def test_expired_clock_click_retires_while_held_and_rising_release_voices_are_preserved():
    note = [(0, 60, 96, .64)]
    _, count = render_observed(release_patch(16, voices=2), note, .9)
    assert count[1200] == 1
    assert count[24000] == 0  # All remaining carrier targets are already silent while held.
    assert count[-1] == 0  # Previously retained a slot for another 25.48 seconds.
    v = bytearray(INIT_VOICE)
    v[105:113] = bytes([99, 99, 99, 25, 0, 0, 0, 99])  # OP1 rises from silence on release.
    sound, count = render_observed(patch(v), note, 1.5)
    assert count[-1] == 1
    assert np.max(abs(sound[-4800:])) > np.max(abs(sound[24000:28800])) * 3


@pytest.mark.parametrize(("mode", "block"), [("host", 32), ("midi", 1), ("score", 1)])
def test_steal_fades_quietest_released_voice_and_preserves_louder_tail(mode, block):
    # Make loudness velocity-dependent and use a long release. The oldest and
    # loudest note must survive when the third note replaces the quieter tail.
    v = bytearray(INIT_VOICE)
    v[108], v[120] = 20, 7
    p = patch(v)
    p.graph.nodes.append(NodeInstance(id="limit", opcode="maxalloc", params={"icount": 2}))
    notes = [(0, 48, 120, .16), (.032, 55, 85, .128), (.224, 72, 110, .096)]
    poly, count = render_observed(p, notes, .48, mode, block=block)
    singles = [render_observed(p, [n], .48, mode, block=block)[0] for n in notes]
    victim = singles[1]
    outgoing = poly - singles[0] - singles[2]
    start = round(.224 * 48000)
    np.testing.assert_allclose(outgoing[:start], victim[:start], atol=1e-10)
    assert np.max(abs(victim[start:start+960])) > 1e-5
    # Throughout the handoff the removed contribution follows a smooth gain
    # ramp. A hard cut, rejected attack, or wrong victim fails this comparison.
    valid = np.flatnonzero(abs(victim[start:start+960]) > 1e-7) + start
    gain = outgoing[valid] / victim[valid]
    assert gain[0] > .95 and np.min(gain) >= -1e-6
    assert np.max(np.abs(np.diff(gain) / np.diff(valid))) < .004
    np.testing.assert_allclose(outgoing[start+600:], 0, atol=1e-10)
    assert count[start+600] == 2


def test_stolen_held_voice_finishes_and_its_later_keyup_leaves_successor_playing():
    notes = [(0, 48, 110, .24), (.096, 72, 96, .38)]
    instrument = release_patch(28, voices=1)
    audio, count = render_observed(instrument, notes, .52)
    successor, _ = render_observed(instrument, notes[1:], .52)
    np.testing.assert_allclose(audio[5600:], successor[5600:], atol=1e-10)
    assert count[6000] == 1 and count[14000] == 1


def test_other_audio_source_keeps_its_own_release_after_dx7_silence():
    instrument = release_patch(16, voices=2)
    instrument.graph.nodes.append(NodeInstance(id="other", opcode="const_a", params={"value": .25}))
    instrument.graph.connections.append(Connection(from_node_id="other", from_port_id="aout",
                                                   to_node_id="output_pan2", to_port_id="asig"))
    audio, count = render_observed(instrument, [(0, 60, 96, .64)], 1)
    assert count[-1] == 1 and np.max(abs(audio[-480:])) > .01


def test_release_controller_is_sampled_only_at_note_start():
    p = controlled_patch()
    node = next(n for n in p.graph.nodes if n.opcode == "fm_dx7")
    node.params["ipreset"] = 21
    p.graph.connections[-1].to_port_id = "imaxrelease"
    compiled, targets = compile_guitars([p], mode="host", ksmps=32)
    channel = controller_bindings(targets[0], "guitar0")["selector"]["channel"]
    notes = [(0, 60, 96, .16), (.096, 67, 96, .24)]
    actual, _ = render(compiled, targets, note_events(notes), 1.6, mode="host",
                       controller_updates=[(.064, channel, 1), (.224, channel, 0)])
    native, _ = render_observed(release_patch(21), notes[:1], 1.6)
    capped, _ = render_observed(release_patch(21, 1), notes[1:], 1.6)
    np.testing.assert_allclose(actual[:, 0], native + capped, atol=1e-10)


def test_sixteen_occupied_slots_accept_a_new_chord_and_reclaim_the_fading_instances():
    p = release_patch(24, voices=16)
    chord = [(0, key, 96, .064) for key in range(48, 64)]
    replacement = [(.096, key, 96, .128) for key in range(64, 80)]
    mix, count = render_observed(p, chord + replacement, .3)
    new, _ = render_observed(p, replacement, .3)
    old, _ = render_observed(p, chord, .3)
    np.testing.assert_allclose(mix[:4608], old[:4608], atol=1e-10)
    np.testing.assert_allclose(mix[5400:], new[5400:], atol=1e-10)
    assert count[3000] == count[5400] == 16
    assert count[4700] == 32  # Both chords render during the short handoff.


def test_rack_instances_have_independent_voice_limits():
    p = release_patch(24, voices=1)
    a = [(0, 48, 96, .08), (.16, 60, 96, .14)]
    b = [(.032, 72, 110, .28)]
    compiled, targets = compile_guitars([p, p], mode="host", ksmps=32)
    mix, _ = render(compiled, targets, note_events(a, 0) + note_events(b, 1), .4, mode="host")
    first, _ = render_observed(p, a, .4)
    second, _ = render_observed(p, b, .4)
    np.testing.assert_allclose(mix[:, 0], first + second, atol=1e-10)
