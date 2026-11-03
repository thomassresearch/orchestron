"""Versioned clip schedule shared by live rendering and offline export.

The frontend keeps reusable, typed definitions. Preparation resolves their bounded
hierarchy once into source spans; repeats remain compact and are located lazily.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_CLIP_TICKS = 20160 * 1000000
Tick = Annotated[int, Field(strict=True, ge=0, le=MAX_CLIP_TICKS)]
Duration = Annotated[int, Field(strict=True, gt=0, le=MAX_CLIP_TICKS)]


class ClipSpan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    pad: Annotated[int, Field(strict=True, ge=0, le=511)] | None
    length: Duration


class RuntimeClip(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1, max_length=128)
    start: Tick
    length: Duration
    offset: Tick = 0
    mode: Literal["once", "loop"] = "once"
    content: list[ClipSpan] = Field(min_length=1, max_length=65536)

    @model_validator(mode="after")
    def bounded(self):
        if self.start + self.length > MAX_CLIP_TICKS or sum(s.length for s in self.content) > MAX_CLIP_TICKS:
            raise ValueError("Clip time exceeds the supported extent.")
        return self


class ClipSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal[1] = 1
    clips: list[RuntimeClip] = Field(default_factory=list, max_length=2048)
    cycle_ticks: Duration | None = None
    end: Duration

    @model_validator(mode="after")
    def valid_intervals(self):
        previous_end = 0
        ids = set()
        leaves = 0
        for clip in self.clips:
            if clip.id in ids or clip.start < previous_end:
                raise ValueError("Clip identities must be unique and clips ordered without overlap.")
            previous_end = clip.start + clip.length
            if previous_end > self.end or self.cycle_ticks is not None and previous_end > self.cycle_ticks:
                raise ValueError("Clip exceeds the song or lane cycle.")
            ids.add(clip.id)
            leaves += len(clip.content)
        if leaves > 65536:
            raise ValueError("Clip schedule expansion limit exceeded.")
        return self


@dataclass(frozen=True, slots=True)
class ClipPosition:
    pad: int | None
    source_start: int
    boundary: int | None
    occurrence: tuple[str, int, int] | None


class PreparedClipSchedule:
    """Immutable lookup indexes; O(log clips + log leaves), independent of loop length."""

    def __init__(self, schedule: ClipSchedule):
        self.schedule = schedule
        self.starts = tuple(c.start for c in schedule.clips)
        self.content_ends = []
        for clip in schedule.clips:
            total = 0
            ends = []
            for span in clip.content:
                total += span.length
                ends.append(total)
            self.content_ends.append(tuple(ends))

    def locate(self, at: int) -> ClipPosition:
        schedule = self.schedule
        cycle_origin = at - at % schedule.cycle_ticks if schedule.cycle_ticks else 0
        position = at - cycle_origin
        cycle_end = cycle_origin + (schedule.cycle_ticks or schedule.end)
        index = bisect_right(self.starts, position) - 1
        if index < 0 or position >= self.starts[index] + schedule.clips[index].length:
            following = index + 1
            boundary = cycle_origin + self.starts[following] if following < len(self.starts) else cycle_end
            # A silent span has one stable phase. After a finite song ends there
            # is no next clip event, even if a manual source/audition keeps the
            # shared clock running. Scheduling at + 1 floods the render path.
            rest_start = cycle_origin + (self.starts[index] + schedule.clips[index].length if index >= 0 else 0)
            return ClipPosition(None, rest_start, boundary if boundary > at else None, None)
        clip = schedule.clips[index]
        ends = self.content_ends[index]
        raw = clip.offset + position - clip.start
        duration = ends[-1]
        clip_end = cycle_origin + clip.start + clip.length
        if clip.mode == "once" and raw >= duration:
            rest_start = cycle_origin + clip.start + max(0, duration - clip.offset)
            return ClipPosition(None, rest_start, clip_end, (clip.id, 0, -1))
        turn, offset = divmod(raw, duration) if clip.mode == "loop" else (0, raw)
        leaf_index = bisect_right(ends, offset)
        leaf_start = ends[leaf_index - 1] if leaf_index else 0
        source_start = cycle_origin + clip.start - clip.offset + turn * duration + leaf_start
        return ClipPosition(clip.content[leaf_index].pad, source_start,
                            min(clip_end, source_start + clip.content[leaf_index].length),
                            (clip.id, turn, leaf_index))
