"""Compare the user-confirmed B4 note, excluding the residual lower bass.

Requires the local accepted WAV and the rendered matched_note.npy. A single
constant gain matches the sustained fundamental; no dynamic normalization or
time stretching is used. The reference itself is never an instrument asset.
"""

import argparse
import hashlib
import json
from pathlib import Path

import librosa
import matplotlib
import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, sosfiltfilt, stft

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
SR = 48000
OFFSET = 0.03305536808669886
PLAYBACK_GAIN = 2.170689102634281
BANDS = [(420, 580), (2300, 2650), (2800, 3500), (3500, 5500), (5500, 9500)]


def features(audio):
    bands = []
    for low, high in BANDS:
        filtered = sosfiltfilt(butter(3, [low, high], "bandpass", fs=SR, output="sos"), audio, axis=0)
        # Narrow fundamental filtering also limits its effective time resolution.
        power = uniform_filter1d(np.mean(filtered**2, axis=1), size=240 if low == 420 else 96)
        bands.append(np.sqrt(np.maximum(power, 0))[::24])
    return np.array(bands)


def main(reference_path, before_path):
    reference, sr = sf.read(reference_path, always_2d=True)
    assert sr == SR
    ref = reference[7200:29280] / PLAYBACK_GAIN
    assert len(ref) == 22080
    target = features(ref)
    background = np.median(target[:, :50] ** 2, axis=1)
    target = np.sqrt(np.maximum(target**2 - background[:, None], 0))
    times = np.arange(target.shape[1]) * 0.0005
    steady = (times >= 0.10) & (times < 0.25)
    attack = (times >= 0.034) & (times < 0.095)
    scales = target[:, (times >= 0.034) & (times < 0.12)].max(axis=1)
    models = {"Updated": np.load(HERE / "work/matched_note.npy")}
    if before_path.exists():
        models = {"Previous": np.load(before_path), **models}
    aligned_audio = {"Reference": ref}
    aligned_features = {"Reference": target}
    measurements = {}
    for name, audio in models.items():
        measured = features(audio)
        source_times = np.arange(measured.shape[1]) * 0.0005 - 0.15

        def align(offset):
            values = np.array([np.interp(times, source_times + offset, row, left=0, right=0) for row in measured])
            gain = float(np.dot(target[0, steady], values[0, steady]) / np.dot(values[0, steady], values[0, steady]))
            return gain, values * gain

        # Give the previous model its best global alignment too; no time warping.
        offsets = [OFFSET] if name == "Updated" else np.arange(0.02, 0.071, 0.0005)
        offset = min(
            offsets, key=lambda o: np.mean(((align(o)[1][:, attack] - target[:, attack]) / scales[:, None]) ** 2)
        )
        gain, values = align(offset)
        aligned_features[name] = values
        destination = np.arange(len(ref)) / SR
        source = np.arange(len(audio)) / SR - 0.15 + offset
        aligned_audio[name] = (
            np.column_stack([np.interp(destination, source, row, left=0, right=0) for row in audio.T]) * gain
        )
        error = (values[:, attack] - target[:, attack]) / scales[:, None]
        measurements[name] = dict(
            onset_offset_seconds=float(offset),
            constant_comparison_gain=gain,
            attack_band_normalized_rmse=float(np.sqrt(np.mean(error**2))),
        )

    def timing(values):
        region = (times >= 0.034) & (times <= 0.12)
        indices = np.flatnonzero(region)
        fundamental = values[0, region]
        peak = int(np.argmax(fundamental))
        onset = indices[np.flatnonzero(fundamental[: peak + 1] >= 0.1 * fundamental[peak])[0]]
        ninety = indices[np.flatnonzero(fundamental[: peak + 1] >= 0.9 * fundamental[peak])[0]]
        pick_peak = indices[np.argmax(values[-1, region])]
        return dict(
            fundamental_10_to_90_ms=float((times[ninety] - times[onset]) * 1000),
            fundamental_peak_ms=float(times[indices[peak]] * 1000),
            bright_pick_peak_ms=float(times[pick_peak] * 1000),
        )

    for name, values in aligned_features.items():
        measurements.setdefault(name, {}).update(timing(values))

    out = HERE / "validation"
    out.mkdir(exist_ok=True)
    images = []
    # Remove the low bass before the short FFT so window leakage cannot make it
    # look like upper guitar energy. Apply the identical analysis filter to all.
    highpass = butter(6, 400, "highpass", fs=SR, output="sos")
    views = {name: sosfiltfilt(highpass, audio, axis=0) for name, audio in aligned_audio.items()}
    order = [name for name in ["Reference", "Previous", "Updated"] if name in views]
    for kind in ["stft", "mel"]:
        fig, axes = plt.subplots(len(order), 1, figsize=(13, 3 * len(order)), sharex=True, layout="constrained")
        for ax, name in zip(axes, order):
            # Average channel power; don't cancel stereo partials by downmixing.
            frequency, frame_times, spectrum = stft(views[name].T, SR, nperseg=256, noverlap=232, axis=-1)
            power = np.mean(abs(spectrum) ** 2, axis=0)
            if kind == "mel":
                bank = librosa.filters.mel(sr=SR, n_fft=256, n_mels=24, fmin=400, fmax=10000)
                power = bank @ power
                frequency = librosa.mel_frequencies(n_mels=26, fmin=400, fmax=10000)[1:-1]
            db = 10 * np.log10(np.maximum(power, 1e-16))
            mesh = ax.pcolormesh(
                frame_times * 1000,
                frequency,
                db,
                shading="auto",
                cmap="magma",
                vmin=-105 if kind == "mel" else -80,
                vmax=-45 if kind == "mel" else -20,
            )
            ax.set(xlim=(20, 180), ylim=(400, 10000), yscale="log", ylabel="Hz", title=name)
        axes[-1].set_xlabel("Time within accepted source crop (ms)")
        fig.colorbar(mesh, ax=axes, label="Fixed-scale spectral power (dB re 1)")
        fig.suptitle(
            f"Confirmed note attack · {kind.upper()} · Hann 256 (5.33 ms) · hop 24 (0.5 ms)\n"
            "Identical 400 Hz analysis high-pass; constant fundamental level match"
        )
        path = out / f"matched_note_attack.{kind}.png"
        fig.savefig(path, dpi=140)
        plt.close(fig)
        images.append(str(path.relative_to(HERE)))

    fig, axes = plt.subplots(len(BANDS), 1, figsize=(13, 12), sharex=True, layout="constrained")
    for index, (ax, band) in enumerate(zip(axes, BANDS)):
        for name in ["Reference", "Updated"]:
            ax.plot(times * 1000, aligned_features[name][index] / scales[index], label=name)
        ax.set(ylabel=f"{band[0]}–{band[1]} Hz", xlim=(20, 200), ylim=(0, 1.35))
        ax.legend(loc="upper right")
    axes[-1].set_xlabel("Time within accepted crop (ms)")
    fig.suptitle(
        "Attack envelopes · pre-onset background power subtracted from reference\n"
        "5 ms fundamental / 2 ms bright-band RMS smoothing; 0.5 ms sampling"
    )
    path = out / "matched_note_envelopes.png"
    fig.savefig(path, dpi=140)
    plt.close(fig)
    images.append(str(path.relative_to(HERE)))

    # Auditions retain the accepted reference intact, including its residual bass.
    gain = measurements["Updated"]["constant_comparison_gain"] * PLAYBACK_GAIN
    updated = models["Updated"] * gain
    assert abs(updated).max() < 0.98
    sf.write(HERE / "auditions/updated_single_note.wav", updated, SR, subtype="PCM_24")
    # Give the A/B the same excerpt duration, padding and 25 ms end fade as the
    # accepted extraction. Keep the full native note in the separate audition.
    excerpt = aligned_audio["Updated"] * PLAYBACK_GAIN
    excerpt[-1200:] *= np.linspace(1, 0, 1200)[:, None]
    matched_preview = np.concatenate([np.zeros((7200, 2)), excerpt, np.zeros((21600, 2))])
    ab = np.concatenate(
        [
            reference,
            np.zeros((24000, 2)),
            matched_preview,
            np.zeros((24000, 2)),
            reference,
            np.zeros((24000, 2)),
            matched_preview,
        ]
    )
    sf.write(HERE / "auditions/reference_then_updated.wav", ab, SR, subtype="PCM_24")
    report = dict(
        reference_sha256=hashlib.sha256(reference_path.read_bytes()).hexdigest(),
        reference_user_confirmed=True,
        reference_source_crop_seconds=[2.4, 2.86],
        note=71,
        note_name="B4",
        velocity=100,
        ignored_below_hz=400,
        analysis_bands_hz=BANDS,
        background_power_subtracted=True,
        comparison_window_seconds=[0.034, 0.095],
        steady_gain_window_seconds=[0.1, 0.25],
        stft_window_samples=256,
        stft_window_ms=256 / SR * 1000,
        hop_samples=24,
        hop_ms=0.5,
        measurements=measurements,
        images=images,
        spectrograms_inspected=False,
        listening_performed=False,
        limits="Residual accompaniment can share guitar partials. Metrics characterize this note and analysis setup, not perceived identity.",
    )
    render_report = json.loads((out / "render.json").read_text())
    report["graph_sha256"] = render_report["graph_sha256"]
    (out / "note_comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(measurements, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=HERE / "auditions/reference_single_note_attack_v2.wav")
    parser.add_argument("--before", type=Path, default=HERE / "work/attack_fit/before/note_71.npy")
    args = parser.parse_args()
    main(args.reference, args.before)
