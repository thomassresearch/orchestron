"""Validate hetro breakpoint structure before Csound initializes a voice.

Csound accepts portable HETRO text and legacy native-endian signed 16-bit data.
Unlike sound-file readers, adsyn can silently accept arbitrary bytes as no tracks.
"""
from array import array
from pathlib import Path
import re


def validate_adsyn_analysis(path: Path) -> None:
    try:
        data = path.read_bytes()
    except OSError as err:
        raise ValueError(f"Cannot read hetro analysis asset '{path.name}'.") from err
    expected_partials = None
    if data.startswith(b"HETRO"):
        header, separator, body = data.partition(b"\n")
        match = re.fullmatch(rb"HETRO\s+([0-9]+)\s*", header)
        if not separator or match is None or re.search(rb"[^\s,0-9-]", body):
            raise ValueError("Invalid hetro text header or breakpoint data.")
        expected_partials = int(match[1])
        tokens = (int(token.group()) for token in re.finditer(rb"-?[0-9]+", body))
    else:
        if not data or len(data) % 2:
            raise ValueError("Expected a hetro analysis file, not an audio recording or SDIF file.")
        values = array("h")
        values.frombytes(data)
        tokens = iter(values)

    counts = {-1: 0, -2: 0}
    try:
        for marker in tokens:
            if marker not in counts:
                raise ValueError("Expected an amplitude (-1) or frequency (-2) track.")
            counts[marker] += 1
            previous_time = -1
            points = 0
            while True:
                time = next(tokens)
                if time == 32767:
                    break
                value = next(tokens)
                if not (0 <= time < 32767 and time >= previous_time and 0 <= value <= 32767):
                    raise ValueError("Invalid hetro breakpoint value or decreasing time.")
                previous_time = time
                points += 1
            if not points:
                raise ValueError("Hetro tracks must contain breakpoints.")
    except StopIteration as err:
        raise ValueError("Truncated hetro track; expected time/value pairs and a 32767 terminator.") from err
    if not counts[-1] or counts[-1] != counts[-2]:
        raise ValueError("Hetro analysis requires matching amplitude and frequency tracks.")
    if expected_partials is not None and counts[-1] != expected_partials:
        raise ValueError("Hetro header partial count does not match its tracks.")
