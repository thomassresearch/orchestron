"""Native controller auditions and measured harmonic-decay time ratios."""

import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
WORK = HERE / "work/pitch_decay"
REPORT = HERE / "validation/pitch_decay.json"
NOTES = [40, 52, 64, 71, 83, 88]
FACTORS = [0.25, 0.5, 1.0]
SR = 48000


def render_checks():
    sys.path.insert(0, str(ROOT))
    from build_guitar import build, graph_hash
    from range_voice import lifetime, pitch_decay_factor
    from backend.app.models.patch import PatchDocument
    from backend.tests.guitar_audio_support import compile_guitars, render, note_events, db

    WORK.mkdir(parents=True, exist_ok=True)
    patch = PatchDocument.model_validate(build())
    previous = PatchDocument.model_validate(json.loads((WORK / "before.patch.json").read_text()))
    old_artifact, old_targets = compile_guitars([previous], mode="host")
    checks = []
    for factor in FACTORS:
        settings = {"eg_pitch_decay": factor}
        artifact, targets = compile_guitars([patch], mode="host", settings=[settings])
        for note in NOTES:
            seconds = float(np.ceil(lifetime(note, {"eg_pitch_decay": 1}) + 1))
            events = note_events([(0.15, note, 100, 0.03)])
            audio, _ = render(artifact, targets, events, seconds, mode="host")
            assert np.isfinite(audio).all() and 1e-6 < abs(audio).max() < 0.98
            assert min(np.sqrt(np.mean(audio**2, axis=0))) > 1e-6
            # Allow the cabinet/DC filters to settle after the envelope gate.
            assert abs(audio[round((0.4 + lifetime(note, settings)) * SR) :]).max() < 1e-10, (note, factor)
            np.save(WORK / f"note_{note}_{factor}.npy", audio)
            compatibility = None
            if factor == 1 or note == 40:
                old, _ = render(old_artifact, old_targets, events, seconds, mode="host")
                compatibility = float(abs(audio - old).max())
                assert compatibility < 1e-9, (note, factor, compatibility)
            checks.append(
                dict(
                    note=note,
                    controller=factor,
                    time_scale=pitch_decay_factor(note, factor),
                    old_patch_max_sample_difference=compatibility,
                    peak_dbfs=db(abs(audio).max()),
                    silence_deadline_seconds=lifetime(note, settings),
                )
            )
            print(note, factor, "passed", flush=True)
    report = dict(
        passed=True,
        graph_sha256=graph_hash(patch.graph.model_dump(mode="json")),
        previous_graph_sha256=graph_hash(previous.graph.model_dump(mode="json")),
        checks=checks,
        decay_ratios_measured=False,
        spectrograms_inspected=False,
        listening_performed=False,
    )
    REPORT.write_text(json.dumps(report, indent=2) + "\n")


def analyze():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.signal import butter, sosfiltfilt
    import soundfile as sf

    sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
    from render_spectrograms import Settings, analyze_audio, render_images

    report = json.loads(REPORT.read_text())
    assert report["passed"]
    fig, axes = plt.subplots(2, 3, figsize=(14, 8), layout="constrained")
    measurements = []
    for ax, note in zip(axes.flat, NOTES):
        measured = {}
        for factor in FACTORS:
            audio = np.load(WORK / f"note_{note}_{factor}.npy")
            t = np.arange(len(audio)) / SR - 0.15
            hz = 440 * 2 ** ((note - 69) / 12)
            harmonic = sosfiltfilt(
                butter(4, 12, fs=SR, output="sos"), audio[:, 0] * np.exp(-2j * np.pi * hz * (t + 0.15))
            )
            level = 20 * np.log10(np.maximum(abs(harmonic), 1e-15))
            scale = factor ** (max(0, note - 40) / 31)
            # All profiles leave their initial decay segment by 0.7*scale s.
            start = max(0.5, 0.95 * scale)
            end = start + max(0.45, 1.5 * scale)
            use = (t > start) & (t < end)
            slope, _ = np.polyfit(t[use], level[use], 1)
            assert slope < -1, (note, factor, slope)
            measured[factor] = float(-60 / slope)
            use = (t >= 0.15) & (t < 8)
            ax.plot(t[use][::240], level[use][::240], label=f"B4 factor {factor:g}")
        for factor in FACTORS:
            ratio = measured[factor] / measured[1.0]
            expected = factor ** (max(0, note - 40) / 31)
            assert abs(ratio / expected - 1) < 0.025, (note, factor, ratio, expected)
            measurements.append(
                dict(
                    note=note,
                    controller=factor,
                    measured_late_t60_seconds=measured[factor],
                    measured_time_ratio=ratio,
                    expected_time_ratio=expected,
                )
            )
        ax.set(title=f"MIDI {note}", xlabel="Seconds after pick", ylabel="Fundamental level (dB)", ylim=(-120, -20))
        ax.legend(fontsize=8)
    image = HERE / "validation/pitch_decay_envelopes.png"
    fig.savefig(image, dpi=120)
    plt.close(fig)
    images = [str(image.relative_to(HERE))]
    settings = Settings(n_fft=2048, hop_length=240, n_mels=64, fmin=60, fmax=8000, vmin=-110, vmax=-20)
    for factor in FACTORS:
        audio = np.load(WORK / f"note_71_{factor}.npy")
        images.extend(
            str(p.relative_to(HERE))
            for p in render_images(
                analyze_audio(audio, SR, settings), settings, Path(f"pitch_decay_B4_{factor}.wav"), HERE / "validation"
            )
        )
    pieces = []
    for factor in [1.0, 0.5, 0.25]:
        piece = np.load(WORK / f"note_71_{factor}.npy")[: SR * 6].copy() * 4
        piece[-1200:] *= np.linspace(1, 0, 1200)[:, None]
        pieces.extend([piece, np.zeros((12000, 2))])
    sf.write(HERE / "auditions/pitch_decay_B4.wav", np.concatenate(pieces), SR, subtype="PCM_24")
    report.update(
        decay_ratios_measured=True,
        measurements=measurements,
        images=images,
        spectrograms_inspected=False,
        interpretation="Factor scales each note's existing natural decay; E2 and lower retain full time. B4 is MIDI 71, the open B3 string raised by 12 frets. Pitch alone cannot identify the actual string.",
    )
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print("Measured all decay ratios within 2.5% of the requested time scale.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["render", "analyze"])
    args = parser.parse_args()
    render_checks() if args.action == "render" else analyze()
