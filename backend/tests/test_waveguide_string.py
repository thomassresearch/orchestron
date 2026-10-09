"""Physical-string DSP acceptance; data comes only from versioned fixtures."""

from time import perf_counter

import numpy as np
import pytest

from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, render, note_events, periodic_pitch, rms, fundamental


def physical_patch(*, seed=123, noise=0, core=False):
    patch = load_patch_fixture("steel_string_waveguide")
    for node in patch.graph.nodes:
        if node.id == "guitar_string":
            node.params["iseed"] = seed
        if node.id == "guitar_noise":
            node.params["amp"] = noise
    if core:
        for edge in patch.graph.connections:
            if edge.to_node_id in ("output_left", "output_right") and edge.to_port_id == "asignal":
                edge.from_node_id = "guitar_string"
                edge.from_port_id = "astring" if edge.to_node_id == "output_left" else "abridge"
    return patch


def audition(notes, seconds, *, settings=None, mode="host", ksmps=16, patch=None):
    artifact, targets = compile_guitars([patch or physical_patch()], mode=mode, ksmps=ksmps, settings=[settings or {}])
    return render(artifact, targets, note_events(notes), seconds, mode=mode)[0]


@pytest.mark.parametrize("ksmps", [1, 16, 64])
@pytest.mark.parametrize(
    "settings,tolerance",
    [
        ({}, 5),
        ({"guitar_brightness": 0, "guitar_sustain": 1}, 10),
        ({"guitar_brightness": 1, "guitar_sustain": 8}, 10),
        ({"guitar_palm_mute": 1, "guitar_brightness": 0}, 10),
    ],
)
def test_fretboard_tuning_with_local_sample_feedback(ksmps, settings, tolerance):
    notes = [(0.05 + i * 0.36, n, 100, 0.22) for i, n in enumerate(range(40, 89))]
    x = audition(notes, 17.8, settings=settings, ksmps=ksmps, patch=physical_patch(core=True))
    assert np.isfinite(x).all()
    for start, note, _, _ in notes:
        expected = 440 * 2 ** ((note - 69) / 12)
        # Evaluate early enough to measure even a heavily palm-muted high string.
        begin = start + max(0.012, 2 / expected)
        end = begin + max(0.022, 7 / expected)
        signal = x[round(begin * 48000) : round(end * 48000), 0]
        cents = 1200 * np.log2(periodic_pitch(signal, expected) / expected)
        assert abs(cents) < tolerance, (note, cents, settings, ksmps)


@pytest.mark.parametrize("mode", ["host", "midi", "score"])
def test_velocity_release_and_chord_headroom(mode):
    notes = [(0.1 + i * 0.7, 57, v, 0.42) for i, v in enumerate([16, 32, 64, 96, 127])]
    x = audition(notes, 3.6, mode=mode, ksmps=16 if mode == "host" else 1)
    levels = [rms(x[round((t + 0.008) * 48000) : round((t + 0.22) * 48000)]) for t, *_ in notes]
    assert all(b > a * 1.25 for a, b in zip(levels, levels[1:]))
    np.testing.assert_allclose(x[:, 0], x[:, 1], atol=1e-12)
    assert abs(x[-4800:]).max() < 10 ** (-90 / 20)
    # Six fully simultaneous notes, not the easier staggered-strum case.
    for pick in [0, 0.35, 1]:
        x = audition(
            [(0.1, n, 127, 0.65) for n in [40, 47, 52, 56, 59, 64]],
            1.1,
            mode=mode,
            settings={
                "guitar_pick": pick,
                "guitar_body": 1,
                "guitar_brightness": 1,
                "guitar_sustain": 8,
                "guitar_variation": 1,
                "guitar_pluck_position": 0.35,
            },
            patch=physical_patch(noise=1, seed=0),
        )
        assert np.isfinite(x).all() and 0.005 < abs(x).max() <= 10 ** (-6 / 20)


def test_repeatable_internal_variation_and_no_held_note_retrigger():
    notes = [(0.1, 52, 100, 0.8)]
    a = audition(notes, 1.2, patch=physical_patch(seed=12))
    b = audition(notes, 1.2, patch=physical_patch(seed=12))
    c = audition(notes, 1.2, patch=physical_patch(seed=51))
    np.testing.assert_array_equal(a, b)
    assert rms(a - c) > rms(a) * 0.002
    assert 0.8 < rms(c) / rms(a) < 1.2
    automatic = audition([(0.1, 52, 100, 0.25), (0.6, 52, 100, 0.25)], 1.1, patch=physical_patch(seed=0))
    a = automatic[4800:14400]
    b = automatic[28800:38400]
    assert not np.array_equal(a, b)
    assert 0.8 < rms(b) / rms(a) < 1.2
    x = audition([(0.1, 52, 100, 0.25), (0.5, 52, 100, 0.25)], 1.1, patch=physical_patch(seed=12))
    assert rms(x[24480:26880]) > 0.001
    assert abs(x[-4800:]).max() < 10 ** (-90 / 20)


def test_independent_notes_and_rack_instances():
    p = physical_patch()
    first = [(0.1, 52, 100, 0.8)]
    second = [(0.1, 61, 90, 0.2)]
    a = audition(first, 1.3, patch=p)
    b = audition(second, 1.3, patch=p)
    together = audition(first + second, 1.3, patch=p)
    np.testing.assert_allclose(together, a + b, atol=1e-10)
    artifact, targets = compile_guitars([p, p], mode="host")
    x, _ = render(artifact, targets, note_events(first) + note_events(second, channel=1), 1.3, mode="host")
    np.testing.assert_allclose(x, a + b, atol=1e-10)
    assert rms(x[24000:33600]) > 0.0001


def high_fraction(x):
    signal = x[5280:14400, 0]
    spectrum = abs(np.fft.rfft(signal * np.hanning(len(signal)))) ** 2
    freq = np.fft.rfftfreq(len(signal), 1 / 48000)
    return spectrum[freq > 1800].sum() / max(spectrum.sum(), 1e-20)


def test_controls_and_frequency_dependent_decay():
    renders = {}
    for name, lo, hi in [
        ("pick", 0, 1),
        ("brightness", 0, 1),
        ("body", 0, 1),
        ("sustain", 1, 8),
        ("release", 0.05, 0.8),
        ("pluck_position", 0.08, 0.35),
        ("palm_mute", 0, 1),
    ]:
        for side, value in [("min", lo), ("max", hi)]:
            renders[name, side] = audition([(0.1, 52, 100, 1.3)], 2.4, settings={"guitar_" + name: value})
            assert np.isfinite(renders[name, side]).all()
            assert abs(renders[name, side][-4800:]).max() < 10 ** (-90 / 20)
        assert rms(renders[name, "min"] - renders[name, "max"]) > 1e-6, name
    for name in ["pick", "brightness"]:
        assert high_fraction(renders[name, "max"]) > high_fraction(renders[name, "min"]) * 1.15
    assert rms(renders["sustain", "max"][38400:48000]) > rms(renders["sustain", "min"][38400:48000]) * 1.5
    assert rms(renders["palm_mute", "min"][14400:24000]) > rms(renders["palm_mute", "max"][14400:24000]) * 2
    core = audition([(0.1, 52, 100, 2)], 2.3, patch=physical_patch(core=True))

    def upper_ratio(start, end):
        s = core[round(start * 48000) : round(end * 48000), 0]
        p = abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2
        f = np.fft.rfftfreq(len(s), 1 / 48000)
        return p[f > 2000].sum() / p[(f > 100) & (f < 1000)].sum()

    assert upper_ratio(0.12, 0.3) > upper_ratio(0.9, 1.1) * 2


def test_dispersion_preserves_fundamental_and_stretches_partials():
    signals = []
    for amount in [0, 1]:
        p = physical_patch(core=True)
        next(n for n in p.graph.nodes if n.id == "guitar_string").params["idispersion"] = amount
        signals.append(audition([(0.1, 64, 100, 0.8)], 1.1, patch=p))
    base = 440 * 2 ** ((64 - 69) / 12)
    cents = []
    for x in signals:
        s = x[7200:21600, 0]
        assert abs(1200 * np.log2(periodic_pitch(s, base) / base)) < 5
        cents.append(1200 * np.log2(fundamental(s, base * 8) / (base * 8)))
    assert cents[1] > cents[0] + 0.5
    assert cents[1] < 35


def test_bounded_extreme_notes_and_sustained_feedback():
    x = audition(
        [(0.1 + i * 0.5, n, 127, 0.3) for i, n in enumerate([0, 20, 40, 88, 108, 127])],
        3.4,
        settings={"guitar_sustain": 8, "guitar_brightness": 1},
        patch=physical_patch(noise=1, seed=0),
    )
    assert np.isfinite(x).all() and abs(x).max() < 0.5
    x = audition([(0.1, 40, 127, 6)], 6.4, settings={"guitar_sustain": 8, "guitar_brightness": 1})
    assert rms(x[240000:264000]) < rms(x[48000:72000])
    assert np.isfinite(x).all() and abs(x).max() < 0.5


def test_polyphonic_render_is_faster_than_realtime():
    notes = [(0.1, n, 100, 2) for n in range(40, 56)]
    start = perf_counter()
    x = audition(notes, 2.5)
    elapsed = perf_counter() - start
    assert np.isfinite(x).all()
    # Deliberately do not assert wall time on shared CI hardware.
    print(f"16 voices: {elapsed:.3f} seconds for 2.5 seconds of audio ({elapsed / 2.5:.3f}x realtime)")


def test_excitation_requires_fresh_energy_and_noise_shapes_attack():
    quiet = physical_patch()
    for identity in ["guitar_force_gain", "guitar_noise_gain"]:
        quiet.graph.ui_layout["input_formulas"][identity + "::kin"] = {"expression": "0", "inputs": []}
        quiet.graph.connections = [
            e for e in quiet.graph.connections if not (e.to_node_id == identity and e.to_port_id == "kin")
        ]
    assert abs(audition([(0.1, 52, 127, 0.6)], 1, patch=quiet)).max() == 0
    pulse = audition([(0.1, 52, 100, 0.6)], 1, patch=physical_patch(noise=0))
    mixed = audition([(0.1, 52, 100, 0.6)], 1, patch=physical_patch(noise=1))
    assert rms(mixed[4800:6000] - pulse[4800:6000]) > 1e-5
    assert 0.5 < rms(mixed) / rms(pulse) < 2


def test_unconnected_waveguide_defaults_compile_to_silence():
    patch = physical_patch()
    node = next(n for n in patch.graph.nodes if n.id == "guitar_string")
    node.params = {}
    patch.graph.connections = [e for e in patch.graph.connections if e.to_node_id != node.id]
    formulas = patch.graph.ui_layout["input_formulas"]
    patch.graph.ui_layout["input_formulas"] = {k: v for k, v in formulas.items() if not k.startswith(node.id + "::")}
    assert abs(audition([(0.1, 52, 100, 0.4)], 0.8, patch=patch)).max() == 0


@pytest.mark.parametrize("frequency", [82.4069, 110, 329.6276])
def test_output_dc_filter_preserves_musical_fundamentals(frequency):
    from types import SimpleNamespace

    from backend.app.services.compiler_waveguide import WAVEGUIDE_OPCODES

    orc = f"""sr=48000
ksmps=16
nchnls=2
0dbfs=1
{WAVEGUIDE_OPCODES}
instr 1
 aInput oscili .01, {frequency}
 aOutput vcs_wg_dc aInput
 aConstant = .01
 aDC vcs_wg_dc aConstant
 outs aOutput, aDC
endin
alwayson 1
"""
    x, _ = render(SimpleNamespace(orc=orc), [], [], 1.0, mode="host")
    # The old default dcblock2 lost 7–11 dB on the bass strings.
    gain_db = 20 * np.log10(rms(x[24000:, 0]) / (.01 / np.sqrt(2)))
    assert abs(gain_db) < .1
    assert abs(x[-4800:, 1]).max() < 1e-9


def harmonic_levels(audio, note):
    signal = audio[7680:19200, 0]  # 60–300 ms after the pluck at 100 ms.
    spectrum = abs(np.fft.rfft(signal * np.hanning(len(signal)), 131072))
    frequencies = np.fft.rfftfreq(131072, 1 / 48000)
    base = 440 * 2 ** ((note - 69) / 12)
    amplitudes = [spectrum[abs(frequencies - base * h) < 5].max() for h in [1, 2, 3]]
    return 20 * np.log10(np.array(amplitudes) / amplitudes[0])


@pytest.mark.parametrize("note", [43, 45, 64])
def test_reference_informed_harmonic_balance_and_body_blend(note):
    notes = [(.1, note, 100, .6)]
    default = audition(notes, .9)
    finger = audition(notes, .9, settings={"guitar_pick": 0})
    dark = audition(notes, .9, settings={"guitar_brightness": 0})
    direct = audition(notes, .9, settings={"guitar_body": 0})
    normal = harmonic_levels(default, note)
    # Broad musical bounds from the reference analysis, not a waveform snapshot
    # or an exact imitation of the recording's microphone/room coloration.
    assert normal[1] < 4
    assert normal[2] < -10
    for soft in [finger, dark]:
        assert harmonic_levels(soft, note)[2] < normal[2] - 5
    # Fixed seed and zero noise isolate the body contribution by subtraction.
    body = (default - direct)[7200:21600]
    assert rms(body) < rms(direct[7200:21600])
