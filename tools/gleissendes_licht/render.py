"""Offline MIDI audition through the real compiler and mixer; no live sessions."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.engine.csound_worker import CsoundWorker  # noqa: E402
from backend.app.engine.ctcsound_loader import load_ctcsound_module  # noqa: E402
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState  # noqa: E402
from backend.app.models.patch import PatchDocument  # noqa: E402
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget  # noqa: E402
from backend.app.services.compiler_service import CompilerService  # noqa: E402
from backend.app.services.opcode_service import OpcodeService  # noqa: E402

SR = 48000


def render(payload, notes, seconds, values=None):
    patch = PatchDocument.model_validate(payload)
    graph = AudioGraph(masterId="$master", routes=[
        AudioRoute(id=f"light-{side}", sourceId="light", sourcePort=side,
                   targetId="$master", targetPort=side, kind="main")
        for side in ("left", "right")
    ])
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch, 1, assignment_id="light", performance_controller_values=values or {})],
        midi_input="0", rtmidi_module="none", performance_input_mode="midi",
        profile=CompilationProfile.OFFLINE, audio_graph=graph, mixer=MixerState(),
    )
    cs = load_ctcsound_module().Csound()
    worker = CsoundWorker()
    worker._configure_host_midi_callbacks(cs)
    # Keep the compiler's canonical score, including its sine function table.
    csd = re.sub(r"<CsOptions>.*?</CsOptions>",
                 "<CsOptions>\n-n -d -m0 -M0\n</CsOptions>", artifact.csd, flags=re.S)
    try:
        if cs.compileCsdText(csd) != 0 or cs.start() != 0:
            raise RuntimeError("Csound failed to compile/start Gleissendes Licht")
        events = []
        for start, duration, pitch, velocity in notes:
            events += [(start, [0x90, pitch, velocity]), (start + duration, [0x80, pitch, 0])]
        for at, message in sorted(events, key=lambda event: (event[0], event[1][0])):
            worker._midi_scheduler.enqueue(message, source="gleissendes-licht-audition",
                                           target_engine_sample=round(at * SR))
        chunks = []
        for start in range(0, round(seconds * SR), cs.ksmps()):
            worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + cs.ksmps())
            if cs.performKsmps() != 0:
                raise RuntimeError("Csound render ended early")
            chunks.append(cs.spout().copy().reshape(-1, 2))
        return np.concatenate(chunks)[:round(seconds * SR)]
    finally:
        cs.cleanup()
        cs.reset()


def write_wav(path, samples):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR),
                    "-ac", "2", "-i", "-", "-c:a", "pcm_f32le", str(path)],
                   input=samples.astype("<f4").tobytes(), check=True)


def riff():
    pitches = [64, 67, 71, 74, 71, 67, 66, 69, 72, 76, 74, 71, 67, 66, 64, 71]
    notes = [(0.2 + i * 0.24, 0.19 if i % 4 != 3 else 0.26,
              pitch, [105, 85, 96, 114][i % 4]) for i, pitch in enumerate(pitches)]
    notes += [(4.3, 1.7, 76, 104), (6.5, 0.9, 64, 108),
              (6.5, 0.9, 71, 96), (6.5, 0.9, 78, 88)]
    return notes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=HERE / "audition.wav")
    parser.add_argument("--values", default="{}", help="JSON performance-controller overrides")
    args = parser.parse_args()
    payload = json.loads((HERE / "patch.json").read_text())
    samples = render(payload, riff(), 9.0, json.loads(args.values))
    write_wav(args.out, samples)
    print(json.dumps({"path": str(args.out), "peak": float(np.max(np.abs(samples))),
                      "rms": float(np.sqrt(np.mean(samples ** 2))), "finite": bool(np.isfinite(samples).all())}))
