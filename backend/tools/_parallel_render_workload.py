"""Versioned synthetic mixer workloads; no developer examples or user data."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.models.audio import AudioGraph, AudioRoute, MixerSend, MixerState
from backend.app.models.patch import Connection, EngineConfig, NodeInstance, PatchDocument, PatchGraph
from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService

FIXTURE = Path(__file__).resolve().parents[1] / "tests/fixtures/parallel_render/workloads.json"


class Workload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=r"^[a-z0-9_]+$", max_length=64)
    sources: int = Field(ge=1, le=8)
    voices: int = Field(ge=1, le=16)
    filter_count: int = Field(ge=0, le=32)
    topology: Literal["private", "shared"]


class BaselineSuite(BaseModel):
    """Constants are fixed for this version; changes require a deliberate revision."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal[1]
    sample_rate: Literal[48000]
    ksmps: tuple[Literal[1], Literal[32]]
    warmup_frames: Literal[2048]
    request_frames: Literal[512]
    edit_frame: Literal[4096]
    control_frame: Literal[8192]
    cases: tuple[Workload, ...] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def unique_cases(self):
        if len({row.id for row in self.cases}) != len(self.cases):
            raise ValueError("Duplicate workload identity")
        return self


def load_workloads() -> dict[str, Workload]:
    return {row.id: row for row in BaselineSuite.model_validate_json(FIXTURE.read_text()).cases}


def connection(source, output, target, inlet):
    return Connection(from_node_id=source, from_port_id=output, to_node_id=target, to_port_id=inlet)


def build_workload(case: Workload, ksmps: int):
    """Compile the real LIVE mixer path, retaining independent raw/dry/send buses."""
    if ksmps not in (1, 32):
        raise ValueError("Baseline supports ksmps 1 or 32")
    engine = EngineConfig(sr=48000, ksmps=ksmps)
    targets, routes, sends = [], [], {}

    def target(identity, nodes, links, channel=0):
        return PatchInstrumentTarget(
            patch=PatchDocument(id=identity, name=identity, always_on=channel == 0,
                                graph=PatchGraph(nodes=nodes, connections=links, engine_config=engine)),
            assignment_id=identity, midi_channel=channel, always_on=channel == 0,
        )

    def route(identity, source, output, dest, inlet, kind="main"):
        routes.append(AudioRoute(id=identity, sourceId=source, sourcePort=output,
                                 targetId=dest, targetPort=inlet, kind=kind))

    for index in range(case.sources):
        identity = f"source{index}"
        nodes = [NodeInstance(id="pitch", opcode="cpsmidi"),
                 NodeInstance(id="amp", opcode="ampmidi", params={"iscal": .04 / case.voices}),
                 NodeInstance(id="osc", opcode="vco2"), NodeInstance(id="out", opcode="outs")]
        links = [connection("pitch", "kfreq", "osc", "kcps"), connection("amp", "iamp", "osc", "kamp")]
        last, output = "osc", "asig"
        for stage in range(case.filter_count):
            name = f"filter{stage}"
            nodes.append(NodeInstance(id=name, opcode="moogladder", params={"kcf": 1800 + index * 150, "kres": .15}))
            links.append(connection(last, output, name, "ain"))
            last, output = name, "aout"
        links.extend(connection(last, output, "out", side) for side in ("left", "right"))
        targets.append(target(identity, nodes, links, index + 1))
        effect = f"delay{index}"
        targets.append(target(effect, [NodeInstance(id="in", opcode="inleta", params={"sname": "in"}),
                                       NodeInstance(id="delay", opcode="delay", params={"idlt": .003 + index * .001}),
                                       NodeInstance(id="out", opcode="outleta", params={"sname": "out"})],
                              [connection("in", "asignal", "delay", "asig"),
                               connection("delay", "aout", "out", "asignal")]))
        route(f"private{index}", identity, "$direct.left", effect, "in", "send")
        sends[f"private{index}"] = MixerSend(gainDb=-9, tap="pre" if index % 2 else "post")
        for side in ("left", "right"):
            # The last source has a deliberate dry direct path alongside its wet return.
            dest = "$output" if index == case.sources - 1 else "$master"
            route(f"dry{index}{side}", identity, f"$direct.{side}", dest, side)
            route(f"wet{index}{side}", effect, "out", "$master", side)
        if case.topology == "shared":
            route(f"shared{index}", identity, "$direct.left", "shared", "in", "send")
            sends[f"shared{index}"] = MixerSend(gainDb=-12)
    if case.topology == "shared":
        targets.append(target("shared", [NodeInstance(id="in", opcode="inleta", params={"sname": "in"}),
                                          NodeInstance(id="delay", opcode="delay", params={"idlt": .02}),
                                          NodeInstance(id="out", opcode="outleta", params={"sname": "out"})],
                              [connection("in", "asignal", "delay", "asig"),
                               connection("delay", "aout", "out", "asignal")]))
        for side in ("left", "right"):
            route(f"return{side}", "shared", "out", "$master", side)
    graph = AudioGraph(masterId="$master", routes=routes)
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, audio_graph=graph, mixer=MixerState(sends=sends), midi_input="internal:loopback", rtmidi_module="null")
    request = SessionSequencerConfigRequest.model_validate({
        "timing": {"tempo_bpm": 240, "steps_per_beat": 4}, "step_count": 16, "playback_end_step": 10000,
        "tracks": [{"track_id": f"source{i}-voice{v}", "midi_channel": i + 1, "length_beats": 1,
                    "pads": [{"pad_index": 0, "length_beats": 1, "steps": [48 + v, 60 + v, None, 55 + v]}]}
                   for i in range(case.sources) for v in range(case.voices)],
    })
    return artifact, request
