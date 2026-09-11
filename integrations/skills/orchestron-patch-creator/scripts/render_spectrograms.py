#!/usr/bin/env python3
"""Render comparable Mel and log-frequency STFT images from an audio audition."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import sys

import librosa
import matplotlib
import numpy as np
import soundfile as sf

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402


@dataclass(frozen=True)
class Settings:
    n_fft: int = 2048
    hop_length: int = 256
    n_mels: int = 128
    fmin: float = 20.0
    fmax: float | None = None
    vmin: float = -100.0
    vmax: float = 0.0

    def validate(self, sample_rate: int) -> float:
        if self.n_fft < 2:
            raise ValueError("--n-fft must be at least 2")
        if not 1 <= self.hop_length <= self.n_fft:
            raise ValueError("--hop-length must be between 1 and --n-fft")
        if self.n_mels < 1:
            raise ValueError("--n-mels must be positive")
        if sample_rate <= 0:
            raise ValueError("audio sample rate must be positive")
        fmax = sample_rate / 2 if self.fmax is None else self.fmax
        if not (np.isfinite(self.fmin) and np.isfinite(fmax)
                and 0 < self.fmin < fmax <= sample_rate / 2):
            raise ValueError("frequency limits must satisfy 0 < fmin < fmax <= Nyquist")
        if not (np.isfinite(self.vmin) and np.isfinite(self.vmax) and self.vmin < self.vmax):
            raise ValueError("color limits must be finite, with --vmin < --vmax")
        return fmax


@dataclass(frozen=True)
class Spectrograms:
    stft_db: np.ndarray  # channel, frequency, time
    mel_db: np.ndarray
    frequencies: np.ndarray
    mel_edges: np.ndarray
    time_edges: np.ndarray
    sample_rate: int
    duration: float
    fmax: float


def analyze_audio(samples: np.ndarray, sample_rate: int, settings: Settings) -> Spectrograms:
    """Analyze frames x channels without resampling, downmixing or peak normalization."""
    fmax = settings.validate(sample_rate)
    samples = np.asarray(samples, dtype=np.float64)
    if samples.ndim == 1:
        samples = samples[:, None]
    if samples.ndim != 2 or not samples.shape[0] or not samples.shape[1]:
        raise ValueError("audio must contain at least one frame and one channel")
    if not np.isfinite(samples).all():
        raise ValueError("audio contains non-finite samples (NaN or infinity)")

    duration = len(samples) / sample_rate
    # Periodic Hann; coherent window gain gives a fixed reference across renders.
    window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(settings.n_fft) / settings.n_fft)
    # Explicit padding also supports very short clips without librosa's short-input warning.
    padded = np.pad(samples.T, ((0, 0), (settings.n_fft // 2, settings.n_fft // 2)))
    spectrum = librosa.stft(padded, n_fft=settings.n_fft, hop_length=settings.hop_length,
                           window=window, center=False)
    with np.errstate(over="ignore", invalid="ignore"):
        power = np.square(np.abs(spectrum) / window.sum())
    if not np.isfinite(power).all():
        raise ValueError("audio magnitude is too large for finite spectral power")

    frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=settings.n_fft)
    if not np.any((frequencies >= settings.fmin) & (frequencies <= fmax)):
        raise ValueError("frequency range contains no FFT bins; increase --n-fft or widen the range")
    mel_filters = librosa.filters.mel(sr=sample_rate, n_fft=settings.n_fft,
                                     n_mels=settings.n_mels, fmin=settings.fmin, fmax=fmax,
                                     htk=False, norm="slaney")
    mel_power = mel_filters @ power
    # top_db=None avoids clipping relative to each file's peak. The floor only handles zero.
    floor = np.finfo(np.float64).tiny
    stft_db = librosa.power_to_db(power, ref=1.0, amin=floor, top_db=None)
    mel_db = librosa.power_to_db(mel_power, ref=1.0, amin=floor, top_db=None)

    times = np.arange(power.shape[-1]) * settings.hop_length / sample_rate
    time_edges = np.concatenate(([0.0], (times[1:] + times[:-1]) / 2, [duration]))
    mel_centers = librosa.hz_to_mel(librosa.mel_frequencies(
        n_mels=settings.n_mels + 2, fmin=settings.fmin, fmax=fmax)[1:-1])
    mel_edges = librosa.mel_to_hz(np.concatenate((
        [librosa.hz_to_mel(settings.fmin)], (mel_centers[1:] + mel_centers[:-1]) / 2,
        [librosa.hz_to_mel(fmax)])))
    return Spectrograms(stft_db, mel_db, frequencies, mel_edges, time_edges,
                        sample_rate, duration, fmax)


def render_images(result: Spectrograms, settings: Settings, source: Path, out_dir: Path) -> list[Path]:
    """Write one PNG per view, with all channels sharing axes and color limits."""
    out_dir.mkdir(parents=True, exist_ok=True)
    channels = result.stft_db.shape[0]
    bin_width = result.sample_rate / settings.n_fft
    # DC has no position on a logarithmic frequency axis.
    stft_edges = np.concatenate((result.frequencies[1:] - bin_width / 2,
                                 [result.frequencies[-1] + bin_width / 2]))
    outputs = []
    for kind, title, values, edges in (
        ("mel", "Mel power", result.mel_db, result.mel_edges),
        ("stft", "Log-frequency STFT power", result.stft_db[:, 1:, :], stft_edges),
    ):
        fig, axes = plt.subplots(channels, 1, figsize=(12, 3 * channels + 1.2),
                                 squeeze=False, sharex=True, sharey=True, layout="constrained")
        try:
            for channel, ax in enumerate(axes[:, 0]):
                mesh = ax.pcolormesh(result.time_edges, edges, values[channel], shading="flat",
                                     cmap="magma", vmin=settings.vmin, vmax=settings.vmax,
                                     rasterized=True)
                if kind == "mel":
                    ax.set_yscale("function", functions=(librosa.hz_to_mel, librosa.mel_to_hz))
                else:
                    ax.set_yscale("log")
                # Space labels in display coordinates; low Mel frequencies crowd together.
                transform = librosa.hz_to_mel if kind == "mel" else np.log
                min_spacing = 0.075 * (transform(result.fmax) - transform(settings.fmin))
                ticks = [settings.fmin]
                for frequency in (20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 40000, result.fmax):
                    if (settings.fmin < frequency <= result.fmax
                            and transform(frequency) - transform(ticks[-1]) >= min_spacing):
                        ticks.append(frequency)
                ax.set_yticks(ticks)
                ax.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:g}"))
                ax.minorticks_off()
                ax.set_ylim(settings.fmin, result.fmax)
                ax.set_xlim(0, result.duration)
                ax.set_ylabel("Frequency (Hz)")
                label = "Mono" if channels == 1 else (
                    ("Left", "Right")[channel] if channels == 2 else f"Channel {channel + 1}")
                ax.set_title(label, loc="left", fontsize=10)
            axes[-1, 0].set_xlabel("Time (s)")
            bands = f" · {settings.n_mels} Mel bands" if kind == "mel" else ""
            fig.suptitle(f"{source.name} — {title}\n"
                         f"{result.sample_rate:,} Hz · {result.duration:.3f} s · "
                         f"Hann {settings.n_fft} / hop {settings.hop_length}{bands}")
            colorbar = fig.colorbar(mesh, ax=list(axes[:, 0]), pad=0.02)
            colorbar.set_label("Power (dB re 1, window-normalized)")
            output = (out_dir / f"{source.stem}.{kind}.png").resolve()
            fig.savefig(output, dpi=150)
            outputs.append(output)
        finally:
            plt.close(fig)
    return outputs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path, help="rendered WAV or other SoundFile-supported audio")
    parser.add_argument("--out-dir", type=Path, default=Path("spectrograms"),
                        help="PNG output directory (default: ./spectrograms; matching PNGs are replaced)")
    parser.add_argument("--n-fft", type=int, default=2048, help="Hann window/FFT size (default: 2048)")
    parser.add_argument("--hop-length", type=int, default=256, help="frame hop in samples (default: 256)")
    parser.add_argument("--n-mels", type=int, default=128, help="number of Mel bands (default: 128)")
    parser.add_argument("--fmin", type=float, default=20, help="minimum frequency in Hz (default: 20)")
    parser.add_argument("--fmax", type=float, help="maximum frequency in Hz (default: native Nyquist)")
    parser.add_argument("--vmin", type=float, default=-100, help="color scale minimum in dB (default: -100)")
    parser.add_argument("--vmax", type=float, default=0, help="color scale maximum in dB (default: 0)")
    args = parser.parse_args(argv)
    settings = Settings(args.n_fft, args.hop_length, args.n_mels, args.fmin, args.fmax, args.vmin, args.vmax)
    try:
        samples, sample_rate = sf.read(args.audio, dtype="float64", always_2d=True)
        result = analyze_audio(samples, sample_rate, settings)
        for path in render_images(result, settings, args.audio, args.out_dir):
            print(path)
    except (OSError, ValueError, sf.SoundFileError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
