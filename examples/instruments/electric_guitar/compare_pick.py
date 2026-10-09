"""Review the high-note contact revision against the source and prior voice."""

import json
from pathlib import Path

import librosa
import matplotlib
import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, sosfilt, stft

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
SR = 48000
NOTES = [71, 76, 80, 83]


def main():
    reference, sr = sf.read(HERE / "work/range_fit/reference.wav", always_2d=True)
    assert sr == SR
    rows = json.loads((HERE / "validation/range_reference.json").read_text())["measurements"]
    renders = json.loads((HERE / "validation/range_render.json").read_text())
    assert renders["passed"]
    before = HERE / "work/pick_revision/before"
    work = HERE / "work/range_validation"
    out = HERE / "validation"
    pairs, panels, metrics = [], [], []
    bands = [(60, 12000), (2000, 5000), (5000, 10000)]
    fig, axes = plt.subplots(len(bands), len(NOTES), figsize=(16, 10), layout="constrained")
    for col, note in enumerate(NOTES):
        row = next(r for r in rows if r["midi"] == note)
        start = round((row["onset_seconds"] - 0.15) * SR)
        ref = reference[start : start + 38400]
        old = np.load(before / f"pitch_{note}.npy")
        new = np.load(work / f"pitch_{note}.npy")
        times = np.arange(len(ref)) / SR - 0.15
        steady = (times >= 0.08) & (times < 0.25)
        gain = np.sqrt(np.mean(ref[steady] ** 2) / np.mean(new[steady] ** 2))
        source = [("Reference", ref), ("Previous", old * gain), ("Updated", new * gain)]
        panels.append((note, source))
        for label, audio in [source[0], source[2]]:
            piece = audio.copy()
            piece[-1200:] *= np.linspace(1, 0, 1200)[:, None]
            pairs.extend([piece, np.zeros((9600 if label == "Reference" else 16800, 2))])
        note_metrics = dict(note=note, constant_gain=float(gain), bands=[])
        for j, band in enumerate(bands):
            envelopes = {}
            for label, audio in source:
                filtered = sosfilt(butter(3, band, btype="bandpass", fs=SR, output="sos"), audio, axis=0)
                envelopes[label] = np.sqrt(np.maximum(uniform_filter1d(np.mean(filtered**2, axis=1), size=144), 1e-24))
                axes[j, col].plot(times * 1000, envelopes[label], label=label)
            use = (times >= 0) & (times < 0.060)
            errors = {
                label: float(
                    np.sqrt(np.mean((envelopes[label][use] - envelopes["Reference"][use]) ** 2))
                    / np.max(envelopes["Reference"][use])
                )
                for label in ["Previous", "Updated"]
            }
            note_metrics["bands"].append(dict(hz=band, envelope_nrmse_0_60ms=errors))
            axes[j, col].set(
                xlim=(-5, 80), title=f"{librosa.midi_to_note(note)} · {band[0]}–{band[1]} Hz", xlabel="ms from pick"
            )
            axes[j, col].legend(fontsize=7)
        metrics.append(note_metrics)
    image_paths = []
    path = out / "pick_envelopes.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    image_paths.append(str(path.relative_to(HERE)))
    sf.write(HERE / "auditions/high_pick_reference_then_synth.wav", np.concatenate(pairs), SR, subtype="PCM_24")

    # A 2.67 ms window resolves the contact edge; the separate 2048-bin range
    # plots retain harmonic resolution. Both source and synth share fixed scales.
    nfft, hop = 128, 12
    for kind in ["stft", "mel"]:
        fig, axes = plt.subplots(3, 4, figsize=(16, 11), sharey=True, layout="constrained")
        for col, (note, source) in enumerate(panels):
            for row, (label, audio) in enumerate(source):
                frequency, times, spectrum = stft(audio.T, SR, nperseg=nfft, noverlap=nfft - hop, axis=-1)
                power = np.mean(abs(spectrum) ** 2, axis=0)
                if kind == "mel":
                    power = librosa.filters.mel(sr=SR, n_fft=nfft, n_mels=16, fmin=200, fmax=12000) @ power
                    frequency = librosa.mel_frequencies(n_mels=18, fmin=200, fmax=12000)[1:-1]
                ax = axes[row, col]
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
                    ylim=(350, 12000),
                    xlim=(-5, 60),
                    title=f"{label} · {librosa.midi_to_note(note)}",
                    xlabel="ms from pick",
                )
        fig.suptitle(f"Pick contact · {kind.upper()} · 2.67 ms Hann window, 0.25 ms frame spacing")
        fig.colorbar(mesh, ax=axes, label="Fixed-scale spectral power (dB re 1)")
        path = out / f"high_pick.{kind}.png"
        fig.savefig(path, dpi=130)
        plt.close(fig)
        image_paths.append(str(path.relative_to(HERE)))

    # Identical gain for every knob position: the comparison must retain the
    # control's level change. Silence/end fades here are preview editing only.
    pieces = []
    for note in [71, 83]:
        for strength in [0, 1, 2]:
            audio = np.load(work / f"pick_{note}_{strength}.npy") * 4
            audio[-1200:] *= np.linspace(1, 0, 1200)[:, None]
            pieces.extend([audio, np.zeros((12000, 2))])
    sf.write(HERE / "auditions/pick_strength_0_1_2.wav", np.concatenate(pieces), SR, subtype="PCM_24")
    for kind in ["stft", "mel"]:
        fig, axes = plt.subplots(2, 3, figsize=(13, 7), sharey=True, layout="constrained")
        for row, note in enumerate([71, 83]):
            for col, strength in enumerate([0, 1, 2]):
                audio = np.load(work / f"pick_{note}_{strength}.npy")
                frequency, times, spectrum = stft(audio.T, SR, nperseg=256, noverlap=232, axis=-1)
                power = np.mean(abs(spectrum) ** 2, axis=0)
                if kind == "mel":
                    power = librosa.filters.mel(sr=SR, n_fft=256, n_mels=24, fmin=200, fmax=12000) @ power
                    frequency = librosa.mel_frequencies(n_mels=26, fmin=200, fmax=12000)[1:-1]
                mesh = axes[row, col].pcolormesh(
                    (times - 0.15) * 1000,
                    frequency,
                    10 * np.log10(np.maximum(power, 1e-16)),
                    shading="auto",
                    cmap="magma",
                    vmin=-105 if kind == "mel" else -80,
                    vmax=-45 if kind == "mel" else -20,
                )
                axes[row, col].set(
                    yscale="log",
                    ylim=(200, 12000),
                    xlim=(-5, 150),
                    title=f"{librosa.midi_to_note(note)} · Pick strength {strength}",
                    xlabel="ms from pick",
                )
        fig.suptitle(f"Pick strength · {kind.upper()} · identical gain, 5.33 ms window, 0.5 ms frame spacing")
        fig.colorbar(mesh, ax=axes, label="Fixed-scale spectral power (dB re 1)")
        path = out / f"pick_strength.{kind}.png"
        fig.savefig(path, dpi=130)
        plt.close(fig)
        image_paths.append(str(path.relative_to(HERE)))
    low_differences = {}
    for note in [40, 55, 69, 70]:
        difference = float(abs(np.load(before / f"pitch_{note}.npy") - np.load(work / f"pitch_{note}.npy")).max())
        assert difference < 1e-7, (note, difference)
        low_differences[note] = difference
    report = dict(
        graph_sha256=renders["graph_sha256"],
        measurements=metrics,
        lower_note_maximum_sample_differences=low_differences,
        previous_graph_sha256=json.loads((before / "range_comparison.json").read_text())["graph_sha256"],
        images=image_paths,
        spectrograms_inspected=False,
        listening_performed=False,
        analysis=dict(envelope_smoothing_ms=3, attack_window_ms=60, n_fft=nfft, hop_samples=hop),
        limitation="These comparisons fit the supplied recording; they are not a perceptual quality score.",
    )
    (out / "pick_comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    for m in metrics:
        print(m["note"], [b["envelope_nrmse_0_60ms"] for b in m["bands"]])


if __name__ == "__main__":
    main()
