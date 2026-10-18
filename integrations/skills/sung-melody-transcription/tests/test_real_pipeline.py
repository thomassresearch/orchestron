"""Opt-in smoke test with actual PyTorch checkpoint and actual FluidSynth rendering."""
import json
import os
import subprocess
import sys

import mido
import numpy as np
import pytest
import soundfile as sf


@pytest.mark.skipif(not (os.environ.get("SUNG_MELODY_TEST_MODEL") and os.environ.get("SUNG_MELODY_TEST_SOUNDFONT")),
                    reason="Set external test model and piano SoundFont paths to run real inference/rendering")
def test_actual_rmvpe_to_fluidsynth(tmp_path):
    sr = 16000
    audio = np.zeros(sr*5)
    expected = [60, 62, 64, 67, 67, 65, 64, 60]
    for i, pitch in enumerate(expected):
        times = np.arange(6400)/sr
        frequency = 440*2**((pitch+.17-69)/12)
        note = sum(np.sin(2*np.pi*frequency*k*times)/k for k in range(1, 9))
        envelope = np.minimum(times/.025, 1)*np.minimum((.4-times)/.035, 1)
        start = int((.2+i*.5)*sr)
        audio[start:start+len(times)] = .15*note*envelope
    recording = tmp_path/"synthetic harmonic melody.wav"
    sf.write(recording, audio, sr)
    output = tmp_path/"transcription"
    args = [sys.executable, "-m", "sung_melody.cli", "transcribe", str(recording), "--output", str(output),
            "--model", os.environ["SUNG_MELODY_TEST_MODEL"], "--soundfont", os.environ["SUNG_MELODY_TEST_SOUNDFONT"],
            "--piano-program", os.environ.get("SUNG_MELODY_TEST_PROGRAM", "0"),
            "--tempo", "120", "--meter", "4/4", "--bars", "2", "--beat-zero", "0.2"]
    process = subprocess.run(args, capture_output=True, text=True, timeout=120)
    assert process.returncode == 0, process.stderr
    document = json.loads((output/"notes.json").read_text())
    assert [n["midi_pitch"] for n in document["notes"]] == expected
    assert document["phrase_beats"] == 8 and document["preview"]["status"] == "rendered"
    assert len(document["scale"]["tied_candidates"]) >= 2
    assert mido.MidiFile(output/"melody.mid").length == pytest.approx(4)
    rendered, rate = sf.read(output/"preview.wav")
    assert rate == 44100 and np.max(np.abs(rendered)) > .001
    assert len(rendered)/rate >= 4
    assert all((output/name).is_file() for name in ("notes.json", "pitch.json", "edits.txt"))
