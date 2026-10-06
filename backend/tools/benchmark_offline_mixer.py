"""Compare compilation profiles with identical synthetic mixer inputs.

Run: uv run python -m backend.tools.benchmark_offline_mixer
Times include Csound startup/compilation, but exclude Python compilation and disk
audio output. This measures routing overhead, not the speed of a typical song.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import statistics
import subprocess
import tempfile
import time

from backend.app.models.audio import AudioGraph, AudioRoute, MixerSend, MixerState, MixerStrip
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchDocument, PatchGraph
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


def _workload():
    targets = []
    routes = []
    for index in range(4):
        identity = f"source{index}"
        nodes = [NodeInstance(id=side, opcode="const_a", params={"value": (index + 1) * amplitude})
                 for side, amplitude in (("left", 0.003), ("right", 0.005))]
        nodes.append(NodeInstance(id="out", opcode="outs"))
        graph = PatchGraph(nodes=nodes, connections=[
            Connection(from_node_id=side, from_port_id="aout", to_node_id="out", to_port_id=side)
            for side in ("left", "right")], engine_config=EngineConfig(sr=48000, ksmps=1))
        targets.append(PatchInstrumentTarget(patch=PatchDocument(name=identity, graph=graph),
                                              assignment_id=identity, midi_channel=index + 1))
        if index < 3:
            for side in ("left", "right"):
                routes.append(AudioRoute(id=f"main{index}{side}", sourceId=identity, sourcePort=f"$direct.{side}",
                                         targetId="$master", targetPort=side, kind="main"))
        routes.append(AudioRoute(id=f"send{index}", sourceId=identity, sourcePort="$direct.left",
                                 targetId="delay", targetPort="left", kind="send"))
    graph = PatchGraph(nodes=[
        NodeInstance(id="in", opcode="inleta", params={"sname": "left"}),
        NodeInstance(id="delay", opcode="delay", params={"idlt": 0.02}),
        NodeInstance(id="out", opcode="outs"),
    ], connections=[
        Connection(from_node_id="in", from_port_id="asignal", to_node_id="delay", to_port_id="asig"),
        *[Connection(from_node_id="delay", from_port_id="aout", to_node_id="out", to_port_id=side)
          for side in ("left", "right")],
    ], engine_config=EngineConfig(sr=48000, ksmps=1))
    targets.append(PatchInstrumentTarget(patch=PatchDocument(name="Delay", graph=graph, always_on=True),
                                          assignment_id="delay", midi_channel=0, always_on=True))
    mixer = MixerState(strips={"source1": MixerStrip(gainDb=-6, balance=0.3), "$master": MixerStrip(gainDb=-3)},
                       sends={f"send{i}": MixerSend(gainDb=-4, tap="pre" if i == 1 else "post") for i in range(4)})
    return targets, AudioGraph(masterId="$master", routes=routes), mixer


def _csd(artifact, duration):
    events = []
    for index in range(4):
        reference = artifact.manifest["instrumentReferences"][f"source{index}"]
        for note in range(int((duration - 0.5) * 12)):
            start = note / 12 + index / 48000
            events.append((start, f"i {reference} {start:.9f} 0.24"))
    score = "\n".join(event for _, event in sorted(events))
    return (f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n"
            f"<CsInstruments>\n{artifact.orc}\n</CsInstruments>\n<CsScore>\n{score}\n"
            f"f 0 {duration}\n</CsScore>\n</CsoundSynthesizer>\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=30, help="Audio seconds per measured render (default: 30)")
    parser.add_argument("--repeats", type=int, default=3, help="Measured runs per profile (default: 3)")
    args = parser.parse_args()
    if args.duration < 1 or args.repeats < 1:
        parser.error("duration must be at least 1 second and repeats at least 1")
    executable = shutil.which("csound")
    if not executable:
        parser.error("Csound executable is required")
    targets, graph, mixer = _workload()
    compiler = CompilerService(OpcodeService("/static/icons"))
    artifacts = {profile: compiler.compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", audio_graph=graph, mixer=mixer, profile=profile,
        performance_input_mode="score") for profile in CompilationProfile}
    timings = {profile: [] for profile in artifacts}
    with tempfile.TemporaryDirectory(prefix="orchestron-offline-benchmark-") as directory:
        path = Path(directory) / "benchmark.csd"

        def measure(profile, duration):
            path.write_text(_csd(artifacts[profile], duration))
            started = time.perf_counter()
            result = subprocess.run([executable, str(path)], capture_output=True, timeout=max(60, duration * 10))
            elapsed = time.perf_counter() - started
            if result.returncode:
                raise RuntimeError(result.stderr.decode(errors="replace"))
            return elapsed

        for profile in artifacts:
            measure(profile, 1)  # Warm up separately, outside the reported timings.
        for trial in range(args.repeats):
            for profile in list(artifacts)[::1 if trial % 2 == 0 else -1]:
                timings[profile].append(measure(profile, args.duration))
    medians = {profile: statistics.median(values) for profile, values in timings.items()}
    print(json.dumps({
        "audio_seconds": args.duration, "sample_rate": 48000, "ksmps": 1,
        "note_sources": 4, "notes": 4 * int((args.duration - 0.5) * 12),
        "logging": "-m0", "audio_output": "disabled", "includes_csound_startup_and_compile": True,
        "seconds": timings, "median_seconds": medians,
        "speedup": medians[CompilationProfile.LIVE] / medians[CompilationProfile.OFFLINE],
    }, indent=2))


if __name__ == "__main__":
    main()
