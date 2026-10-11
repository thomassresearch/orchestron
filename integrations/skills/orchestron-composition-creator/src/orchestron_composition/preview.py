"""Portable MIDI previews, with optional FluidSynth/SoundFont rendering."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import wave

import mido
import numpy as np

from .score import CompositionError, qn, to_music21, validate


def render_midi(midi_path: Path, wav_path: Path, seconds: float) -> None:
    """Small fixed-gain additive synth. Input is the exported MIDI, not the score."""
    rate = 22050
    audio = np.zeros(int((seconds + 0.4) * rate) + 1, dtype=np.float64)
    active: dict[tuple[int, int], tuple[float, int]] = {}
    now = 0.0
    for msg in mido.MidiFile(midi_path):
        now += msg.time
        if msg.type == "note_on" and msg.velocity:
            active[msg.channel, msg.note] = (now, msg.velocity)
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            start, velocity = active.pop((msg.channel, msg.note), (now, 0))
            if not velocity:
                continue
            start_index = round(start * rate)
            count = min(round((now - start + 0.12) * rate), len(audio) - start_index)
            if count <= 0:
                continue
            t = np.arange(count) / rate
            frequency = 440 * 2 ** ((msg.note - 69) / 12)
            signal = np.zeros(count)
            for harmonic, gain in ((1, 1), (2, 0.3), (3, 0.12)):
                if harmonic * frequency < rate / 2:
                    signal += gain * np.sin(2 * np.pi * harmonic * frequency * t)
            envelope = np.minimum(t / 0.008, 1) * np.exp(-1.4 * t)
            envelope *= np.clip((now - start + 0.12 - t) / 0.12, 0, 1)
            audio[start_index : start_index + count] += signal * envelope * velocity / 127 * 0.12
    # Fixed soft clipping preserves comparable gain between candidates.
    pcm = (np.tanh(audio) * 32767).astype("<i2")
    with wave.open(str(wav_path), "wb") as output:
        output.setparams((1, 2, rate, len(pcm), "NONE", "not compressed"))
        output.writeframes(pcm.tobytes())


def render(score: dict, directory: Path, soundfont: str | None = None) -> dict:
    validate(score)
    seconds = float(qn(score["length_qn"])) * 60 / score["tempo"]
    if seconds > 600:
        raise CompositionError("Preview is limited to ten minutes; audition shorter sections.")
    directory.mkdir(parents=True, exist_ok=True)
    soundfont = soundfont or os.environ.get("ORCHESTRON_SOUNDFONT")
    if soundfont and (not Path(soundfont).is_file() or not shutil.which("fluidsynth")):
        raise CompositionError("SoundFont rendering requires an existing SoundFont and fluidsynth on PATH.")
    for label, solo in (("mix", False), ("solo", True)):
        musical = to_music21(score, solo=solo)
        midi_path = directory / f"{label}.mid"
        musical.write("midi", fp=midi_path)
        if not solo:
            musical.write("musicxml", fp=directory / "score.musicxml")
        wav_path = directory / f"{label}.wav"
        if soundfont:
            try:
                completed = subprocess.run(
                    [
                        "fluidsynth",
                        "-ni",
                        "-g",
                        "0.3",
                        "-F",
                        str(wav_path),
                        "-T",
                        "wav",
                        "-r",
                        "44100",
                        str(Path(soundfont).resolve()),
                        str(midi_path),
                    ],
                    capture_output=True,
                    timeout=90,
                )
            except subprocess.TimeoutExpired as exc:
                raise CompositionError("FluidSynth preview timed out.") from exc
            if completed.returncode or not wav_path.is_file():
                raise CompositionError("FluidSynth failed: " + completed.stderr.decode(errors="replace")[-1000:])
        else:
            render_midi(midi_path, wav_path, seconds)
    return {
        "renderer": "fluidsynth" if soundfont else "builtin-midi-synth",
        "seconds": seconds,
        "soundfont": str(Path(soundfont).resolve()) if soundfont else None,
    }
