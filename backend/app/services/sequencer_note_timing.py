"""Prepared musical offsets; all positions are absolute, never accumulated deltas."""
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache

from backend.app.services.sequencer_runtime_models import SequencerStepRuntime


@dataclass(slots=True)
class SoundingTimedNote:
    nominal_start: int
    shift: int
    nominal_end: int | None

    @property
    def release_subunit(self) -> int | None:
        return None if self.nominal_end is None else self.nominal_end + self.shift


@lru_cache(maxsize=4096)
def note_positions(steps: tuple[SequencerStepRuntime, ...], span: int) -> tuple[tuple[int, int], ...]:
    # Equal-time neighboring attacks collapse to the later logical step.
    positions = {
        index * span + round(Fraction(step.timing_offset_percent * span, 100)): index
        for index, step in enumerate(steps) if step.notes
    }
    return tuple(sorted(positions.items()))


@lru_cache(maxsize=4096)
def terminating_steps(steps: tuple[SequencerStepRuntime, ...]) -> tuple[int, ...]:
    return tuple(index for index, step in enumerate(steps) if step.notes or not step.hold)
