"""Render MIDI-duration checks, then measure actual audio pitch and inspect plots."""

import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
WORK = HERE / "work/vibrato"
REPORT = HERE / "validation/vibrato.json"
SR = 48000
HOLDS = [0.03, 0.49, 0.499, 0.5, 1.0, 4.0]


def render_checks():
    sys.path.insert(0, str(ROOT))
    from build_guitar import build, graph_hash
    from backend.app.models.patch import PatchDocument
    from backend.tests.guitar_audio_support import compile_guitars, render, note_events, rms, db

    WORK.mkdir(parents=True, exist_ok=True)
    patch = PatchDocument.model_validate(build())
    baseline = patch.model_copy(deep=True)
    next(n for n in baseline.graph.nodes if n.id == "eg_vibrato_depth").params["ic"] = 0
    checks = []
    for mode in ["host", "midi", "score"]:
        artifact, targets = compile_guitars([patch], mode=mode)
        plain_artifact, plain_targets = compile_guitars([baseline], mode=mode)
        plain, _ = render(plain_artifact, plain_targets, note_events([(0.15, 71, 100, 4)]), 4, mode=mode)
        for hold in HOLDS:
            audio, _ = render(artifact, targets, note_events([(0.15, 71, 100, hold)]), 4, mode=mode)
            assert np.isfinite(audio).all() and abs(audio).max() < 0.98
            assert min(np.sqrt(np.mean(audio**2, axis=0))) > 1e-6
            delta = float(abs(audio - plain).max())
            if hold <= 0.5:
                assert delta < 1e-10, (mode, hold, delta)
            else:
                assert abs(audio[: round(0.649 * SR)] - plain[: round(0.649 * SR)]).max() < 1e-10
                assert delta > 0.001
            decay_error = abs(db(rms(audio[-SR:])) - db(rms(plain[-SR:])))
            assert decay_error < 0.05, (mode, hold, decay_error)
            np.save(WORK / f"{mode}_{hold}.npy", audio)
            checks.append(
                dict(
                    mode=mode,
                    hold_seconds=hold,
                    max_baseline_difference=delta,
                    late_decay_rms_difference_db=decay_error,
                    peak_dbfs=db(abs(audio).max()),
                )
            )
            print(mode, hold, "passed", flush=True)

    # Independent note clocks: a short note's tail must not acquire the later
    # note's vibrato. Compare the chord tail with individually rendered voices.
    artifact, targets = compile_guitars([patch], mode="host")
    notes = [(0.15, 71, 100, 0.1), (0.8, 76, 100, 4)]
    together, _ = render(artifact, targets, note_events(notes), 4, mode="host")
    separate = [render(artifact, targets, note_events([n]), 4, mode="host")[0] for n in notes]
    # Initial pick noise can use different random seeds between allocations.
    poly_error = float(abs(together[SR * 2 :] - sum(separate)[SR * 2 :]).max())
    assert poly_error < 1e-7, poly_error
    np.save(WORK / "polyphony.npy", together)

    settings = dict(eg_level=0, eg_tone=5000, eg_pickup=0.08, eg_pick=2, eg_width=0)
    artifact, targets = compile_guitars([patch], mode="host", settings=[settings])
    chord, _ = render(
        artifact, targets, note_events([(0.15, n, 127, 4) for n in [71, 74, 78, 83, 86, 88]]), 4, mode="host"
    )
    assert np.isfinite(chord).all() and abs(chord).max() < 0.98
    report = dict(
        passed=True,
        graph_sha256=graph_hash(patch.graph.model_dump(mode="json")),
        checks=checks,
        polyphonic_tail_max_difference=poly_error,
        held_stress_chord_peak_dbfs=db(abs(chord).max()),
        audio_pitch_checked=False,
        spectrograms_inspected=False,
        listening_performed=False,
    )
    REPORT.write_text(json.dumps(report, indent=2) + "\n")


def analyze():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.signal import butter, sosfiltfilt, find_peaks
    from scipy.ndimage import uniform_filter1d
    import soundfile as sf

    sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
    from render_spectrograms import Settings, analyze_audio, render_images

    report = json.loads(REPORT.read_text())
    assert report["passed"]
    fig, axes = plt.subplots(3, 1, figsize=(12, 9), sharex=True, layout="constrained")
    measurements = []
    for mode in ["host", "midi", "score"]:
        for hold in [0.49, 1.0, 4.0]:
            audio = np.load(WORK / f"{mode}_{hold}.npy")
            t = np.arange(len(audio)) / SR - 0.15
            frequency = 440 * 2 ** ((71 - 69) / 12)
            # Complex demodulation isolates the actual fundamental; pitch is
            # measured from rendered audio, not inferred from control formulas.
            analytic = sosfiltfilt(
                butter(4, 30, fs=SR, output="sos"), audio[:, 0] * np.exp(-2j * np.pi * frequency * (t + 0.15))
            )
            hz = frequency + np.gradient(np.unwrap(np.angle(analytic))) * SR / (2 * np.pi)
            cents = uniform_filter1d(1200 * np.log2(np.maximum(hz, 1) / frequency), size=240)

            def peak(start, end):
                return float(np.max(abs(cents[(t >= start) & (t < end)])))

            assert peak(0.2, 0.45) < 0.2
            assert peak(2.7, 3.2) < 0.2
            if hold < 0.5:
                assert peak(0.6, 3.2) < 0.2
            else:
                assert peak(0.6, 0.8) > 4
                if hold == 1:
                    assert peak(1.07, 3.2) < 0.2
                else:
                    assert 17 < peak(1.1, 1.4) < 21
                    assert peak(1.1, 1.4) > peak(0.6, 0.8)
                    assert peak(1.8, 2.2) < peak(1.1, 1.4)
                    peaks, _ = find_peaks(cents, distance=round(0.12 * SR), prominence=2)
                    pt = t[peaks]
                    pt = pt[(pt > 0.55) & (pt < 2.3)]
                    rates = 1 / np.diff(pt)
                    assert 4 < rates[0] < 5.5 and 5.8 < rates[-1] < 6.2
            measurements.append(
                dict(mode=mode, hold_seconds=hold, peak_cents=peak(0.6, 2.5), late_residual_cents=peak(2.7, 3.2))
            )
            if mode == "host":
                index = [0.49, 1.0, 4.0].index(hold)
                use = (t > 0.15) & (t < 3.4)
                axes[index].plot(t[use][::96], cents[use][::96], lw=1.1)
                axes[index].axvline(0.5, color="grey", ls="--", label="0.5 s delay")
                if hold < 3.4:
                    axes[index].axvline(hold, color="red", ls=":", label="Key release")
                axes[index].set(title=f"B4 · key held {hold:g} s", ylabel="Pitch offset (cents)", ylim=(-23, 23))
                axes[index].legend(loc="upper right")
    axes[-1].set_xlabel("Seconds after note-on")
    image = HERE / "validation/vibrato_pitch.png"
    fig.savefig(image, dpi=120)
    plt.close(fig)
    settings = Settings(n_fft=4096, hop_length=120, n_mels=96, fmin=200, fmax=7000, vmin=-110, vmax=-20)
    images = [str(image.relative_to(HERE))]
    pieces = []
    for hold in [0.49, 1.0, 4.0]:
        audio = np.load(WORK / f"host_{hold}.npy")
        images.extend(
            str(p.relative_to(HERE))
            for p in render_images(
                analyze_audio(audio, SR, settings), settings, Path(f"vibrato_{hold}.wav"), HERE / "validation"
            )
        )
        # Uniform gain and excerpt-only end fade; stored validation audio is untouched.
        piece = audio.copy() * 4
        piece[-1200:] *= np.linspace(1, 0, 1200)[:, None]
        pieces.extend([piece, np.zeros((12000, 2))])
    sf.write(HERE / "auditions/delayed_vibrato.wav", np.concatenate(pieces), SR, subtype="PCM_24")
    report.update(
        audio_pitch_checked=True,
        pitch_measurements=measurements,
        images=images,
        spectrograms_inspected=False,
        contour=dict(
            delay_seconds=0.5,
            rise_seconds=0.8,
            fade_seconds=1.2,
            peak_depth_cents=20,
            initial_rate_hz=4,
            final_rate_hz=6,
            pitch_smoothing_half_time_seconds=0.004,
        ),
    )
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print("Passed audio pitch checks in host MIDI, MIDI-file and SCORE modes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["render", "analyze"])
    args = parser.parse_args()
    render_checks() if args.action == "render" else analyze()
