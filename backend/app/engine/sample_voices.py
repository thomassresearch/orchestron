"""Track delivered one-shots independently of MIDI key ownership."""
from __future__ import annotations

from dataclasses import dataclass
import json

from backend.app.models.sample_player import MAX_SAMPLE_INSTANCE_VOICES, MAX_SAMPLE_VOICES, SAMPLE_RATE
from backend.app.models.sample_player import SAMPLE_BINDING_COMMENT

CANCEL_MS = 5
SLOT_CHANNELS = tuple(f"vcs_sample_stop_{slot}" for slot in range(MAX_SAMPLE_VOICES))


def owns_sample(sources: frozenset[str], owner: str) -> bool:
    # A lane owns all its audition layers; a particular layer/gesture owns
    # only its own attacks. Derived arpeggiator voices can also name their feeder.
    return any(source in sources for source in sample_owner_keys(owner))


def sample_owner_keys(owner: str):
    yield owner
    for identity in owner.split("\x01"):
        yield identity
        yield identity.split("\x00", 1)[0]


def parse_bindings(csd):
    bindings = {}
    for line in csd.splitlines():
        if line.startswith(SAMPLE_BINDING_COMMENT):
            channel, ref, notes = json.loads(line[len(SAMPLE_BINDING_COMMENT):])
            bindings[channel] = (ref, {int(note): tuple(entry) for note, entry in notes.items()})
    return bindings


@dataclass(slots=True)
class SampleVoice:
    source: str
    channel: int
    note: int
    velocity: int
    start: int
    end: int
    instrument: int
    table: int
    channels: int
    frames: int
    slot: int
    cut: int | None = None

    def pfields(self, rate: int, *, offline: bool = False):
        start = self.start / rate if offline else 0
        slot = -1 if offline else self.slot
        cut = (self.cut - self.start) / rate if offline and self.cut is not None else -1
        return (self.instrument, start, (self.end - self.start) / rate,
                self.note, self.velocity, self.channel, self.table, self.channels, self.frames, slot, cut)


def boundary_length(frames: int, source_rate: int, rate: int, block: int) -> int:
    stride = block * source_rate
    return ((frames * rate + stride - 1) // stride) * block


class LocalSampleCommands:
    """Resolve only this native owner's notes to immutable local score-event fields."""

    def __init__(self, csd, rate, block):
        self.notes = {}
        for channel, (instrument, notes) in parse_bindings(csd).items():
            for note, (table, channels, frames) in notes.items():
                duration = boundary_length(frames, SAMPLE_RATE, rate, block) / rate
                self.notes[channel, note] = (instrument, duration, table, channels, frames)

    def resolve(self, event):
        instrument, duration, table, channels, frames = self.notes[event.channel, event.note]
        channel = SLOT_CHANNELS[event.slot]
        if not event.velocity:
            return channel, None
        fields = (instrument, 0, duration, event.note, event.velocity, event.channel, table,
                  channels, frames, event.slot, -1)
        return channel, fields


class SampleVoices:
    def __init__(self, bindings, rate: int, block: int):
        self.bindings = bindings
        self.rate = rate
        self.block = block
        self.active: dict[int, SampleVoice] = {}
        self.dropped = 0
        self._first_end: int | None = None

    def _boundary_length(self, frames: int, source_rate: int) -> int:
        return boundary_length(frames, source_rate, self.rate, self.block)

    def expire(self, sample: int) -> None:
        if self._first_end is None or sample < self._first_end:
            return
        for slot in [slot for slot, voice in self.active.items() if voice.end <= sample]:
            del self.active[slot]
        self._first_end = min((voice.end for voice in self.active.values()), default=None)

    def attack(self, message: bytes, source: str, sample: int) -> SampleVoice | None:
        status, note, velocity = message
        channel = (status & 15) + 1
        binding = self.bindings.get(channel)
        if status & 0xf0 != 0x90 or not velocity or not binding:
            return None
        instrument, notes = binding
        if note not in notes:
            return None
        self.expire(sample)
        if len(self.active) >= MAX_SAMPLE_VOICES or sum(
            voice.channel == channel for voice in self.active.values()
        ) >= MAX_SAMPLE_INSTANCE_VOICES:
            self.dropped = min(self.dropped + 1, 2**31 - 1)
            return None
        slot = next(index for index in range(MAX_SAMPLE_VOICES) if index not in self.active)
        table, channels, frames = notes[note]
        end = sample + self._boundary_length(frames, SAMPLE_RATE)
        voice = SampleVoice(source, channel, note, velocity, sample, end, instrument, table, channels, frames, slot)
        self.active[slot] = voice
        self._first_end = end if self._first_end is None else min(self._first_end, end)
        return voice

    def cancel(self, sample: int, *, sources: frozenset[str] | None = None, channel: int | None = None):
        self.expire(sample)
        canceled = []
        for voice in self.active.values():
            if voice.cut is not None or sources is not None and not owns_sample(sources, voice.source):
                continue
            if channel is not None and voice.channel != channel:
                continue
            voice.cut = sample
            voice.end = min(voice.end, sample + self._boundary_length(CANCEL_MS, 1_000))
            self._first_end = voice.end if self._first_end is None else min(self._first_end, voice.end)
            canceled.append(voice)
        return canceled

    def dispatch(self, events, sample, start, cut):
        passthrough = []
        for event in events:
            if event.sample_panic or event.sample_cancel is not None:
                for voice in self.cancel(sample, sources=event.sample_cancel):
                    cut(voice)
                continue
            status, cc, _ = event.message
            channel = (status & 15) + 1
            if channel in self.bindings:
                kind = status & 0xf0
                if kind in (0x80, 0x90):
                    voice = self.attack(event.message, event.sample_source or event.source, sample)
                    if voice is not None:
                        start(voice)
                    continue
                if kind == 0xb0 and cc == 120:
                    for voice in self.cancel(sample, sources=frozenset((event.sample_source or event.source,)), channel=channel):
                        cut(voice)
            passthrough.append(event)
        return passthrough
