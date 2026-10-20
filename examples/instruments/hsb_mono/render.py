"""Render matching controller auditions and a musical preview from the explicit example."""

import json
from pathlib import Path

from backend.app.models.patch import PatchDocument
from backend.tools.hsb_mono_audio import compile_patch, render
from backend.tools.tube_overdrive_audio import metrics, write_float_wav

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parents[2] / "output" / "hsb_mono" / "audio"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    patch = PatchDocument.model_validate(dict(
        id="hsb-mono-audition", **json.loads((ROOT / "hsb_mono.patch.json").read_text())))
    score = "\n".join(f"i 1 {start} {length} {note} {velocity} {index} 1"
                      for index, (start, length, note, velocity) in enumerate([
                          (.1, .3, 48, 90), (.4, .3, 55, 90), (.71, .3, 60, 100),
                          (1.04, .3, 51, 80), (1.34, .3, 58, 110),
                          (1.65, .3, 63, 100), (2.1, .4, 48, 60),
                          (2.5, .4, 60, 120), (2.9, .5, 55, 100),
                      ], start=1))
    settings = {
        "hsb_mono": {},
        "tonality_min": {"hsb_tonality": 0}, "tonality_mid": {"hsb_tonality": .5},
        "tonality_max": {"hsb_tonality": 1},
        "brightness_min": {"hsb_brightness": -2}, "brightness_max": {"hsb_brightness": 2},
        "legato_min": {"hsb_legato_rate": .001}, "legato_max": {"hsb_legato_rate": .5},
    }
    report = {}
    for name, values in settings.items():
        audio, _ = render(compile_patch(patch, values=values), score=score, seconds=4)
        write_float_wav(OUT / f"{name}.wav", audio)
        report[name] = dict(**metrics(audio), settings=values)
    events = [(0.1, [0x90, 60, 100]), (3.2, [0x80, 60, 0])]
    for cc, start in [(20, .4), (74, 1.3), (5, 2.2)]:
        for offset, value in [(0, 1), (.3, 64), (.6, 127), (.8, 0)]:
            events.append((start + offset, [0xBF, cc, value]))
    events += [(2.25, [0x90, 67, 100]), (2.8, [0x80, 67, 0])]
    audio, _ = render(compile_patch(patch, mode="midi"), events=sorted(events), seconds=4)
    write_float_wav(OUT / "midi_controls.wav", audio)
    report["midi_controls"] = metrics(audio)
    (OUT / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    (OUT / "score.sco").write_text(score + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
