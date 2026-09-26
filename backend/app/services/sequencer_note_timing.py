"""Prepared musical offsets; all positions are absolute, never accumulated deltas."""
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache

from backend.app.services.sequencer_runtime_models import RatchetStrike, SequencerStepRuntime


@dataclass(slots=True)
class SoundingTimedNote:
    nominal_start: int
    shift: int
    nominal_end: int | None

    @property
    def release_subunit(self) -> int | None:
        return None if self.nominal_end is None else self.nominal_end + self.shift


@dataclass(slots=True)
class RatchetRoll:
    """One sounding occurrence, independent of subsequent prepared configurations."""
    pad_index: int
    base: int
    nominal_start: int
    start: int
    notes: tuple[int, ...]
    strikes: tuple[RatchetStrike, ...]
    next_strike: int = 0

    @property
    def end(self) -> int:
        return self.start + self.strikes[-1].release_offset

    @property
    def next_attack(self) -> int | None:
        if self.next_strike == len(self.strikes):
            return None
        return self.start + self.strikes[self.next_strike].offset


@lru_cache(maxsize=4096)
def ratchet_strikes(steps: tuple[SequencerStepRuntime, ...], span: int) -> tuple[tuple[RatchetStrike, ...], ...]:
    return tuple(tuple(
        RatchetStrike(index, strike, round(Fraction(span * strike, step.ratchets)),
                      round(Fraction(span * (strike + 1), step.ratchets)),
                      step.velocity if step.ratchet_end_velocity is None else
                      round(step.velocity + Fraction((step.ratchet_end_velocity - step.velocity) * strike,
                                                     step.ratchets - 1)))
        for strike in range(step.ratchets)
    ) if step.ratchets > 1 and step.notes else () for index, step in enumerate(steps))


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
