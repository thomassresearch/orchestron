"""Bounded, immutable pitch plans. Sparse entries replace their own base only."""

from bisect import bisect_right
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_REPEAT_INDEX = 40320000000
MAX_PLAN_ENTRIES = 4096
MAX_TOTAL_ENTRIES = 65536
MAX_PROFILES = 1024
MAX_PLACEMENTS = 1024
MAX_TOTAL_PLACEMENTS = 65536
MAX_VARIANTS = 256
MAX_TOTAL_VARIANTS = 1024
MAX_SCORE_RECORDS = 200000
Amount = Annotated[int, Field(strict=True, ge=-127, le=127)]
RepeatIndex = Annotated[int, Field(strict=True, ge=0, le=MAX_REPEAT_INDEX)]


class PitchOffset(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)
    diatonic_steps: Amount = Field(alias="diatonicSteps")
    chromatic_semitones: Amount = Field(alias="chromaticSemitones")

    @property
    def pair(self):
        return self.diatonic_steps, self.chromatic_semitones


class RepeatOffset(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    index: RepeatIndex
    offset: PitchOffset


class OffsetPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    base: PitchOffset
    repetitions: tuple[RepeatOffset, ...] = Field(max_length=MAX_PLAN_ENTRIES)

    @model_validator(mode="after")
    def ordered(self):
        if any(a.index >= b.index for a, b in zip(self.repetitions, self.repetitions[1:])):
            raise ValueError("Transpose repetition indices must be unique and sorted.")
        return self


ROOT_PITCH_CLASS = {
    "C": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}
MODE_INTERVALS = {
    "ionian": (0, 2, 4, 5, 7, 9, 11),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "aeolian": (0, 2, 3, 5, 7, 8, 10),
    "locrian": (0, 1, 3, 5, 6, 8, 10),
}


def transpose_pitch(pitch: int, root: str, mode: str, pair: tuple[int, int]) -> int | None:
    r, intervals = ROOT_PITCH_CLASS[root], MODE_INTERVALS[mode]
    octave, pc = divmod(pitch - r, 12)
    degree = bisect_right(intervals, pc) - 1
    target_octave, target_degree = divmod(7 * octave + degree + pair[0], 7)
    result = r + 12 * target_octave + intervals[target_degree] + pc - intervals[degree] + pair[1]
    return result if 0 <= result <= 127 else None


def effective_plan(plans):
    """Finite union of exact indices, never a Cartesian product or hold-last curve."""
    base = tuple(sum(p.base.pair[i] for p in plans) for i in (0, 1))
    changes = {}
    for plan in plans:
        for entry in plan.repetitions:
            if entry.index not in changes:
                if len(changes) >= MAX_TOTAL_ENTRIES:
                    raise ValueError("Effective transposition entry limit exceeded.")
                changes[entry.index] = list(base)
            for i in (0, 1):
                changes[entry.index][i] += entry.offset.pair[i] - plan.base.pair[i]
    return base, {index: tuple(pair) for index, pair in changes.items() if tuple(pair) != base}
