from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from dataclasses import replace
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

if any(importlib.util.find_spec(name) is None for name in ("numpy", "soundfile", "librosa", "matplotlib")):
    raise unittest.SkipTest("Spectrogram tests require the skill's optional audio extra")

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from render_spectrograms import Settings, analyze_audio, main, render_images  # noqa: E402
from matplotlib import pyplot as plt  # noqa: E402


class SpectrogramTests(unittest.TestCase):
    sample_rate = 48000

    def tone(self, frequency=1500.0, amplitude=0.8, duration=1.0):
        time = np.arange(round(duration * self.sample_rate)) / self.sample_rate
        return amplitude * np.sin(2 * np.pi * frequency * time)

    def test_tone_frequency_and_fixed_power_reference(self):
        settings = Settings()
        full = analyze_audio(self.tone(), self.sample_rate, settings)
        half = analyze_audio(self.tone(amplitude=0.4), self.sample_rate, settings)
        middle = full.stft_db.shape[-1] // 2
        peak = np.argmax(full.stft_db[0, :, middle])
        self.assertAlmostEqual(full.frequencies[peak], 1500)
        # A bin-centered sine's positive-frequency magnitude is half its amplitude.
        self.assertAlmostEqual(full.stft_db[0, peak, middle], 20 * np.log10(0.8 / 2), places=5)
        self.assertAlmostEqual(full.stft_db[0, peak, middle] - half.stft_db[0, peak, middle],
                               20 * np.log10(2), places=5)
        mel_peak = np.argmax(full.mel_db[0, :, middle])
        self.assertLess(full.mel_edges[mel_peak], 1500)
        self.assertGreater(full.mel_edges[mel_peak + 1], 1500)
        self.assertAlmostEqual(full.mel_db[0, mel_peak, middle] - half.mel_db[0, mel_peak, middle],
                               20 * np.log10(2), places=5)

    def test_stereo_is_not_downmixed_or_independently_normalized(self):
        signal = self.tone()
        opposite = analyze_audio(np.column_stack((signal, -signal)), self.sample_rate, Settings())
        np.testing.assert_allclose(opposite.stft_db[0], opposite.stft_db[1])
        np.testing.assert_allclose(opposite.mel_db[0], opposite.mel_db[1])
        self.assertGreater(opposite.stft_db.max(), -10)
        quiet_right = analyze_audio(np.column_stack((signal, signal / 2)), self.sample_rate, Settings())
        self.assertAlmostEqual(quiet_right.stft_db[0].max() - quiet_right.stft_db[1].max(),
                               20 * np.log10(2), places=5)
        silent_right = analyze_audio(np.column_stack((signal, np.zeros_like(signal))),
                                    self.sample_rate, Settings())
        self.assertTrue(np.all(silent_right.stft_db[1] < -100))
        self.assertTrue(np.all(silent_right.mel_db[1] < -100))

    def test_sweep_tracks_frequency_over_time(self):
        time = np.arange(self.sample_rate) / self.sample_rate
        signal = 0.5 * np.sin(2 * np.pi * (400 * time + 1600 * time**2 / 2))
        settings = Settings()
        result = analyze_audio(signal, self.sample_rate, settings)
        for target_time in (0.2, 0.5, 0.8):
            frame = round(target_time * self.sample_rate / settings.hop_length)
            actual_time = frame * settings.hop_length / self.sample_rate
            frequency = result.frequencies[np.argmax(result.stft_db[0, :, frame])]
            self.assertAlmostEqual(frequency, 400 + 1600 * actual_time,
                                   delta=self.sample_rate / settings.n_fft)

    def test_delayed_bursts_keep_timing_and_decay(self):
        signal = np.zeros(self.sample_rate)
        burst = self.tone(duration=0.08) * np.hanning(round(0.08 * self.sample_rate))
        for start, gain in ((0.15, 1.0), (0.55, 0.5)):
            offset = round(start * self.sample_rate)
            signal[offset:offset + len(burst)] = burst * gain
        settings = Settings(n_fft=1024, n_mels=64)
        result = analyze_audio(signal, self.sample_rate, settings)
        energy_db = result.stft_db[0].max(axis=0)
        frame_times = np.arange(len(energy_db)) * settings.hop_length / self.sample_rate
        peaks = []
        for center in (0.19, 0.59):
            indices = np.flatnonzero(abs(frame_times - center) < 0.05)
            peak = indices[np.argmax(energy_db[indices])]
            self.assertAlmostEqual(frame_times[peak], center, delta=0.01)
            peaks.append(energy_db[peak])
        self.assertAlmostEqual(peaks[0] - peaks[1], 20 * np.log10(2), delta=0.1)
        self.assertTrue(np.all(energy_db[frame_times > 0.8] < -100))

    def test_silence_and_short_clips_render_finite_images(self):
        with tempfile.TemporaryDirectory() as directory:
            for name, signal in (("silence", np.zeros(4800)), ("short", np.array([0.25]))):
                with self.subTest(name=name):
                    result = analyze_audio(signal, self.sample_rate, Settings())
                    self.assertTrue(np.isfinite(result.stft_db).all())
                    self.assertTrue(np.isfinite(result.mel_db).all())
                    self.assertEqual(result.time_edges[0], 0)
                    self.assertEqual(result.time_edges[-1], len(signal) / self.sample_rate)
                    outputs = render_images(result, Settings(), Path(f"{name}.wav"), Path(directory))
                    for output in outputs:
                        pixels = plt.imread(output)
                        self.assertGreater(pixels.shape[0], 100)
                        self.assertGreater(pixels.shape[1], 100)
                        self.assertTrue(np.isfinite(pixels).all())
                        self.assertGreater(pixels.std(), 0.01)

    def test_invalid_audio_and_settings(self):
        for samples in (np.array([]), np.array([np.nan]), np.array([np.inf]), np.zeros((3, 0))):
            with self.subTest(samples=samples), self.assertRaises(ValueError):
                analyze_audio(samples, self.sample_rate, Settings())
        for changes in ({"n_fft": 1}, {"hop_length": 0}, {"hop_length": 2049}, {"n_mels": 0},
                        {"fmin": 0}, {"fmax": 25000}, {"fmin": 500, "fmax": 100},
                        {"fmin": float("nan")}, {"fmax": float("inf")}, {"vmin": 0},
                        {"vmax": float("nan")}, {"vmin": float("inf")},
                        {"fmin": 30, "fmax": 31}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                analyze_audio(self.tone(duration=0.01), self.sample_rate, replace(Settings(), **changes))

    def test_cli_pngs_paths_native_rate_and_channels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "stereo audition.wav"
            output_dir = root / "plots"
            samples = np.column_stack((self.tone(duration=0.2), self.tone(3000, duration=0.2)))
            sf.write(source, samples, 44100, subtype="FLOAT")
            original_bytes = source.read_bytes()
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "render_spectrograms.py"), str(source),
                 "--out-dir", str(output_dir), "--n-fft", "4096", "--hop-length", "512",
                 "--n-mels", "64", "--fmin", "50", "--fmax", "18000", "--vmin", "-90", "--vmax", "-5"],
                cwd=directory, capture_output=True, text=True, check=True)
            outputs = [Path(line) for line in result.stdout.splitlines()]
            self.assertEqual([p.name for p in outputs], ["stereo audition.mel.png", "stereo audition.stft.png"])
            for output in outputs:
                self.assertTrue(output.is_absolute())
                self.assertEqual(output.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
            loaded, sample_rate = sf.read(source, always_2d=True)
            analyzed = analyze_audio(loaded, sample_rate, Settings())
            self.assertEqual(analyzed.sample_rate, 44100)
            self.assertEqual(analyzed.stft_db.shape[0], 2)
            self.assertEqual(source.read_bytes(), original_bytes)

    def test_cli_errors_create_no_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            broken = root / "broken.wav"
            broken.write_text("not audio")
            nonfinite = root / "nonfinite.wav"
            sf.write(nonfinite, np.array([np.nan]), self.sample_rate, subtype="FLOAT")
            empty = root / "empty.wav"
            sf.write(empty, np.array([]), self.sample_rate)
            valid = root / "valid.wav"
            sf.write(valid, self.tone(duration=0.01), self.sample_rate)
            for argv in ([str(root / "missing.wav")], [str(broken)], [str(nonfinite)], [str(empty)],
                         [str(valid), "--hop-length", "0"]):
                with self.subTest(argv=argv), redirect_stderr(io.StringIO()) as error, redirect_stdout(io.StringIO()):
                    self.assertEqual(main([*argv, "--out-dir", str(root / "plots")]), 1)
                    self.assertIn("error:", error.getvalue())
                    self.assertNotIn("Traceback", error.getvalue())
            self.assertFalse(list(root.rglob("*.png")))


if __name__ == "__main__":
    unittest.main()
