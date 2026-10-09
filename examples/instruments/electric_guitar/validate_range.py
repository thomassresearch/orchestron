"""Native checks for picked-note lifetime, register profiles and rack controls."""

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from build_guitar import build, graph_hash  # noqa: E402
from electric_voice import CONTROLS, lifetime  # noqa: E402
from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.tests.guitar_audio_support import compile_guitars, render, note_events, rms, db, fundamental  # noqa: E402


def main():
    work = HERE / "work/range_validation"
    work.mkdir(parents=True, exist_ok=True)
    patch = PatchDocument.model_validate(build())
    artifact, targets = compile_guitars([patch], mode="host")
    checks = []

    def audition(name, notes, seconds, settings=None, mode="host", block=None):
        if settings or mode != "host" or block:
            a, t = compile_guitars([patch], mode=mode, settings=[settings or {}], ksmps=block)
        else:
            a, t = artifact, targets
        audio, _ = render(a, t, note_events(notes), seconds, mode=mode)
        assert np.isfinite(audio).all()
        peak = float(abs(audio).max())
        assert 1e-6 < peak < 0.98, (name, peak)
        assert min(np.sqrt(np.mean(audio**2, axis=0))) > 1e-6, name
        assert abs(audio.mean()) < 0.002, (name, "DC")
        np.save(work / (name + ".npy"), audio)
        checks.append(
            dict(
                name=name,
                notes=notes,
                seconds=seconds,
                settings=settings or {},
                mode=mode,
                peak_dbfs=db(peak),
                rms_dbfs=db(rms(audio)),
            )
        )
        print(name, round(db(peak), 2), flush=True)
        return audio

    # Every semitone, including unmeasured keys between the fitted anchors.
    tuning = []
    for note in range(38, 89):
        audio = audition(f"pitch_{note}", [(0.15, note, 100, 0.03)], 0.8)
        expected = 440 * 2 ** ((note - 69) / 12)
        measured = fundamental(audio[round(0.25 * 48000) : round(0.70 * 48000)].mean(axis=1), expected)
        cents = float(1200 * np.log2(measured / expected))
        assert abs(cents) < 12, (note, cents)
        tuning.append(dict(note=note, cents=cents))

    independence = []
    for mode in ["host", "midi", "score"]:
        for note in [40, 55, 71, 83] if mode == "host" else [71]:
            seconds = float(np.ceil(lifetime(note) + 1))
            tap = audition(f"tap_{mode}_{note}", [(0.15, note, 100, 0.03)], seconds, mode=mode)
            held = audition(f"held_{mode}_{note}", [(0.15, note, 100, seconds + 5)], seconds, mode=mode)
            # Held notes now have pitch vibrato after 0.5 s, but their attack
            # and natural amplitude decay must still match a short tap.
            delta = float(abs(tap[: round(0.64 * 48000)] - held[: round(0.64 * 48000)]).max())
            assert delta < 1e-8, (mode, note, delta)
            envelope_error = max(
                abs(db(rms(tap[start : start + 24000])) - db(rms(held[start : start + 24000])))
                for start in range(round(0.7 * 48000), len(tap) - 24000, 24000)
                if rms(tap[start : start + 24000]) > 1e-7
            )
            assert envelope_error < 0.5, (mode, note, envelope_error)
            assert abs(held[-24000:]).max() < 1e-10, (mode, note, "held note still rings")
            independence.append(
                dict(
                    mode=mode,
                    note=note,
                    maximum_sample_difference_before_vibrato=delta,
                    maximum_decay_window_rms_difference_db=envelope_error,
                    held_silence_dbfs=db(abs(held[-24000:]).max()),
                    silence_deadline_seconds=lifetime(note),
                )
            )

    # Modes must retain the same timbre and envelope, not only compile.
    mode_audio = [np.load(work / f"tap_{mode}_71.npy") for mode in ["host", "midi", "score"]]
    mode_spread = max(db(rms(a)) for a in mode_audio) - min(db(rms(a)) for a in mode_audio)
    assert mode_spread < 0.1, mode_spread
    control_effects = {}
    for identity, _, low, high, _, _ in CONTROLS:
        note = 76 if identity == "eg_pick" else (71 if identity == "eg_pitch_decay" else 52)
        pair = []
        for name, value in [("min", low), ("max", high)]:
            settings = {identity: value}
            seconds = float(np.ceil(lifetime(note, settings) + 1))
            audio = audition(identity + "_" + name, [(0.15, note, 100, 0.03)], seconds, settings)
            assert abs(audio[-24000:]).max() < 1e-10, (identity, name, "tail")
            pair.append(audio)
        length = max(map(len, pair))
        a, b = [np.pad(v, ((0, length - len(v)), (0, 0))) for v in pair]
        if identity == "eg_pick":
            # A pick control should change contact, not the long ringing body.
            assert rms(a[round(0.4 * 48000) :] - b[round(0.4 * 48000) :]) < 1e-5
            a, b = a[7200:11040], b[7200:11040]
        difference = rms(a - b) / max(rms(a), rms(b))
        assert difference > 0.03, (identity, difference)
        control_effects[identity] = difference
    pick_levels = {}
    for note in [71, 76, 83]:
        levels = []
        for strength in [0, 1, 2]:
            audio = audition(f"pick_{note}_{strength}", [(0.15, note, 100, 0.03)], 0.8, {"eg_pick": strength})
            levels.append(db(rms(audio[7200:10080])))
        assert levels[0] < levels[1] < levels[2], (note, levels)
        pick_levels[note] = levels
    mono = np.load(work / "eg_width_min.npy")
    np.testing.assert_allclose(mono[:, 0], mono[:, 1], atol=1e-12)

    velocities = []
    for velocity in [24, 48, 80, 127]:
        audio = audition(f"velocity_{velocity}", [(0.15, 57, velocity, 0.03)], 1.5)
        velocities.append(db(rms(audio)))
    assert all(b > a + 2 for a, b in zip(velocities, velocities[1:])), velocities
    for drive in [0, 9, 18]:
        settings = dict(eg_level=0, eg_drive=drive, eg_decay=12, eg_tone=5000, eg_width=0, eg_pickup=0.08)
        audition(f"headroom_{drive}", [(0.15, n, 127, 0.03) for n in [40, 47, 52, 56, 59, 64]], 3, settings)
    audition(
        "high_pick_headroom",
        [(0.15, n, 127, 0.03) for n in [71, 74, 78, 83, 86, 88]],
        3,
        dict(eg_level=0, eg_drive=0, eg_tone=5000, eg_pickup=0.08, eg_pick=2, eg_width=0),
    )
    audition("rapid_retriggers", [(0.15 + i * 0.12, 57, 110, 0.03) for i in range(12)], 6)
    block_levels = {}
    for block in [1, 16, 64]:
        audio = audition(f"block_{block}", [(0.16, 45, 100, 0.03), (0.20, 57, 85, 0.03)], 2, block=block)
        block_levels[block] = db(rms(audio))
    assert max(block_levels.values()) - min(block_levels.values()) < 0.1, block_levels
    report = dict(
        passed=True,
        graph_sha256=graph_hash(patch.graph.model_dump(mode="json")),
        auditions=checks,
        tuning=tuning,
        note_duration_independence=independence,
        controller_relative_differences=control_effects,
        pick_strength_attack_rms_dbfs=pick_levels,
        velocity_rms_dbfs=velocities,
        input_mode_rms_spread_db=mode_spread,
        block_size_rms_dbfs=block_levels,
        listening_performed=False,
        spectrograms_inspected=False,
    )
    (HERE / "validation/range_render.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASSED", len(checks), "auditions", flush=True)


if __name__ == "__main__":
    main()
