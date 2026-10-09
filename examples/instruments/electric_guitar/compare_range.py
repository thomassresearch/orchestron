"""Final fixed-scale spectrograms and auditions for the measured guitar range."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

import librosa
import matplotlib
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt, stft
from scipy.ndimage import uniform_filter1d

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SR = 48000


def main(reference_path):
    reference, sr = sf.read(reference_path, always_2d=True)
    assert sr == SR
    work = HERE / "work/range_validation"
    out = HERE / "validation"
    auditions = HERE / "auditions"
    rows = json.loads((out / "range_reference.json").read_text())["measurements"]
    render_report = json.loads((out / "range_render.json").read_text())
    assert render_report["passed"]
    selected = [40, 55, 71, 76, 80, 83]
    metrics = []
    pairs = []
    montages = {"Reference": [], "Updated": []}
    attack_panels = []
    images = []
    fig, axes = plt.subplots(6, 3, figsize=(17, 19), layout="constrained")
    for index, row in enumerate(rows):
        note = row["midi"]
        f0 = row["fundamental_hz"]
        hz = 440 * 2 ** ((note - 69) / 12)
        start = round((row["onset_seconds"] - 0.15) * SR)
        ref = reference[start : start + 38400]
        updated = np.load(work / f"pitch_{note}.npy")[: len(ref)]
        source = {"Reference": ref, "Updated": updated}
        baseline = HERE / f"work/range_fit/before/note_{note}.npy"
        if baseline.exists():
            source["Previous"] = np.load(baseline)[: len(ref)]
        times = np.arange(len(ref)) / SR - 0.15
        steady = (times >= 0.08) & (times < 0.25)
        levels = {}
        envelopes = {}
        for label, audio in source.items():
            magnitudes = []
            curves = []
            for partial in row["partials"]:
                center = (f0 if label == "Reference" else hz) * partial["ratio"]
                width = min(hz * 0.36, 140)
                filtered = sosfiltfilt(
                    butter(3, [center - width / 2, center + width / 2], "bandpass", fs=SR, output="sos"), audio, axis=0
                )
                power = uniform_filter1d(np.mean(filtered**2, axis=1), size=round(max(0.006, 3 / hz) * SR))
                if label == "Reference":
                    power = np.maximum(power - np.median(power[times < -0.05]), 0)
                magnitudes.append(float(np.sqrt(np.mean(power[steady]))))
                curves.append(np.sqrt(np.maximum(power, 0))[::240])
            magnitudes = np.asarray(magnitudes)
            levels[label] = 20 * np.log10(np.maximum(magnitudes / np.linalg.norm(magnitudes), 1e-6))
            envelopes[label] = np.sqrt(np.sum(np.asarray(curves) ** 2, axis=0))
        target = levels["Reference"]
        valid = target > max(target) - 40
        errors = {
            label: float(np.mean(abs(value[valid] - target[valid])))
            for label, value in levels.items()
            if label != "Reference"
        }
        gain = float(np.sqrt(np.mean(ref[steady] ** 2) / np.mean(updated[steady] ** 2)))
        window = (times[::240] >= 0.015) & (times[::240] < min(0.4, row["natural_fit_end_seconds"]))
        envelope_error = float(
            np.sqrt(np.mean((envelopes["Updated"][window] * gain - envelopes["Reference"][window]) ** 2))
            / max(envelopes["Reference"][window])
        )
        metrics.append(
            dict(
                midi=note,
                harmonic_level_mae_db=errors,
                constant_comparison_gain=gain,
                early_envelope_normalized_rmse=envelope_error,
            )
        )
        ax = axes.flat[index]
        for label, value in levels.items():
            ax.plot(np.arange(len(value)) + 1, value, label=label)
        ax.set(title=f"MIDI {note} · updated error {errors['Updated']:.2f} dB", ylim=(-65, 3))
        ax.legend(fontsize=6)
        if note in selected:
            # Equal-duration, equal-level excerpts; the reference's muting is not
            # copied into the instrument. This end fade is playback editing only.
            for label, audio in [("Reference", ref), ("Updated", updated * gain)]:
                piece = audio.copy()
                piece[-1200:] *= np.linspace(1, 0, 1200)[:, None]
                montages[label].append(piece)
                pairs.extend([piece, np.zeros((9600 if label == "Reference" else 16800, 2))])
            attack_panels.append((note, ref, updated * gain))
    path = out / "range_harmonics.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    images.append(str(path.relative_to(HERE)))
    sf.write(auditions / "full_range_reference_then_synth.wav", np.concatenate(pairs), SR, subtype="PCM_24")

    # Harmonic-resolution view plus high-time-resolution attack view. All plots
    # compare channel power on a fixed scale; no per-frame normalization occurs.
    for nfft, hop, label in [(2048, 120, "range"), (256, 24, "range_attack")]:
        for kind in ["stft", "mel"]:
            fig, axes = plt.subplots(2, len(selected), figsize=(18, 7), sharey=True, layout="constrained")
            for column, (note, ref, updated) in enumerate(attack_panels):
                for row, (name, audio) in enumerate([("Reference", ref), ("Synth", updated)]):
                    frequency, times, spectrum = stft(audio.T, SR, nperseg=nfft, noverlap=nfft - hop, axis=-1)
                    power = np.mean(abs(spectrum) ** 2, axis=0)
                    if kind == "mel":
                        bands = 24 if nfft == 256 else 64
                        power = librosa.filters.mel(sr=SR, n_fft=nfft, n_mels=bands, fmin=60, fmax=12000) @ power
                        frequency = librosa.mel_frequencies(n_mels=bands + 2, fmin=60, fmax=12000)[1:-1]
                    ax = axes[row, column]
                    mesh = ax.pcolormesh(
                        (times - 0.15) * 1000,
                        frequency,
                        10 * np.log10(np.maximum(power, 1e-16)),
                        shading="auto",
                        cmap="magma",
                        vmin=-105 if kind == "mel" else -80,
                        vmax=-40 if kind == "mel" else -15,
                    )
                    ax.set(
                        yscale="log",
                        ylim=(60, 12000),
                        xlim=(-10, 150 if nfft == 256 else 600),
                        title=f"{name} · {librosa.midi_to_note(note)}",
                    )
                    if row == 1:
                        ax.set_xlabel("ms from pick")
            fig.colorbar(mesh, ax=axes, label="Fixed-scale spectral power (dB re 1)")
            fig.suptitle(
                f"{kind.upper()} · Hann {nfft} ({1000 * nfft / SR:.2f} ms) · hop {hop} ({1000 * hop / SR:.2f} ms)"
            )
            path = out / f"{label}.{kind}.png"
            fig.savefig(path, dpi=130)
            plt.close(fig)
            images.append(str(path.relative_to(HERE)))

    # Inspect the entire untruncated natural decay separately from cropped A/B.
    sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
    from render_spectrograms import Settings, analyze_audio, render_images

    tail = np.load(work / "held_host_71.npy")
    sf.write(auditions / "picked_note_held_to_silence.wav", tail * 3, SR, subtype="PCM_24")
    settings = Settings(n_fft=2048, hop_length=240, n_mels=64, fmin=40, fmax=12000, vmin=-100, vmax=0)
    images.extend(
        str(p.relative_to(HERE))
        for p in render_images(analyze_audio(tail, SR, settings), settings, Path("held_note_decay.wav"), out)
    )
    report = dict(
        graph_sha256=render_report["graph_sha256"],
        source_user_provided=True,
        decoded_reference_sha256=hashlib.sha256(reference_path.read_bytes()).hexdigest(),
        fitted_midi_range=[40, 83],
        intermediate_semitones_native_tested=True,
        string_boundaries_estimated=True,
        reference_muting_excluded_from_decay_fit=True,
        measurements=metrics,
        median_harmonic_level_mae_db=float(np.median([m["harmonic_level_mae_db"]["Updated"] for m in metrics])),
        comparison_level_window_seconds=[0.08, 0.25],
        significant_partial_threshold_db=-40,
        source_tuning_normalized_to_midi=True,
        images=images,
        spectrograms_inspected=False,
        listening_performed=False,
        limitations="Fit errors describe the measured notes, not an independent perceptual test. Exact string boundaries are inferred. Unrecorded late tails use bounded exponential damping, not the manual mute events.",
    )
    (out / "range_comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    render_report.update(images=images, spectrograms_inspected=False)
    (out / "audio.json").write_text(json.dumps(render_report, indent=2) + "\n")
    print("Median harmonic-level error:", report["median_harmonic_level_mae_db"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=HERE / "work/range_fit/reference.wav")
    main(parser.parse_args().reference)
