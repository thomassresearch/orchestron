"""Render an explicit effect patch through the real mixer insert compiler.

The harness accepts patch documents; tests use independent versioned fixtures.
Run with --help for reproducible example auditions and level-matched comparisons.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


SAMPLE_RATE = 48000
SCENARIOS = {
    "silence": ("oscil3", [250], 0.0),
    "sine": ("oscil3", [250], 0.25),
    "bass": ("vco2", [55], 0.3),
    "chord": ("oscil3", [220, 277.182631, 329.627557], 0.15),
    "bright": ("vco2", [1760, 2217.461048], 0.2),
}


def compile_probe(patch, *, values=None, scenario="sine", amplitude=None, right=True, ksmps=32, mode="midi"):
    """Compile both source and effect, including owner-return insert routing."""
    opcode, frequencies, default_amplitude = SCENARIOS[scenario]
    amplitude = default_amplitude if amplitude is None else amplitude
    nodes = [dict(id="envelope", opcode="madsr", params=dict(iatt=0.01, idec=0.01, islev=1, irel=0.05))]
    connections, formulas = [], {}
    for side in ("left", "right"):
        nodes.append(dict(id=side, opcode="outleta", params=dict(sname=side)))
        for index, frequency in enumerate(frequencies):
            identity = f"{side}_{index}"
            amp_port, freq_port, output = ("amp", "freq", "asig") if opcode == "oscil3" else ("kamp", "kcps", "asig")
            nodes.append(dict(id=identity, opcode=opcode, params={freq_port: frequency}))
            connections.extend([
                dict(from_node_id="envelope", from_port_id="kenv", to_node_id=identity, to_port_id=amp_port),
                dict(from_node_id=identity, from_port_id=output, to_node_id=side, to_port_id="asignal"),
            ])
            level = amplitude if side == "left" or right else 0
            formulas[f"{identity}::{amp_port}"] = {"expression": f"in1 * {level}"}
    source = PatchDocument.model_validate(dict(
        id="tube-probe-source", name="Tube probe source", graph=dict(
            nodes=nodes, connections=connections, ui_layout=dict(input_formulas=formulas),
            engine_config=dict(sr=SAMPLE_RATE, ksmps=ksmps),
        ),
    ))
    effect = patch.model_copy(deep=True)
    effect.graph.engine_config.ksmps = ksmps
    routes = []
    for side in ("left", "right"):
        routes.extend([
            AudioRoute(id=f"in-{side}", sourceId="source", sourcePort=side, targetId="tube", targetPort=side,
                       kind="insert", sourceStage="raw"),
            AudioRoute(id=f"out-{side}", sourceId="tube", sourcePort=side, targetId="source", targetPort=side,
                       kind="insert", targetStage="strip"),
            AudioRoute(id=f"master-{side}", sourceId="source", sourcePort=side, targetId="$master", targetPort=side,
                       kind="main"),
        ])
    return CompilerService(OpcodeService(icon_prefix="/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(source, 1, assignment_id="source"),
         PatchInstrumentTarget(effect, 0, assignment_id="tube", always_on=True, performance_controller_values=values or {})],
        midi_input="0", rtmidi_module="none", performance_input_mode=mode,
        profile=CompilationProfile.OFFLINE if ksmps == 1 else CompilationProfile.LIVE,
        audio_graph=AudioGraph(routes=routes, masterId="$master", insertOwners={"tube": "source"}), mixer=MixerState(),
    )


def render_probe(artifact, *, seconds=2.5, note_seconds=2.0):
    cs = load_ctcsound_module().Csound()
    ref = artifact.manifest["instrumentReferences"]["source"]
    csd = (f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n<CsInstruments>\n{artifact.orc}\n"
           f"</CsInstruments>\n<CsScore>\ni {ref} 0 {note_seconds}\nf 0 {seconds + 0.1}\n"
           "</CsScore>\n</CsoundSynthesizer>")
    try:
        if cs.compileCsdText(csd) != 0 or cs.start() != 0:
            raise RuntimeError("Csound could not start the compiled insert probe")
        frames = []
        for _ in range(int(np.ceil(seconds * SAMPLE_RATE / cs.ksmps()))):
            if cs.performKsmps() != 0:
                raise RuntimeError("Csound ended before the probe finished")
            frames.append(cs.spout().copy().reshape(-1, 2))
        return np.concatenate(frames)[:round(seconds * SAMPLE_RATE)]
    finally:
        cs.cleanup()
        cs.reset()


def metrics(samples):
    return dict(peak=float(np.max(np.abs(samples))), rms=float(np.sqrt(np.mean(samples ** 2))),
                mean=np.mean(samples, axis=0).tolist(), finite=bool(np.isfinite(samples).all()),
                over_full_scale=int(np.sum(np.abs(samples) > 1)))


def write_float_wav(path, samples):
    data = np.asarray(samples, dtype="<f4").tobytes()
    fmt = struct.pack("<HHIIHH", 3, 2, SAMPLE_RATE, SAMPLE_RATE * 8, 8, 32)
    path.write_bytes(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<I", 16)
                     + fmt + b"data" + struct.pack("<I", len(data)) + data)


def load_patch(path):
    data = json.loads(path.read_text())
    if "sourcePatchId" in data:
        definition = ExportedPatchDefinition.model_validate(data)
        data = dict(id=definition.source_patch_id, **definition.model_dump(exclude={"source_patch_id"}))
    return PatchDocument.model_validate(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("patch", type=Path)
    parser.add_argument("--original", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    patch = load_patch(args.patch)
    settings = {"minimum": dict(tube_drive_db=0, tube_tone_hz=2000, tube_output_db=-18),
                "default": {}, "maximum": dict(tube_drive_db=24, tube_tone_hz=12000, tube_output_db=6),
                "drive_min": dict(tube_drive_db=0), "drive_max": dict(tube_drive_db=24),
                "tone_min": dict(tube_tone_hz=2000), "tone_max": dict(tube_tone_hz=12000),
                "output_min": dict(tube_output_db=-18), "output_max": dict(tube_output_db=6)}
    report, defaults = {}, {}
    for scenario in SCENARIOS:
        for label, values in settings.items():
            samples = render_probe(compile_probe(patch, values=values, scenario=scenario))
            name = f"{scenario}_{label}"
            write_float_wav(args.out_dir / f"{name}.wav", samples)
            report[name] = metrics(samples)
            if label == "default":
                defaults[scenario] = samples
    if args.original:
        original = load_patch(args.original)
        for scenario, target in defaults.items():
            if scenario == "silence":
                continue
            old = render_probe(compile_probe(original, scenario=scenario))
            write_float_wav(args.out_dir / f"{scenario}_original.wav", old)
            # Match each full active passage to -20 dBFS RMS, with silence between A/B.
            clips = [clip * (0.1 / np.sqrt(np.mean(clip[:96000] ** 2))) for clip in (old, target)]
            comparison = np.concatenate([clips[0], np.zeros((12000, 2)), clips[1]])
            write_float_wav(args.out_dir / f"{scenario}_original_then_tube_matched.wav", comparison)
    (args.out_dir / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"renders": len(report), "max_peak": max(v["peak"] for v in report.values()),
                      "finite": all(v["finite"] for v in report.values()), "output": str(args.out_dir)}))


if __name__ == "__main__":
    main()
