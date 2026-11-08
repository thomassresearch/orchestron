"""Internal process contracts; runtime ownership is validated by the coordinator."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identity = Annotated[str, Field(min_length=1, max_length=128)]
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Nonnegative = Annotated[int, Field(ge=0)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)


class RendererPolicy(Contract):
    """Immutable session policy, independent of synthesis and browser buffering."""
    mode: Literal["single", "auto", "parallel"] = "single"
    coordination_frames: int = Field(default=256, ge=1, le=1024)
    max_workers: int = Field(default=8, ge=1, le=64)
    max_shared_memory_bytes: int = Field(default=64 * 1024 * 1024, ge=1024, le=1024 * 1024 * 1024)
    startup_timeout_seconds: float = Field(default=30.0, ge=1, le=300)
    stop_timeout_seconds: float = Field(default=2.0, ge=.1, le=30)
    render_timeout_seconds: float = Field(default=5.0, ge=.1, le=60)
    slots_per_bus: Literal[2] = 2
    max_inflight_blocks: Literal[1] = 1  # One coordination batch, possibly multiple k-blocks.


class EngineFormat(Contract):
    sample_rate: int = Field(ge=8000, le=192000)
    ksmps: int = Field(ge=1, le=192000)
    zero_dbfs: float = Field(gt=0)
    native_sample_type: Literal["float32", "float64"]


class BusSlot(Contract):
    bus_id: Identity
    slot: Literal[0, 1]
    generation: Nonnegative


class MidiDelivery(Contract):
    sequence: Annotated[int, Field(ge=1)]
    # Session track IDs allow 256 characters; parent ownership tags add prefixes
    # (for example lane:). Preserve those tags without truncation or collisions.
    source: Annotated[str, Field(min_length=1, max_length=1024)]
    target_engine_sample: Nonnegative
    message: tuple[int, int, int]
    late: bool

    @field_validator("message")
    @classmethod
    def midi_bytes(cls, value):
        if not 0x80 <= value[0] <= 0xEF or not all(0 <= item <= 127 for item in value[1:]):
            raise ValueError("Expected one channel-voice MIDI message")
        return value


class ControlWrite(Contract):
    channel: Annotated[str, Field(min_length=1, max_length=256)]
    value: float


class Envelope(Contract):
    protocol_version: Literal[1]
    epoch: Annotated[int, Field(ge=1)]
    partition_id: Identity
    plan_hash: Digest


class Init(Envelope):
    type: Literal["INIT"] = "INIT"
    artifact_hash: Digest
    engine: EngineFormat
    # Actual CSD/shared-memory descriptors are pre-provisioned immutable resources,
    # referenced by digest. The control envelope never embeds arbitrary objects.


class Ready(Envelope):
    type: Literal["READY"] = "READY"
    artifact_hash: Digest
    engine: EngineFormat


class Block(Envelope):
    sequence: Nonnegative
    sample_start: Nonnegative
    frame_count: Annotated[int, Field(ge=1, le=192000)]
    control_revision: Nonnegative
    slots: tuple[BusSlot, ...] = Field(max_length=2048)

    @model_validator(mode="after")
    def unique_buses(self):
        if len({slot.bus_id for slot in self.slots}) != len(self.slots):
            raise ValueError("A block cannot bind the same bus twice")
        return self


class Render(Block):
    type: Literal["RENDER"] = "RENDER"
    midi: tuple[MidiDelivery, ...] = Field(default=(), max_length=16384)
    controls: tuple[ControlWrite, ...] = Field(default=(), max_length=16384)

    @model_validator(mode="after")
    def validate_delivery(self):
        end = self.sample_start + self.frame_count
        if any(not self.sample_start <= event.target_engine_sample < end for event in self.midi):
            raise ValueError("MIDI must already be drained and clamped to this block")
        # The scheduler orders original deadlines, then clamps late events to S.
        # Re-sorting those clamped events by sequence would change valid delivery.
        # Identical events are also allowed for deferred lane releases.
        for previous, current in zip(self.midi, self.midi[1:]):
            if current.target_engine_sample < previous.target_engine_sample or (
                current.target_engine_sample == previous.target_engine_sample
                and not (previous.late or current.late) and current.sequence < previous.sequence
            ):
                raise ValueError("MIDI ordering must match the authoritative scheduler")
        if len({control.channel for control in self.controls}) != len(self.controls):
            raise ValueError("Control writes must be coalesced before dispatch")
        return self


class Done(Block):
    type: Literal["DONE"] = "DONE"


class RenderBatch(Block):
    """One fenced interval containing unchanged, individually timed k-blocks."""
    type: Literal["RENDER_BATCH"] = "RENDER_BATCH"
    blocks: tuple[Render, ...] = Field(min_length=2, max_length=1024)

    @model_validator(mode="after")
    def contiguous_blocks(self):
        first = self.blocks[0]
        if self.frame_count != len(self.blocks) * first.frame_count:
            raise ValueError("Batch frame count does not match its synthesis blocks")
        revision = first.control_revision
        for index, block in enumerate(self.blocks):
            if (any(getattr(block, key) != getattr(self, key) for key in
                    ("protocol_version", "epoch", "partition_id", "plan_hash", "sequence", "slots"))
                    or block.sample_start != self.sample_start + index * first.frame_count
                    or block.frame_count != first.frame_count or block.control_revision < revision):
                raise ValueError("Batch blocks must retain exact ownership, timing and revision order")
            revision = block.control_revision
        if revision != self.control_revision:
            raise ValueError("Batch final control revision mismatch")
        return self


class Error(Envelope):
    type: Literal["ERROR"] = "ERROR"
    code: Literal["compile", "start", "render", "protocol", "capacity", "shutdown"]
    detail: Annotated[str, Field(max_length=2048)]
    last_complete_sequence: int = Field(ge=-1)


class Stop(Envelope):
    type: Literal["STOP"] = "STOP"


class Stopped(Envelope):
    type: Literal["STOPPED"] = "STOPPED"


RenderMessage = Annotated[Init | Ready | Render | RenderBatch | Done | Error | Stop | Stopped, Field(discriminator="type")]
