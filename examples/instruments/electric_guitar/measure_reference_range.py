import json
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt
from scipy.ndimage import uniform_filter1d
from scipy.stats import theilslopes
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent / "work/range_fit"
sr = 48000
x, _ = sf.read(HERE / "reference.wav")
mono = x.mean(axis=1)
EVENTS = [
    (1.14, 40),
    (3.01, 44),
    (4.885, 45),
    (6.32, 48),
    (7.71, 50),
    (9.155, 53),
    (10.565, 55),
    (12.695, 59),
    (14.98, 60),
    (16.205, 62),
    (17.755, 63),
    (18.975, 66),
    (20.105, 67),
    (22.075, 69),
    (23.185, 71),
    (24.425, 76),
    (25.775, 80),
    (27.2, 83),
]
results = []
fig, axs = plt.subplots(6, 3, figsize=(18, 20))


def rms_env(y, seconds=0.01):
    return np.sqrt(np.maximum(uniform_filter1d(np.mean(y * y, axis=1), size=round(seconds * sr)), 1e-20))


for i, (detected, note) in enumerate(EVENTS):
    # Find the large picked amplitude rise near the spectral-flux onset.
    start = max(0, round((detected - 0.09) * sr))
    stop = round((detected + 0.15) * sr)
    env = rms_env(x[start:stop], 0.002)
    base = np.median(env[:1500])
    threshold = base + 0.10 * (np.max(env) - base)
    crossing = np.flatnonzero(env > threshold)
    onset = (start + crossing[0]) / sr
    end = EVENTS[i + 1][0] - 0.1 if i + 1 < len(EVENTS) else 29.6
    clip = x[round(onset * sr) : round(end * sr)]
    times = np.arange(len(clip)) / sr
    expected = 440 * 2 ** ((note - 69) / 12)
    sample = clip[round(0.13 * sr) : round(min(0.5, len(clip) / sr) * sr)].mean(axis=1)
    nfft = 2**19
    power = abs(np.fft.rfft(sample * np.hanning(len(sample)), nfft))
    freq = np.fft.rfftfreq(nfft, 1 / sr)
    candidates = np.flatnonzero(abs(freq - expected) < expected * 0.04)
    fund = freq[candidates[np.argmax(power[candidates])]]
    # Background is measured before this note, not mistaken for sustained string.
    before = x[max(0, round((onset - 0.15) * sr)) : round((onset - 0.03) * sr)]
    total = rms_env(clip)
    derivative = np.gradient(20 * np.log10(total + 1e-9))[::240] / 0.005
    # Detect strong damping by sustained envelope loss, not an isolated waveform dip.
    coarse = 20 * np.log10(total[::480] + 1e-9)
    drop = coarse[:-5] - coarse[5:]
    muted = np.flatnonzero((np.arange(len(drop)) * 0.01 > 0.25) & (drop > 8))
    mute_time = float(muted[0] * 0.01) if len(muted) else len(clip) / sr
    fit_end = min(len(clip) / sr - 0.06, mute_time - 0.08, 1.25)
    partials = []
    for h in range(1, 25):
        target = fund * h
        if target > 18000:
            break
        band = np.flatnonzero(abs(freq - target) < fund * 0.20)
        index = band[np.argmax(power[band])]
        peak = freq[index]
        width = min(fund * 0.32, 100)
        sos = butter(3, [max(20, peak - width / 2), peak + width / 2], "bandpass", fs=sr, output="sos")
        filtered = sosfiltfilt(sos, clip, axis=0)
        filtered_bg = sosfiltfilt(sos, before, axis=0)
        e = rms_env(filtered, max(0.006, 3 / fund))
        bg = float(np.mean(filtered_bg**2))
        e = np.sqrt(np.maximum(e * e - bg, 1e-20))
        # Restrict the fit to natural ringing; hand-muting is excluded.
        fit = (times >= 0.12) & (times < fit_end) & (e > max(np.max(e) * 0.025, np.sqrt(bg) * 2))
        ids = np.flatnonzero(fit)[::480]
        if len(ids) >= 8:
            slope, intercept, *_ = theilslopes(20 * np.log10(e[ids]), times[ids])
            residual = float(np.median(abs(20 * np.log10(e[ids]) - (intercept + slope * times[ids]))))
        else:
            slope, intercept, residual = 0, -200, 99
        level = float(np.sqrt(np.mean(e[(times >= 0.08) & (times < 0.18)] ** 2)))
        peakidx = np.argmax(e[: min(len(e), round(0.25 * sr))])
        maximum = e[peakidx]
        ten = np.flatnonzero(e[: peakidx + 1] >= maximum * 0.1)[0]
        ninety = np.flatnonzero(e[: peakidx + 1] >= maximum * 0.9)[0]
        partials.append(
            dict(
                harmonic=h,
                frequency_hz=float(peak),
                ratio=float(peak / fund),
                level_rms=level,
                slope_db_per_second=float(slope),
                t60_seconds=float(-60 / slope) if slope < -1 else None,
                fit_residual_db=residual,
                fit_points=len(ids),
                attack_peak_ms=float(peakidx / sr * 1000),
                rise_10_90_ms=float((ninety - ten) / sr * 1000),
            )
        )
        if h <= 6:
            axs.flat[i].plot(times[::240], 20 * np.log10(e[::240] + 1e-10), label=str(h))
    for p in partials:
        p["relative_db"] = float(20 * np.log10(max(p["level_rms"], 1e-10) / partials[0]["level_rms"]))
    result = dict(
        midi=note,
        onset_seconds=onset,
        clip_end_seconds=end,
        fundamental_hz=float(fund),
        cents=float(1200 * np.log2(fund / expected)),
        natural_fit_end_seconds=fit_end,
        mute_time_seconds=mute_time,
        partials=partials,
    )
    results.append(result)
    axs.flat[i].set(title=f"MIDI {note}, {fund:.2f} Hz", ylim=(-80, -8), xlim=(0, min(2, len(clip) / sr)))
    axs.flat[i].axvline(fit_end, color="red", ls="--")
    axs.flat[i].legend(ncol=6, fontsize=7)
    print(
        note,
        round(onset, 3),
        round(fund, 2),
        "natural",
        round(fit_end, 2),
        "T60",
        [
            (
                p["harmonic"],
                None if p["t60_seconds"] is None else round(p["t60_seconds"], 2),
                round(p["relative_db"], 1),
            )
            for p in partials[:10]
        ],
        flush=True,
    )
fig.tight_layout()
fig.savefig(HERE / "decays.png")
(HERE / "measurements.json").write_text(json.dumps(results, indent=2) + "\n")
