"""Render native MIDI/SCORE auditions, measure them, then generate final spectrograms."""

import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def compare_baseline(work, patch, legato):
    from backend.app.models.patch import PatchDocument
    from backend.tests.saxophone_audio_support import (
        compile_instruments, render, note_events, section, upper_harmonic_fraction, rms, db,
    )
    from build_saxophone import graph_hash

    baseline = PatchDocument.model_validate_json((HERE / "baseline/original.patch.json").read_text())
    notes = [(.15 + i * .8, note, velocity, .6)
             for i, (note, velocity) in enumerate((n, v) for n in [44, 48, 55, 60, 67, 72, 76]
                                                 for v in [64, 80, 96])]
    report = {"notes": notes, "baseline_graph_sha256": graph_hash(baseline.graph.model_dump(mode="json"))}
    for name, source in [("before", baseline), ("after", patch)]:
        artifact, targets = compile_instruments([source], mode="host")
        audio, _ = render(artifact, targets, note_events(notes), 17.5, mode="host")
        np.save(work / f"spectrum_{name}.npy", audio)
        rows = []
        for start, note, velocity, _ in notes:
            segment = section(audio, start + .3, start + .56)
            rows.append(dict(note=note, velocity=velocity,
                             upper_harmonic_fraction=upper_harmonic_fraction(segment, 440 * 2 ** ((note - 69) / 12))))
        report[name] = rows
    artifact, targets = compile_instruments([baseline], mode="host")
    before, _ = render(artifact, targets, note_events(legato), 7.2, mode="host")
    after = np.load(work / "legato_host.npy")
    np.save(work / "comparison_before_raw.npy", before)
    np.save(work / "comparison_after_raw.npy", after)
    # One gain per complete performance retains musical dynamics. Keep both
    # previews at the same RMS, with at least 3 dB peak headroom after matching.
    target = min(10 ** (-23 / 20), *(0.65 * rms(a) / abs(a).max() for a in [before, after]))
    gains = {}
    for name, audio in [("before", before), ("after", after)]:
        gain = target / rms(audio)
        np.save(work / f"comparison_{name}.npy", audio * gain)
        gains[name] = gain
    report.update(preview_gain=gains, preview_rms_dbfs=db(target), listening_performed=False)
    return report


def render_auditions(work):
    from build_saxophone import CONTROLS, STEM, graph_hash
    from backend.app.models.patch import PatchDocument
    from backend.tests.saxophone_audio_support import (
        compile_instruments, render, note_events, fundamental, rms, db, section, spectrum_metrics,
    )

    work.mkdir(parents=True, exist_ok=True)
    patch = PatchDocument.model_validate_json((HERE / f"{STEM}.patch.json").read_text())
    velocities = [32, 64, 96, 108, 115, 120, 127]
    velocity_notes = [(.15 + (r * 7 + i) * .75, note, vel, .5)
                      for r, note in enumerate([44, 60, 76]) for i, vel in enumerate(velocities)]
    registers = [(.15 + i * .7, note, 80, .45) for i, note in enumerate([44, 48, 55, 60, 67, 72, 76])]
    legato = [(.15, 55, 64, .7), (.75, 60, 96, .6), (1.25, 67, 108, .6), (1.75, 64, 127, .65),
              (2.3, 60, 80, .6), (3.2, 44, 80, 1.7), (3.7, 76, 96, .6), (5.15, 60, 48, .5),
              (5.55, 60, 127, .65), (6.1, 60, 64, .6)]
    probe = [(.15, 60, 96, .7), (.85, 60, 127, .75), (1.6, 60, 64, .45)]
    runs = [("velocity", {}, velocity_notes, 16.5, "host"), ("registers", {}, registers, 5.4, "host")]
    runs += [("legato_" + mode, {}, legato, 7.2, mode) for mode in ["host", "midi", "score"]]
    runs.append(("control_default", {}, probe, 2.5, "host"))
    for identity, _, _ in CONTROLS:
        for label, value in [("min", 0), ("max", 1)]:
            runs.append((identity + "_" + label, {identity: value}, probe, 2.5, "host"))
    runs.append(("all_controls_max", {key: 1 for key, _, _ in CONTROLS}, velocity_notes, 16.5, "host"))
    reports = []
    for name, controls, notes, seconds, mode in runs:
        artifact, targets = compile_instruments([patch], mode=mode, settings=[controls])
        audio, _ = render(artifact, targets, note_events(notes), seconds, mode=mode)
        assert np.isfinite(audio).all() and audio.shape == (round(seconds * 48000), 2)
        assert .001 < abs(audio).max() < 10 ** (-3 / 20), (name, db(abs(audio).max()))
        assert abs(audio[-4800:]).max() < 1e-8, (name, "release")
        np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=1e-12)
        assert abs(audio.mean()) < .001, (name, "DC")
        np.save(work / (name + ".npy"), audio)
        reports.append(dict(name=name, settings=controls, notes=notes, duration=seconds, input_mode=mode,
                            peak_dbfs=db(abs(audio).max()), rms_dbfs=db(rms(audio)),
                            tail_dbfs=db(abs(audio[-4800:]).max())))
        print(name, "peak", round(reports[-1]["peak_dbfs"], 2), "dBFS", flush=True)
    audio = np.load(work / "registers.npy")
    tuning = []
    for start, note, _, _ in registers:
        hz = 440 * 2 ** ((note - 69) / 12)
        measured = fundamental(section(audio, start + .12, start + .42), hz)
        cents = float(1200 * np.log2(measured / hz))
        tuning.append(dict(note=note, measured_hz=measured, cents=cents))
        assert abs(cents) < 15, tuning[-1]
    audio = np.load(work / "velocity.npy")
    velocity_results = []
    for start, note, vel, _ in velocity_notes:
        metrics = spectrum_metrics(section(audio, start + .15, start + .47), 440 * 2 ** ((note - 69) / 12))
        velocity_results.append(dict(note=note, velocity=vel, **metrics))
    for note in [44, 60, 76]:
        rows = [r for r in velocity_results if r["note"] == note]
        assert rows[1]["rms_dbfs"] > rows[0]["rms_dbfs"] + 5
        assert rows[2]["rms_dbfs"] > rows[1]["rms_dbfs"] + 3
        assert rows[-1]["octave_to_fundamental"] > rows[2]["octave_to_fundamental"] * 1.5, rows
    modes = [r for r in reports if r["name"].startswith("legato_")]
    spread = max(r["rms_dbfs"] for r in modes) - min(r["rms_dbfs"] for r in modes)
    assert spread < 1, spread
    dump(HERE / "validation/render.json", dict(passed=True, graph_sha256=graph_hash(patch.graph.model_dump(mode="json")),
                                               auditions=reports, tuning=tuning, velocity_response=velocity_results,
                                               input_mode_rms_spread_db=spread,
                                               comparison=compare_baseline(work, patch, legato)))


def analyze(work):
    import soundfile as sf
    sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
    from render_spectrograms import Settings, analyze_audio, render_images

    report = json.loads((HERE / "validation/render.json").read_text())
    auditions = HERE / "auditions"
    auditions.mkdir(exist_ok=True)
    settings = Settings(n_fft=4096, hop_length=256, fmax=14000, vmin=-100, vmax=0)
    controls = [r for r in report["auditions"] if r["name"] == "control_default" or r["name"].startswith("sax_")]
    control_audio = np.concatenate([np.load(work / (r["name"] + ".npy")) for r in controls])
    sources = {name: np.load(work / (name + ".npy")) for name in ["velocity", "registers", "legato_host"]}
    sources["controls"] = control_audio
    images = []
    for name, audio in sources.items():
        sf.write(auditions / (name + ".wav"), audio, 48000, subtype="FLOAT")
        images.extend(render_images(analyze_audio(audio, 48000, settings), settings,
                                    Path(name + ".wav"), HERE / "validation"))
    for name in ["comparison_before", "comparison_after", "comparison_before_raw", "comparison_after_raw",
                 "spectrum_before", "spectrum_after"]:
        audio = np.load(work / (name + ".npy"))
        sf.write(auditions / (name + ".wav"), audio, 48000, subtype="FLOAT")
        if name in {"comparison_before", "comparison_after"}:
            images.extend(render_images(analyze_audio(audio, 48000, settings), settings,
                                        Path(name + ".wav"), HERE / "validation"))
    report.update(spectrograms_inspected=False, listening_performed=False,
                  controller_montage=[dict(name=r["name"], start=i * 2.5, end=(i + 1) * 2.5) for i, r in enumerate(controls)],
                  spectrogram_settings=dict(n_fft=4096, hop_length=256, fmax=14000, vmin=-100, vmax=0),
                  images=[str(p.relative_to(HERE)) for p in images])
    dump(HERE / "validation/audio.json", report)
    print("Saved auditions, raw/level-matched comparisons and twelve spectrograms; visual inspection pending.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["render", "analyze"])
    parser.add_argument("--work-dir", type=Path, default=Path("/tmp/orchestron-tenor-saxophone"))
    args = parser.parse_args()
    {"render": render_auditions, "analyze": analyze}[args.action](args.work_dir)
