"""Validate/render the saved drumkit without changing the live library.

Run: .venv/bin/python examples/instruments/analog_drumkit/validate_audio.py OUTPUT_DIR
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.app.models.patch import PatchDocument
from backend.tools.analog_drumkit_audio import compile_kit, render

HERE = Path(__file__).resolve().parent
NOTES = [35, 36, 37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 54]
CONTROLS = {
    "bd_snappiness": [35, 36], "hihat_tuning": [42, 46], "snare_tuning": [38],
    "side_stick_tuning": [37], "clap_decay": [39], "electric_snare_snap": [40],
    **{f"tom_{n}_tuning": [n] for n in [41, 43, 45, 47, 48, 50]},
    "crash_decay": [49], "ride_brightness": [51], "tambourine_decay": [54],
}


def load(path):
    return PatchDocument.model_validate_json(path.read_text())


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    patch = load(HERE.parent / "Analog_Drumkit.orch.instrument.json")
    baseline = load(HERE / "Analog_Drumkit.original.orch.instrument.json")
    defaults = compile_kit(patch)
    report = {"legacy_max_difference": {}, "renders": {}, "controllers": {}, "legacy_over_unity": {}}

    def save(name, samples):
        assert np.isfinite(samples).all(), name
        peaks = np.max(np.abs(samples), axis=0)
        rms = np.sqrt(np.mean(samples ** 2, axis=0))
        sf.write(out / (name + ".wav"), samples, 48000, subtype="FLOAT")
        report["renders"][name] = dict(peak=peaks.tolist(), rms=rms.tolist())
        return peaks

    before = compile_kit(baseline)
    for note in [35, 36, 38, 42, 46]:
        events = [(.1, note, 100, .025)]
        a, b = render(before, events, 1.2), render(defaults, events, 1.2)
        difference = float(np.max(np.abs(a - b)))
        report["legacy_max_difference"][str(note)] = difference
        np.testing.assert_allclose(a, b, atol=1e-12, rtol=1e-12)
    # The raw starter has a distinct historical gain/drive. Preserve it too.
    template = compile_kit(load(HERE.parent / "template/analog_drumkit.patch.json"))
    original_template = compile_kit(load(HERE / "analog_drumkit.original.patch.json"))
    for note in [35, 36, 38, 42, 46]:
        events = [(.1, note, 100, .025)]
        np.testing.assert_allclose(render(template, events, 1.2), render(original_template, events, 1.2), atol=1e-12, rtol=1e-12)

    for note in NOTES:
        soft = render(defaults, [(.1, note, 40, .02)], 3)
        hard = render(defaults, [(.1, note, 127, .02)], 3)
        save(f"note_{note}", hard)
        if note in [35, 36, 38, 42, 46]:
            original_hard = render(before, [(.1, note, 127, .02)], 3)
            np.testing.assert_allclose(original_hard, hard, atol=1e-12, rtol=1e-12)
            if np.max(np.abs(hard)) >= 1:
                report["legacy_over_unity"][str(note)] = float(np.max(np.abs(hard)))
        else:
            assert np.max(np.abs(hard)) < 1, note
        assert np.sqrt(np.mean(hard ** 2)) > .001, note
        np.testing.assert_allclose(soft * (127 / 40), hard, rtol=1e-9, atol=1e-10)
        assert np.max(np.abs(hard[-4800:])) < 1e-7, note
    silent = render(defaults, [(.1 + i * .1, note, 127, .02) for i, note in enumerate([0, 34, 44, 52, 53, 55, 81, 127])], 2)
    assert np.max(np.abs(silent)) == 0

    nodes = {n.id: n for n in patch.graph.nodes}
    comparison_clips = []
    for key, notes in CONTROLS.items():
        events = [(.1 + i * 3, note, 100, .02) for i, note in enumerate(notes)]
        duration = 3 * len(notes)
        reference = render(defaults, events, duration)
        report["controllers"][key] = {}
        for setting in ["min", "default", "max"]:
            value = nodes[key].params[setting]
            samples = render(compile_kit(patch, {key: value}), events, duration)
            peaks = save(key + "_" + setting, samples)
            assert peaks.max() < 1, (key, setting, peaks)
            delta = float(np.sqrt(np.mean((samples - reference) ** 2)))
            if setting != "default":
                assert delta > .0001, (key, setting, delta)
            report["controllers"][key][setting] = dict(value=value, difference_rms=delta)
            comparison_clips.append(samples)
    save("controller_comparisons", np.concatenate(comparison_clips))

    events = [(.1 + i * 3, note, 110, .02) for i, note in enumerate(NOTES)]
    duration = 3 * len(NOTES)
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000))
    last = 0
    for start, note, velocity, held in events:
        tick = round(start * 960)
        track.append(mido.Message("note_on", channel=9, note=note, velocity=velocity, time=tick-last))
        length = round(held * 960)
        track.append(mido.Message("note_off", channel=9, note=note, velocity=0, time=length))
        last = tick + length
    track.append(mido.MetaMessage("end_of_track", time=round(duration * 960) - last))
    midi_path = out / "all_voices.mid"
    midi.save(midi_path)
    save("all_voices", render(compile_kit(patch, mode="midi"), [], duration, midi_path))

    # Two-bar breakbeat with ghost snares, layered clap, cymbals and a tom fill.
    events = []
    step = 60 / 132 / 4
    for bar in range(4):
        for s in [0, 6, 10]:
            events.append((.1 + (bar*16+s)*step, 35, 100, .025))
        for s in [4, 12]:
            events.append((.1 + (bar*16+s)*step, 38, 100, .025))
            if bar % 2:
                events.append((.1 + (bar*16+s)*step, 39, 70, .025))
        for s in [3, 7, 11, 14]:
            events.append((.1 + (bar*16+s)*step, 38, 32, .018))
        for s in range(0, 16, 2):
            events.append((.1 + (bar*16+s)*step, 46 if s == 14 else 42, 65 if s % 4 else 85, .02))
        for s in [2, 6, 10, 14]:
            events.append((.1 + (bar*16+s)*step, 54, 60, .02))
        if bar == 0:
            events.append((.1, 49, 80, .02))
        if bar == 3:
            for s, note in zip(range(10, 16), [50, 48, 47, 45, 43, 41]):
                events.append((.1 + (bar*16+s)*step, note, 90, .02))
    demo = render(defaults, sorted(events), .1 + 64*step + 3)
    # Fixed -6.02 dB audition trim, not peak normalization or a patch gain change.
    report["layered_audition_gain"] = .5
    assert save("Analog_Drumkit_breakbeat", demo * .5).max() < 1
    # Retriggers and practical layered hits retain both channels and finish cleanly.
    retriggers = [(.1 + i*.04, 40, 110, .015) for i in range(12)]
    retriggers += [(1.2, n, 90, .02) for n in [35, 38, 42, 49, 54]]
    poly = render(defaults, retriggers, 5)
    assert save("retriggers_polyphony", poly * .5).max() < 1
    assert np.max(np.abs(poly[-4800:])) < 1e-7
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"legacy_max_difference": report["legacy_max_difference"],
                      "voices": len(NOTES), "controls_tested": len(CONTROLS),
                      "max_peak": max(max(v["peak"]) for v in report["renders"].values())}))


if __name__ == "__main__":
    main()
