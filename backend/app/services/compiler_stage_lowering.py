"""Structured mixer lowering shared by canonical and internal realtime compilers.

Header entries retain their original order and formatting. Ownership is attached
before text emission; no partition is recovered by slicing generated orchestra text.
"""
from __future__ import annotations

from dataclasses import dataclass

from backend.app.models.patch import EngineConfig
from backend.app.models.render_plan import RenderConnection


@dataclass(frozen=True, slots=True)
class ScopedSetup:
    lines: tuple[str, ...]
    stages: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MidiAssignment:
    stage: str
    channel: int
    reference: str


@dataclass(frozen=True, slots=True)
class AlwaysOn:
    stage: str


@dataclass(frozen=True, slots=True)
class ControlInit:
    channel: str
    value: float


@dataclass(frozen=True, slots=True)
class LoweredStage:
    id: str
    name: str
    reference: str
    comments: tuple[str, ...]
    body: tuple[str, ...]

    def lines(self):
        return [*self.comments, f"instr {self.name}", *(" " + line for line in self.body), "endin", ""]


@dataclass(frozen=True, slots=True)
class LoweredMixer:
    header: tuple[str | ScopedSetup | MidiAssignment | AlwaysOn | ControlInit | RenderConnection, ...]
    stages: tuple[LoweredStage, ...]
    diagnostics: tuple[str, ...]
    manifest: dict
    engine: EngineConfig

    def orchestra(self):
        names = {stage.id: stage.name for stage in self.stages}
        lines = [line for entry in self.header for line in header_lines(entry, names)]
        lines.extend(line for stage in self.stages for line in stage.lines())
        return "\n".join(lines)


def header_lines(entry, names):
    from backend.app.services.compiler_orchestra import OrchestraEmitter
    quote = OrchestraEmitter._format_csound_string
    if isinstance(entry, str):
        return [entry]
    if isinstance(entry, ScopedSetup):
        return list(entry.lines)
    if isinstance(entry, MidiAssignment):
        return [f"massign {entry.channel}, {entry.reference}"]
    if isinstance(entry, AlwaysOn):
        return [f"alwayson {quote(names[entry.stage])}"]
    if isinstance(entry, ControlInit):
        return [f"chnset {entry.value:.17g}, {quote(entry.channel)}"]
    return [f"connect {quote(names[entry.source])}, {quote(entry.outlet)}, {quote(names[entry.target])}, {quote(entry.inlet)}"]


def instance_connections(resolved, identity):
    from backend.app.services.compiler_mixer import port
    result = []

    def connect(source, outlet, target, inlet):
        result.append(RenderConnection(source, outlet, target, inlet))

    patch, raw = "patch:" + identity, resolved.raw_stage(identity)
    if identity in resolved.bypass_ports:
        for name, originals in resolved.raw_ports[identity].items():
            signal = port(name)
            for original in originals:
                connect(patch, original, raw, "wet_" + signal)
            dry = resolved.bypass_ports[identity].get(name)
            for route in resolved.routes:
                if route.target_id == identity and route.target_stage == "input" and route.target_port == dry:
                    connect("route:" + route.id, "out", raw, "dry_" + signal)
    for name, originals in resolved.raw_ports[identity].items():
        if not any(r.target_id == identity and r.target_stage == "strip" and r.target_port == name
                   for r in resolved.routes):
            for original in [port(name)] if raw != patch else originals:
                connect(raw, original, "strip:" + identity, port(name))
    return tuple(result)


def route_connections(resolved, route):
    from backend.app.services.compiler_mixer import OUTPUT, port
    result = []

    def connect(source, outlet, target, inlet):
        result.append(RenderConnection(source, outlet, target, inlet))

    stage = "route:" + route.id
    if route.source_stage == "raw":
        raw = resolved.raw_stage(route.source_id)
        originals = ([port(route.source_port)] if raw.startswith("bypass:")
                     else resolved.raw_ports[route.source_id][route.source_port])
        for original in originals:
            connect(raw, original, stage, "pre")
    else:
        for tap in ("pre", "post"):
            connect("strip:" + route.source_id, tap + "_" + port(route.source_port), stage, tap)
    target = OUTPUT if route.target_id == OUTPUT else (
        "strip:" if route.target_stage == "strip" else "patch:") + route.target_id
    connect(stage, "out", target, port(route.target_port) if route.target_stage == "strip" else route.target_port)
    return tuple(result)


def live_audio_connections(resolved):
    return tuple(c for identity in resolved.by_id for c in instance_connections(resolved, identity)) + tuple(
        c for route in resolved.routes for c in route_connections(resolved, route))
