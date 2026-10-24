"""Offline MIDI audition through the real compiler and mixer; no live sessions."""

import argparse
import json
from pathlib import Path
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
        AudioRoute(id=f"bass-{side}", sourceId="bass", sourcePort=side,
                   targetId="$master", targetPort=side, kind="main")
        for side in ("left", "right")
    ])
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch, 1, assignment_id="bass", performance_controller_values=values or {})],
        midi_input="0", rtmidi_module="none", performance_input_mode="midi",
        profile=CompilationProfile.OFFLINE, audio_graph=graph, mixer=MixerState(),
    )
    cs = load_ctcsound_module().Csound()
    worker = CsoundWorker()
    worker._configure_host_midi_callbacks(cs)
    csd = ("<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0 -M0\n</CsOptions>\n"
           f"<CsInstruments>\n{artifact.orc}\n</CsInstruments>\n"
           f"<CsScore>\nf 0 {seconds + 0.1}\n</CsScore>\n</CsoundSynthesizer>")
    try:
        if cs.compileCsdText(csd) != 0 or cs.start() != 0:
            raise RuntimeError("Csound failed to compile/start Synth Bass")
        events = []
        for start, duration, pitch, velocity in notes:
            events += [(start, [0x90, pitch, velocity]), (start + duration, [0x80, pitch, 0])]
        for at, message in sorted(events, key=lambda event: (event[0], event[1][0])):
            worker._midi_scheduler.enqueue(message, source="synth-bass-audition",
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
    # A comparison phrase, not a claim of an exact transcription of the noisy clip.
    pitches = [38, 41, 38, 36, 33, 38, 38, 41, 38, 36, 33, 38, 38, 38, 41, 38]
    return [(0.1 + i * 0.16, 0.145, pitch, 112 if i % 4 == 1 else 100)
            for i, pitch in enumerate(pitches)]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=HERE / "audition.wav")
    parser.add_argument("--values", default="{}", help="JSON performance-controller overrides")
    args = parser.parse_args()
    payload = json.loads((HERE / "patch.json").read_text())
    notes = riff() + [(3.0, 0.7, 38, 100), (4.0, 0.55, 33, 100)]
    samples = render(payload, notes, 5.0, json.loads(args.values))
    write_wav(args.out, samples)
    print(json.dumps({"path": str(args.out), "peak": float(np.max(np.abs(samples))),
                      "rms": float(np.sqrt(np.mean(samples ** 2))), "finite": bool(np.isfinite(samples).all())}))
