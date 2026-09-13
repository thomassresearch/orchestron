"""Instrument categories and deterministic inference for legacy patches."""

import re
from typing import Literal

InstrumentType = Literal["percussion", "melody", "bass", "effects_noise", "continuous"]

# Keep these rules aligned with frontend/src/lib/instrumentTypes.ts and the
# shared regression cases in backend/tests/fixtures/instrument_types.json.
_RULES: list[tuple[InstrumentType, str]] = [
    ("percussion", r"\b(percussion|drums?|drumkit|drumset|kicks?|snares?|hi[ -]?hats?|cymbals?|claps?|toms?|tr[ -]?(808|909))\b"),
    ("bass", r"\b(bass|bassline|sub[ -]?bass|tb[ -]?303)\b"),
    ("melody", r"\b(melod(y|ic)|leads?|pads?|plucks?|organs?|pianos?|bells?|keys|brass|strings|supersaw|voice)\b"),
    ("effects_noise", r"\b(effects?|fx|noise|risers?|sweeps?|lasers?|zaps?|bleeps?|chirps?|bubbles?|whooshes?|impacts?|textures?|drones?)\b"),
]


def infer_instrument_type(name: str, description: str = "", always_on: bool = False) -> InstrumentType:
    if always_on:
        return "continuous"
    for text in (name, description):
        normalized = text.lower().replace("_", " ")
        for instrument_type, pattern in _RULES:
            if re.search(pattern, normalized, flags=re.ASCII):
                return instrument_type
    return "melody"
