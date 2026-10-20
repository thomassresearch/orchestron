"""Native saxophone measurements; callers supply patches, never developer examples."""

import numpy as np

# The existing native-instrument harness is source independent despite its historical name.
from backend.tests.guitar_audio_support import (  # noqa: F401
    compile_guitars as compile_instruments, db, fundamental, note_events, render, rms,
)


def section(audio, start, end):
    return audio[round(start * 48000):round(end * 48000), 0]


def spectrum_metrics(audio, expected):
    power = abs(np.fft.rfft(audio * np.hanning(len(audio)))) ** 2
    frequency = np.fft.rfftfreq(len(audio), 1 / 48000)
    total = max(float(power.sum()), 1e-30)
    fundamental_power = float(power[abs(frequency - expected) < expected * .045].sum())
    octave_power = float(power[abs(frequency - 2 * expected) < expected * .09].sum())
    return dict(
        rms_dbfs=db(rms(audio)),
        fundamental_fraction=fundamental_power / total,
        octave_to_fundamental=octave_power / max(fundamental_power, 1e-30),
        high_fraction=float(power[frequency > 3 * expected].sum()) / total,
        centroid_hz=float(np.sum(frequency * power) / total),
    )


def upper_harmonic_fraction(audio, expected):
    """Third through tenth harmonic power, excluding inter-harmonic breath noise."""
    pitch = fundamental(audio, expected)
    power = abs(np.fft.rfft(audio * np.hanning(len(audio)))) ** 2
    frequency = np.fft.rfftfreq(len(audio), 1 / 48000)
    harmonics = [float(power[abs(frequency - h * pitch) < max(8, .015 * h * pitch)].sum())
                 for h in range(1, 11)]
    return sum(harmonics[2:]) / max(sum(harmonics), 1e-30)
