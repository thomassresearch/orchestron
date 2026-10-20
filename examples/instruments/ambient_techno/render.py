"""Render representative phrases and controller comparisons at unchanged gain."""

import json
from pathlib import Path

from backend.tests.guitar_audio_support import compile_guitars, render, note_events
from backend.tools.tube_overdrive_audio import metrics, write_float_wav
from examples.instruments.ambient_techno.build import build_all


def main():
    folder = Path("output/ambient-techno")
    folder.mkdir(parents=True, exist_ok=True)
    sub, cloud = build_all()
    bass_notes = [(.2 + i * .75, n, v, .5)
                  for i, (n, v) in enumerate([(36, 100), (36, 80), (43, 110), (39, 90)] * 2)]
    chord = [(.2, n, 100, 12) for n in [48, 55, 58, 62]]
    scenarios = {
        "rounded_sub": (sub, {}, bass_notes, 8, []),
        "pure_sub": (sub, dict(ars_body=0, ars_warmth=0, ars_tone=2000), bass_notes, 8, []),
        "warm_pulse": (sub, dict(ars_body=.35, ars_warmth=.65, ars_pulse_depth=.25, ars_pulse_rate=1.2),
                       bass_notes, 8, []),
        "wavetable_cloud": (cloud, {}, chord, 20, []),
        "dark_drone": (cloud, dict(awc_position=.08, awc_tone=700, awc_shimmer=0, awc_motion=.015),
                       chord, 20, []),
        "shimmer": (cloud, dict(awc_position=.75, awc_shimmer=.4, awc_tone=10000, awc_width=.9),
                    chord, 20, []),
        "drifting_cloud": (cloud, dict(awc_scan=.4, awc_motion=.12, awc_drift=6, awc_detune=12, awc_width=1),
                           chord, 20, []),
        "eight_note_cloud": (cloud, {}, [(.2, n, 127, 8) for n in [36, 43, 48, 51, 55, 60, 63, 67]], 16, []),
    }
    for patch, prefix, cc in [(sub, "sub", 25), (cloud, "cloud", 102)]:
        for value in (0, 64, 127):
            scenarios[f"{prefix}_cc_{value}"] = (
                patch, {}, [(.2, 48, 100, 8)], 16,
                [(0, bytes([0xBF, cc, value]))],
            )
    report = {}
    for name, (patch, values, notes, seconds, events) in scenarios.items():
        artifact, targets = compile_guitars([patch], mode="host", settings=[values], ksmps=32)
        audio, _ = render(artifact, targets, note_events(notes) + events, seconds, mode="host")
        write_float_wav(folder / f"{name}.wav", audio)
        report[name] = dict(**metrics(audio), settings=values, notes=notes,
                            controllers=[(t, list(data)) for t, data in events])
        print(name, report[name]["peak"])
    (folder / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
