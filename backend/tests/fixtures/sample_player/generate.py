"""Generate original synthetic test signals; no recordings or third-party audio."""
from pathlib import Path
import math
import struct
import subprocess
import wave

ROOT = Path(__file__).resolve().parent


def pcm(name, rate, channels, seconds):
    with wave.open(str(ROOT / name), "wb") as stream:
        stream.setparams((channels, 2, rate, 0, "NONE", ""))
        # Offset intentionally makes both file edges nonzero.
        frames = (int(8000 * (0.5 + 0.5 * math.sin(2 * math.pi * (220 + c * 330) * i / rate)))
                  for i in range(round(rate * seconds)) for c in range(channels))
        stream.writeframes(b"".join(struct.pack("<h", x) for x in frames))


if __name__ == "__main__":
    pcm("mono.wav", 44100, 1, 0.5)
    pcm("stereo.wav", 48000, 2, 0.25)
    pcm("long.wav", 12000, 1, 10)
    pcm("tiny.wav", 48000, 1, 3 / 48000)
    pcm("surround.wav", 48000, 3, 0.001)
    (ROOT / "corrupt.wav").write_bytes((ROOT / "mono.wav").read_bytes()[:1024])
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(ROOT / "stereo.wav"),
                    "-c:a", "libmp3lame", "-b:a", "96k", str(ROOT / "stereo.mp3")], check=True)
