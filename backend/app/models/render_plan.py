"""Immutable, internal planning records. A candidate plan never authorizes execution."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class RenderEngineSettings:
    sample_rate: int
    ksmps: int
    channels: int
    zero_dbfs: float
    software_buffer: int
    hardware_buffer: int


@dataclass(frozen=True, slots=True)
class RenderStage:
    id: str
    kind: str
    instance_id: str | None = None
    instrument_reference: str = ""
    note_reference: str | None = None
    midi_channel: int = 0
    always_on: bool = True
    controls: tuple[str, ...] = ()
    meters: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RenderConnection:
    source: str
    outlet: str
    target: str
    inlet: str


@dataclass(frozen=True, slots=True)
class RenderResourceAccess:
    resource: str
    stage: str
    node: str
    scope: Literal["voice", "instance", "performance", "host", "unknown"]
    access: Literal["read", "write", "read_write", "subscribe"]


@dataclass(frozen=True, slots=True)
class RenderCoLocation:
    stages: tuple[str, ...]
    reason: str


@dataclass(frozen=True, slots=True)
class RenderHelper:
    id: str
    stages: tuple[str, ...]
    instrument_reference: str | None = None


@dataclass(frozen=True, slots=True)
class RenderPlanDiagnostic:
    code: str
    detail: str
    stages: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RenderDependencyGraph:
    capability_version: str
    input_hash: str
    source_kind: Literal["explicit", "legacy"]
    engine: RenderEngineSettings
    # Canonical execution order; connections retain compiler contribution order.
    stages: tuple[RenderStage, ...]
    connections: tuple[RenderConnection, ...]
    dependencies: tuple[tuple[str, str], ...]
    resources: tuple[RenderResourceAccess, ...]
    colocations: tuple[RenderCoLocation, ...]
    helpers: tuple[RenderHelper, ...]
    blockers: tuple[RenderPlanDiagnostic, ...]
    downstream_stages: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RenderStageCost:
    stage: str
    microseconds: float


@dataclass(frozen=True, slots=True)
class RenderCostProfile:
    """Caller-supplied per-block estimates, including helper/voice work in its stage.

    No costs are inferred from node count. Provenance is descriptive, not proof
    that a runtime/build is qualified. T07 must establish trusted admission.
    """

    provenance: str
    stages: tuple[RenderStageCost, ...]
    dispatch_microseconds: float
    copy_microseconds_per_sample: float
    minimum_reduction: float = 0.2


@dataclass(frozen=True, slots=True)
class RenderPartition:
    id: str
    stages: tuple[str, ...]
    helpers: tuple[str, ...]
    predecessors: tuple[str, ...]
    successors: tuple[str, ...]
    controls: tuple[str, ...]
    meters: tuple[str, ...]
    # Note assignment does not describe all MIDI readers. Do not prune events.
    midi_delivery: Literal["ordered_broadcast"] = "ordered_broadcast"


@dataclass(frozen=True, slots=True)
class RenderBoundaryBus:
    id: str
    connection_index: int
    producer: str
    consumer: str
    frames: int
    sample_bytes: int
    slots: Literal[2] = 2
    channels: Literal[1] = 1
    source_semantics: Literal["summed_outlet"] = "summed_outlet"


@dataclass(frozen=True, slots=True)
class RenderPartitionPlan:
    version: Literal[1]
    graph: RenderDependencyGraph
    layout: Literal["single", "coarse"]
    requested_mode: Literal["single", "auto", "parallel"]
    partitions: tuple[RenderPartition, ...]
    buses: tuple[RenderBoundaryBus, ...]
    # Every connection is accounted for exactly once, as local or as a cut bus.
    local_connections: tuple[int, ...]
    diagnostics: tuple[RenderPlanDiagnostic, ...]
    cost_profile: RenderCostProfile | None
    single_microseconds: float | None
    candidate_microseconds: float | None
    shared_audio_bytes: int
    worker_limit: int
    shared_audio_limit: int
    sample_bytes: int
    plan_hash: str
    selected_renderer: Literal["single"] = "single"
    execution_eligible: Literal[False] = False
