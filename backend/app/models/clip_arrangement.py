"""Versioned clip schedule shared by live rendering and offline export.

The frontend keeps reusable, typed definitions. Preparation resolves their bounded
hierarchy once into source spans; repeats remain compact and are located lazily.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.app.models.clip_transposition import OffsetPlan, RepeatIndex, MAX_TOTAL_ENTRIES, effective_plan

MAX_CLIP_TICKS = 20160 * 1000000
Tick = Annotated[int, Field(strict=True, ge=0, le=MAX_CLIP_TICKS)]
Duration = Annotated[int, Field(strict=True, gt=0, le=MAX_CLIP_TICKS)]


class ClipSpan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    pad: Annotated[int, Field(strict=True, ge=0, le=511)] | None
    length: Duration
    transpose_refs: list[Annotated[int, Field(strict=True, ge=0)]] = Field(default_factory=list, max_length=9)


class RuntimeClip(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1, max_length=128)
    start: Tick
    length: Duration
    offset: Tick = 0
    mode: Literal["once", "loop"] = "once"
    content: list[ClipSpan] = Field(min_length=1, max_length=65536)
    repeat_index_base: RepeatIndex = 0

    @model_validator(mode="after")
    def bounded(self):
        if self.start + self.length > MAX_CLIP_TICKS or sum(s.length for s in self.content) > MAX_CLIP_TICKS:
            raise ValueError("Clip time exceeds the supported extent.")
        return self


class ClipSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal[1, 2] = 1
    transpose_plans: list[OffsetPlan] = Field(default_factory=list, max_length=65536)
    clips: list[RuntimeClip] = Field(default_factory=list, max_length=2048)
    cycle_ticks: Duration | None = None
    end: Duration

    @model_validator(mode="after")
    def valid_intervals(self):
        if sum(len(p.repetitions) for p in self.transpose_plans) > MAX_TOTAL_ENTRIES:
            raise ValueError("Runtime transposition entry limit exceeded.")
        if self.version == 1 and (self.transpose_plans or any(c.repeat_index_base or any(s.transpose_refs for s in c.content) for c in self.clips)):
            raise ValueError("Transposition requires runtime schedule v2.")
        previous_end = 0
        ids = set()
        leaves = 0
        for clip in self.clips:
            duration = sum(s.length for s in clip.content)
            if clip.repeat_index_base + ((clip.offset + clip.length - 1) // duration if clip.mode == "loop" else 0) > 40320000000:
                raise ValueError("Logical repetition extent exceeded.")
            for span in clip.content:
                if any(ref >= len(self.transpose_plans) for ref in span.transpose_refs) or span.pad is None and span.transpose_refs:
                    raise ValueError("Invalid runtime transposition references.")
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
    transpose: tuple[int, int] = (0, 0)
    logical_pass: int = 0


class PreparedClipSchedule:
    """Immutable lookup indexes; O(log clips + log leaves), independent of loop length."""

    def __init__(self, schedule: ClipSchedule):
        self.schedule = schedule
        self.phase_signature = (schedule.end, schedule.cycle_ticks, tuple((c.id,c.start,c.length,c.offset,c.mode,tuple((s.pad,s.length) for s in c.content)) for c in schedule.clips))
        self.starts = tuple(c.start for c in schedule.clips)
        self.content_ends = []
        self.effective = {}
        self.span_plans = []
        entry_count = 0
        for clip in schedule.clips:
            total = 0
            ends = []
            plans = []
            for span in clip.content:
                refs = tuple(span.transpose_refs)
                if refs not in self.effective:
                    plan = effective_plan([schedule.transpose_plans[i] for i in refs])
                    entry_count += len(plan[1])
                    if entry_count > MAX_TOTAL_ENTRIES:
                        raise ValueError("Effective transposition entry limit exceeded.")
                    self.effective[refs] = plan
                plans.append(self.effective[refs])
                total += span.length
                ends.append(total)
            self.content_ends.append(tuple(ends))
            self.span_plans.append(tuple(plans))

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
        base, entries = self.span_plans[index][leaf_index]
        logical_pass = clip.repeat_index_base + turn
        return ClipPosition(clip.content[leaf_index].pad, source_start,
                            min(clip_end, source_start + clip.content[leaf_index].length),
                            (clip.id, turn, leaf_index), entries.get(logical_pass, base), logical_pass)

    def variant_pairs(self):
        """All potentially selected pairs, including currently hidden authored entries."""
        result = set()
        for clip, plans in zip(self.schedule.clips, self.span_plans, strict=True):
            for span, (base, entries) in zip(clip.content, plans, strict=True):
                if span.pad is not None:
                    result.update((span.pad, pair) for pair in {base, *entries.values()} if pair != (0, 0))
                    if len(result) > 256:
                        raise ValueError("Lane transposition variant limit exceeded.")
        return result
