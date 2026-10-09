"""Native MIDI/DSP checks and fixed-scale spectrograms for the electric guitar."""

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


def phrase():
    """Reference-informed F# minor / A / D voicings; not an exact transcription."""
    notes = []
    for start, length, bass, upper in [
        (0.04, 1.29, 42, [54, 57, 61]),
        (1.33, 1.97, 45, [57, 61, 64]),
        (3.30, 3.50, 38, [50, 57, 61]),
        (6.80, 1.50, 42, [54, 57, 61]),
        (8.30, 0.65, 45, [57, 61, 64]),
    ]:
        for t in np.arange(start, start + length - 0.10, 0.436):
            notes.append((float(t), bass, 102, min(0.43, start + length - t)))
        for index, t in enumerate(np.arange(start + 0.018, start + length - 0.10, 0.218)):
            voicing = upper if index % 2 == 0 else upper[1:]
            for string, pitch in enumerate(voicing):
                notes.append(
                    (float(t) + string * 0.012, pitch, [86, 101, 92, 78][index % 4], min(0.36, start + length - t))
                )
    return sorted(notes)


def render_auditions(probe=False):
    from build_guitar import build, CONTROLS, graph_hash
    from backend.app.models.patch import PatchDocument
    from backend.tests.guitar_audio_support import compile_guitars, render, note_events, fundamental, rms, db

    patch = PatchDocument.model_validate(build())
    work = HERE / "work"
    work.mkdir(exist_ok=True)
    runs = [("reference_phrase", {}, phrase(), 10, "host"), ("matched_note", {}, [(0.15, 71, 100, 0.6)], 1.3, "host")]
    if not probe:
        runs += [
            (
                "registers",
                {},
                [(0.15 + i * 0.8, n, 100, 0.6) for i, n in enumerate([38, 42, 52, 64, 76, 88])],
                5.8,
                "host",
            ),
            ("velocity", {}, [(0.15 + i * 0.9, 57, v, 0.6) for i, v in enumerate([24, 48, 80, 127])], 4.4, "host"),
            (
                "release_chords",
                {},
                [(0.15 + i * 0.02, n, 100, 0.5 + i * 0.25) for i, n in enumerate([40, 47, 52, 56, 59, 64])],
                3,
                "host",
            ),
            ("retriggers", {}, [(0.15 + i * 0.22, 57, 90, 0.16) for i in range(9)], 3, "host"),
        ]
        # Same musical input, delivered by the three supported native paths.
        for mode in ["host", "midi", "score"]:
            runs.append(
                ("mode_" + mode, {}, [(0.15, 45, 100, 0.8), (0.19, 57, 85, 0.9), (0.23, 61, 90, 0.9)], 2.5, mode)
            )
        controller_notes = [(0.15, 52, 100, 1.3)]
        runs.append(("controller_default", {}, controller_notes, 3, "host"))
        for identity, _, low, high, _, _ in CONTROLS:
            for side, value in [("min", low), ("max", high)]:
                runs.append((identity + "_" + side, {identity: value}, controller_notes, 3, "host"))
        for drive in [0, 9, 18]:
            runs.append(
                (
                    "headroom_" + str(drive),
                    {
                        "eg_level": 0,
                        "eg_drive": drive,
                        "eg_decay": 12,
                        "eg_tone": 5000,
                        "eg_width": 0,
                        "eg_pickup": 0.08,
                    },
                    [(0.15, n, 127, 1.2) for n in [40, 47, 52, 56, 59, 64]],
                    3,
                    "host",
                )
            )
    results = []
    for name, settings, notes, seconds, mode in runs:
        artifact, targets = compile_guitars([patch], mode=mode, settings=[settings])
        audio, _ = render(artifact, targets, note_events(notes), seconds, mode=mode)
        assert audio.shape == (round(seconds * 48000), 2) and np.isfinite(audio).all()
        assert 1e-6 < abs(audio).max() < 0.98, (name, abs(audio).max())
        assert min(np.sqrt(np.mean(audio**2, axis=0))) > 1e-6, name
        assert abs(audio[-4800:]).max() < 1e-8, (name, "release did not finish")
        assert abs(audio.mean()) < 0.002, (name, "DC")
        np.save(work / (name + ".npy"), audio)
        result = dict(
            name=name,
            settings=settings,
            notes=notes,
            duration=seconds,
            input_mode=mode,
            peak_dbfs=db(abs(audio).max()),
            rms_dbfs=db(rms(audio)),
            tail_dbfs=db(abs(audio[-4800:]).max()),
        )
        results.append(result)
        print(f"{name}: peak {result['peak_dbfs']:.2f} dBFS", flush=True)
    if probe:
        return
    tuning = []
    audio = np.load(work / "registers.npy")
    for start, note, _, _ in next(r["notes"] for r in results if r["name"] == "registers"):
        expected = 440 * 2 ** ((note - 69) / 12)
        measured = fundamental(
            audio[round((start + 0.1) * 48000) : round((start + 0.5) * 48000)].mean(axis=1), expected
        )
        cents = float(1200 * np.log2(measured / expected))
        assert abs(cents) < 10, (note, cents)
        tuning.append(dict(note=note, hz=measured, cents=cents))
    audio = np.load(work / "velocity.npy")
    levels = [db(rms(audio[round((0.18 + i * 0.9) * 48000) : round((0.65 + i * 0.9) * 48000)])) for i in range(4)]
    assert all(b > a + 2 for a, b in zip(levels, levels[1:])), levels
    mono = np.load(work / "eg_width_min.npy")
    np.testing.assert_allclose(mono[:, 0], mono[:, 1], atol=1e-12)
    mode_levels = [r["rms_dbfs"] for r in results if r["name"].startswith("mode_")]
    assert max(mode_levels) - min(mode_levels) < 0.6, mode_levels
    block_levels = {}
    for block in [1, 16, 64]:
        artifact, targets = compile_guitars([patch], mode="host", ksmps=block)
        audio, _ = render(artifact, targets, note_events([(0.16, 45, 100, 0.8), (0.20, 57, 85, 0.9)]), 2, mode="host")
        assert np.isfinite(audio).all() and abs(audio).max() < 0.98
        block_levels[block] = db(rms(audio))
    assert max(block_levels.values()) - min(block_levels.values()) < 0.6, block_levels
    # Ensure each knob has an audible effect, not just a persisted parameter.
    controller_differences = {}
    for identity, *_ in CONTROLS:
        low = np.load(work / (identity + "_min.npy"))
        high = np.load(work / (identity + "_max.npy"))
        relative = rms(high - low) / max(rms(low), rms(high))
        assert relative > 0.03, (identity, relative)
        controller_differences[identity] = relative
    dump(
        HERE / "validation/render.json",
        dict(
            passed=True,
            graph_sha256=graph_hash(patch.graph.model_dump(mode="json")),
            auditions=results,
            tuning=tuning,
            velocity_rms_dbfs=levels,
            input_mode_rms_spread_db=max(mode_levels) - min(mode_levels),
            block_size_rms_dbfs=block_levels,
            controller_relative_differences=controller_differences,
        ),
    )


def analyze():
    import soundfile as sf

    sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
    from render_spectrograms import Settings, analyze_audio, render_images

    report = json.loads((HERE / "validation/render.json").read_text())
    out = HERE / "auditions"
    out.mkdir(exist_ok=True)
    montage, timeline, cursor = [], [], 0
    for run in report["auditions"]:
        audio = np.load(HERE / "work" / (run["name"] + ".npy"))
        if run["name"] in ["reference_phrase", "registers", "release_chords", "retriggers", "matched_note"]:
            sf.write(out / (run["name"] + ".wav"), audio, 48000, subtype="PCM_24")
        timeline.append(dict(name=run["name"], start=cursor, end=cursor + run["duration"]))
        montage += [audio, np.zeros((12000, 2))]
        cursor += run["duration"] + 0.25
    settings = Settings(n_fft=4096, hop_length=256, fmax=14000, vmin=-100, vmax=0)
    sources = {
        "validation_montage": np.concatenate(montage),
        "reference_phrase": np.load(HERE / "work/reference_phrase.npy"),
    }
    images = []
    for name, audio in sources.items():
        images.extend(
            render_images(analyze_audio(audio, 48000, settings), settings, Path(name + ".wav"), HERE / "validation")
        )
    report.update(
        spectrograms_inspected=False,
        listening_performed=False,
        montage_timeline=timeline,
        spectrogram_settings=dict(n_fft=4096, hop_length=256, fmax=14000, vmin=-100, vmax=0),
        images=[str(p.relative_to(HERE)) for p in images],
    )
    dump(HERE / "validation/audio.json", report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["probe", "render", "analyze"])
    args = parser.parse_args()
    if args.action == "analyze":
        analyze()
    else:
        render_auditions(probe=args.action == "probe")
