"""Internal LIVE/MIDI partition programs. No renderer selection or native execution.

Canonical CSD remains the fallback and the only public compile/export artifact.
These programs are input to a sequential native qualification harness until the
process, timing and admission gates are implemented.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

from backend.app.models.audio import MixerState
from backend.app.models.render_plan import RenderConnection, RenderPartitionPlan
from backend.app.models.session import CompileArtifact
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_mixer import OUTPUT, lower_mixer_bundle, token
from backend.app.services.compiler_orchestra import OrchestraEmitter
from backend.app.services.compiler_render_resources import stable_hash
from backend.app.services.compiler_private_tables import AUTO_TABLE_BASE, TABLE_CACHE_ENTRIES
from backend.app.services.compiler_stage_lowering import (
    AlwaysOn, ControlInit, MidiAssignment, ScopedSetup, header_lines,
)
from backend.app.services.render_partition_plan import validate_partition_plan

quote = OrchestraEmitter._format_csound_string


@dataclass(frozen=True, slots=True)
class RealtimePartitionProgram:
    id: str
    csd: str
    stages: tuple[str, ...]
    instrument_references: tuple[tuple[str, str], ...]
    note_references: tuple[tuple[str, str], ...]
    inputs: tuple[tuple[str, str], ...]  # (bus ID, native audio channel)
    outputs: tuple[tuple[str, str], ...]
    controls: tuple[str, ...]
    meters: tuple[str, ...]
    owns_output: bool


@dataclass(frozen=True, slots=True)
class RealtimePartitionCompilation:
    canonical: CompileArtifact
    plan_hash: str
    programs: tuple[RealtimePartitionProgram, ...]
    artifact_hash: str
    fallback_reasons: tuple[str, ...] = ()
    selected_renderer: Literal["single"] = "single"
    execution_eligible: Literal[False] = False


def _artifact_hash(canonical, plan_hash, programs, reasons):
    return stable_hash({"plan": plan_hash, "canonical": asdict(canonical),
                        "programs": [asdict(p) for p in programs], "fallback_reasons": reasons})


def validate_realtime_partition_compilation(compilation, plan):
    """Check complete artifact identity/ownership before the native test harness starts."""
    validate_partition_plan(plan)
    if (compilation.plan_hash != plan.plan_hash or compilation.selected_renderer != "single"
            or compilation.execution_eligible is not False
            or compilation.artifact_hash != _artifact_hash(compilation.canonical, compilation.plan_hash,
                                                           compilation.programs, compilation.fallback_reasons)):
        raise ValueError("Partition artifact identity/integrity mismatch.")
    if plan.layout == "single":
        if compilation.programs:
            raise ValueError("Single fallback cannot contain partition programs.")
        return
    if tuple(p.id for p in compilation.programs) != tuple(p.id for p in plan.partitions):
        raise ValueError("Partition artifact coverage/order mismatch.")
    for program, partition in zip(compilation.programs, plan.partitions, strict=True):
        inputs = tuple((b.id, "__vcs_partition_" + token(b.id)) for b in plan.buses if b.consumer == program.id)
        outputs = tuple((b.id, "__vcs_partition_" + token(b.id)) for b in plan.buses if b.producer == program.id)
        if (program.stages != partition.stages or program.controls != partition.controls
                or program.meters != partition.meters or program.inputs != inputs or program.outputs != outputs
                or program.owns_output != (OUTPUT in partition.stages)
                or tuple(s for s, _ in program.instrument_references) != partition.stages):
            raise ValueError("Partition artifact ownership mismatch.")


def compile_realtime_partitions(service, targets, audio_graph, mixer, plan: RenderPartitionPlan):
    """Validate original input first; never turn invalid patches/assets into fallback success."""
    mixer = mixer if mixer is not None else MixerState()
    canonical = service.compile_patch_bundle(targets, midi_input="internal:loopback", rtmidi_module="null",
                                              audio_graph=audio_graph, mixer=mixer)
    validate_partition_plan(plan)
    actual = service.analyze_realtime_graph(targets, audio_graph)
    if actual != plan.graph:
        raise CompilationError(["Partition plan does not match the current full-performance graph."])
    if plan.layout != "coarse":
        reasons = tuple(d.code for d in plan.diagnostics)
        return RealtimePartitionCompilation(canonical, plan.plan_hash, (),
                                            _artifact_hash(canonical, plan.plan_hash, (), reasons), reasons)
    table_limits = {}
    for partition in plan.partitions:
        count = sum(r.resource.startswith("private-table:") and r.memory_bytes > 0
                    for r in actual.resources if r.stage in partition.stages)
        if count:
            table_limits.update({stage: AUTO_TABLE_BASE + count * TABLE_CACHE_ENTRIES for stage in partition.stages})
    lowered = lower_mixer_bundle(service, targets, audio_graph, mixer,
                                midi_input="internal:loopback", rtmidi_module="null", private_table_limits=table_limits)
    if tuple(s.id for s in lowered.stages) != tuple(s.id for s in actual.stages):
        raise CompilationError(["Partition lowering disagrees with canonical stage order."])
    connections = tuple(e for e in lowered.header if isinstance(e, RenderConnection))
    if connections != actual.connections:
        raise CompilationError(["Partition lowering disagrees with canonical connections."])
    owner = {stage: p.id for p in plan.partitions for stage in p.stages}
    cuts = {b.connection_index: b for b in plan.buses}
    stages = {s.id: s for s in lowered.stages}
    graph_stages = {s.id: s for s in actual.stages}
    programs = []
    for partition in plan.partitions:
        names = {stage: stages[stage].name for stage in partition.stages}
        incoming = tuple(b for b in plan.buses if b.consumer == partition.id)
        outgoing = tuple(b for b in plan.buses if b.producer == partition.id)
        ingress, egress = "vcs_partition_ingress", "vcs_partition_egress"
        def channel(bus):
            return "__vcs_partition_" + token(bus.id)
        # Named instruments are allocated after explicit numeric helper references.
        helper_offset = max((int(h.instrument_reference) for h in actual.helpers
                             if h.id in partition.helpers and h.instrument_reference), default=0)
        refs = {stage: str(i + helper_offset + bool(incoming)) for i, stage in enumerate(partition.stages, 1)}
        notes = {stage: (refs[stage] if graph_stages[stage].note_reference == graph_stages[stage].instrument_reference
                         else graph_stages[stage].note_reference)
                 for stage in partition.stages if graph_stages[stage].note_reference is not None}
        lines = []
        connection_index = 0
        for entry in lowered.header:
            if isinstance(entry, RenderConnection):
                bus = cuts.get(connection_index)
                connection_index += 1
                if bus is None:
                    if owner[entry.source] == partition.id:
                        lines.extend(header_lines(entry, names))
                elif bus.producer == partition.id:
                    lines.append(f"connect {quote(names[entry.source])}, {quote(entry.outlet)}, {quote(egress)}, {quote(bus.id)}")
                elif bus.consumer == partition.id:
                    lines.append(f"connect {quote(ingress)}, {quote(bus.id)}, {quote(names[entry.target])}, {quote(entry.inlet)}")
            elif isinstance(entry, ScopedSetup):
                if set(entry.stages).issubset(partition.stages):
                    lines.extend(entry.lines)
            elif isinstance(entry, MidiAssignment):
                if entry.stage in names:
                    # Names remove any assumption that canonical numeric refs survive a subset.
                    reference = (quote(names[entry.stage]) if graph_stages[entry.stage].note_reference == graph_stages[entry.stage].instrument_reference
                                 else notes[entry.stage])
                    lines.append(f"massign {entry.channel}, {reference}")
            elif isinstance(entry, AlwaysOn):
                if entry.stage in names:
                    lines.extend(header_lines(entry, names))
            elif isinstance(entry, ControlInit):
                if entry.channel in partition.controls:
                    lines.extend(header_lines(entry, names))
            else:
                lines.extend(header_lines(entry, names))
        for bus in (*incoming, *outgoing):
            lines.append(f"chn_a {quote(channel(bus))}, {1 if bus in incoming else 2}")
        if incoming:
            lines.extend([f"alwayson {quote(ingress)}", f"instr {ingress}"])
            lines.extend(f" a_bus{i} chnget {quote(channel(bus))}" for i, bus in enumerate(incoming))
            lines.extend(f" outleta {quote(bus.id)}, a_bus{i}" for i, bus in enumerate(incoming))
            lines.extend(["endin", ""])
        lines.append("; Stage comments retain canonical references; event delivery uses the local reference manifest.")
        for stage in partition.stages:
            lines.append(f"; partition local instrument reference: {refs[stage]}")
            lines.extend(stages[stage].lines())
        if outgoing:
            # One always-on collector reads summed polyphonic outlets, even in silence.
            # Read all inlets first: Csound inlet/outlet buffers may alias.
            lines.extend([f"alwayson {quote(egress)}", f"instr {egress}"])
            lines.extend(f" a_bus{i} inleta {quote(bus.id)}" for i, bus in enumerate(outgoing))
            lines.extend(f" chnset a_bus{i}, {quote(channel(bus))}" for i, bus in enumerate(outgoing))
            lines.extend(["endin", ""])
        csd = service._wrap_csd("\n".join(lines), "internal:loopback", "null",
            software_buffer=actual.engine.software_buffer, hardware_buffer=actual.engine.hardware_buffer)
        programs.append(RealtimePartitionProgram(partition.id, csd, partition.stages, tuple(refs.items()),
            tuple(notes.items()), tuple((b.id, channel(b)) for b in incoming),
            tuple((b.id, channel(b)) for b in outgoing), partition.controls, partition.meters,
            OUTPUT in partition.stages))
    digest = _artifact_hash(canonical, plan.plan_hash, programs, ())
    result = RealtimePartitionCompilation(canonical, plan.plan_hash, tuple(programs), digest)
    validate_realtime_partition_compilation(result, plan)
    return result
