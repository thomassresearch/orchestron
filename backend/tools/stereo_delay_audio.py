"""Render an explicit Stereo Delay patch through the mixer insert compiler.

Synthetic WAV input replaces only the probe source constants after compilation.
The effect, its controller initialization and the mixer remain compiler output.
Tests pass independent fixtures; this module never reads developer examples.
"""

import argparse
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tools.tube_overdrive_audio import SAMPLE_RATE, load_patch, metrics, write_float_wav


def probe_source(ksmps=32):
    nodes, connections = [], []
    for side in ("left", "right"):
        nodes.extend([dict(id=f"probe_{side}", opcode="const_a", params=dict(value=0)),
                      dict(id=f"out_{side}", opcode="outleta", params=dict(sname=side))])
        connections.append(dict(from_node_id=f"probe_{side}", from_port_id="aout",
                                to_node_id=f"out_{side}", to_port_id="asignal"))
    return PatchDocument.model_validate(dict(
        id="stereo-delay-probe", name="Delay probe source", instrument_type="continuous",
        graph=dict(nodes=nodes, connections=connections,
                   engine_config=dict(sr=SAMPLE_RATE, ksmps=ksmps)),
    ))


def insert_graph():
    routes = []
    for side in ("left", "right"):
        routes.extend([
            AudioRoute(id=f"in-{side}", sourceId="source", sourcePort=side, targetId="delay", targetPort=side,
                       kind="insert", sourceStage="raw"),
            AudioRoute(id=f"out-{side}", sourceId="delay", sourcePort=side, targetId="source", targetPort=side,
                       kind="insert", targetStage="strip"),
            AudioRoute(id=f"master-{side}", sourceId="source", sourcePort=side, targetId="$master", targetPort=side,
                       kind="main"),
        ])
    return AudioGraph(routes=routes, masterId="$master", insertOwners={"delay": "source"})


def compile_probe(patch, *, values=None, ksmps=32, mode="midi"):
    effect = patch.model_copy(deep=True)
    effect.graph.engine_config.ksmps = ksmps
    return CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(probe_source(ksmps), 0, assignment_id="source", always_on=True),
         PatchInstrumentTarget(effect, 0, assignment_id="delay", always_on=True,
                               performance_controller_values=values or {})],
        midi_input="0", rtmidi_module="none", performance_input_mode=mode,
        profile=CompilationProfile.OFFLINE if ksmps == 1 else CompilationProfile.LIVE,
        audio_graph=insert_graph(), mixer=MixerState(),
    )


def render_probe(artifact, source, seconds, *, score_events="", midi_file=None):
    """Return stereo float samples; file input deliberately has no looping."""
    with TemporaryDirectory(prefix="orchestron-stereo-delay-") as temporary:
        path = Path(temporary) / "input.wav"
        write_float_wav(path, source)
        orc = artifact.orc
        for side in ("left", "right"):
            replacement = (f'a_probe_wav_left, a_probe_wav_right diskin2 "{path}", 1, 0, 0\n'
                           if side == "left" else "")
            orc, count = re.subn(rf"(?m)^(\s*)(a_probe_{side}_aout_\d+) = 0(?:\.0)?\s*$",
                                lambda m: f"{m[1]}{replacement}{m[2]} = a_probe_wav_{side}", orc)
            if count != 1:
                raise RuntimeError(f"Expected one {side} probe source constant, found {count}")
        midi_option = f'-F "{midi_file}"' if midi_file else ""
        csd = (f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0 {midi_option}\n</CsOptions>\n<CsInstruments>\n{orc}\n"
               f"</CsInstruments>\n<CsScore>\nf 0 {seconds + 0.1}\n{score_events}\n</CsScore>\n</CsoundSynthesizer>")
        cs = load_ctcsound_module().Csound()
        try:
            if cs.compileCsdText(csd) != 0 or cs.start() != 0:
                raise RuntimeError("Csound could not start the compiled delay probe")
            length = round(seconds * SAMPLE_RATE)
            samples = np.empty((length, 2))
            for start in range(0, length, cs.ksmps()):
                if cs.performKsmps() != 0:
                    raise RuntimeError("Csound ended before the delay probe finished")
                frames = min(cs.ksmps(), length - start)
                samples[start:start + frames] = cs.spout().reshape(-1, 2)[:frames]
            return samples
        finally:
            cs.cleanup()
            cs.reset()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("patch", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    patch = load_patch(args.patch)
    # Distinct pitches and staggered decaying bursts make channel motion visible.
    source = np.zeros((SAMPLE_RATE, 2))
    t = np.arange(SAMPLE_RATE // 5) / SAMPLE_RATE
    for start, channel, frequency in [(0, 0, 330), (12000, 1, 550), (24000, 0, 660)]:
        source[start:start + len(t), channel] += 0.2 * np.sin(2 * np.pi * frequency * t) * np.exp(-30 * t)
    settings = {
        "default": {}, "dry": {"sd_feedback": 0}, "stereo_min": {"sd_stereo": 0},
        "stereo_max": {"sd_stereo": 1}, "feedback_max": {"sd_feedback": 0.9},
        "tempo_min": {"sd_tempo": 40}, "tempo_max": {"sd_tempo": 180},
        "beats_min": {"sd_beats": 1}, "beats_max": {"sd_beats": 16},
    }
    report = {}
    for name, values in settings.items():
        interval = 60 * values.get("sd_beats", 4) / values.get("sd_tempo", 120)
        feedback = values.get("sd_feedback", 0.5)
        repeats = int(np.ceil(np.log(1e-5) / np.log(feedback))) if feedback else 1
        seconds = 1 + interval * repeats
        samples = render_probe(compile_probe(patch, values=values), source, seconds)
        write_float_wav(args.out_dir / f"{name}.wav", samples)
        report[name] = dict(**metrics(samples), seconds=seconds, settings=values)
    (args.out_dir / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"renders": len(report), "finite": all(v["finite"] for v in report.values()),
                      "max_peak": max(v["peak"] for v in report.values()), "output": str(args.out_dir)}))


if __name__ == "__main__":
    main()
