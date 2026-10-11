"""Seeded phrase construction; arvo transforms pitch material, rhythm stays explicit."""

from __future__ import annotations

import copy
import random
from fractions import Fraction

from music21 import note, scale, stream

from .score import CompositionError, MODES, end, event, integer, qn, validate
from .trace import Recorder, lock_context
from .vendor.arvo import isorhythm, minimalism, tintinnabuli, transformations

OPERATIONS = (
    "vary",
    "answer",
    "invert",
    "retrograde",
    "isorhythm",
    "additive",
    "subtractive",
    "scan",
    "tintinnabuli",
    "continue",
)
SCALES = {
    "aeolian": scale.MinorScale,
    "dorian": scale.DorianScale,
    "ionian": scale.MajorScale,
    "locrian": scale.LocrianScale,
    "lydian": scale.LydianScale,
    "mixolydian": scale.MixolydianScale,
    "phrygian": scale.PhrygianScale,
}


def validate_brief(brief: dict) -> dict:
    result = {
        "title": "Untitled sketch",
        "key": "D",
        "mode": "dorian",
        "tempo": 108,
        "bars": 2,
        "meter": [4, 4],
        "grid": "straight",
        "low": 60,
        "high": 81,
        "harmony": True,
        **brief,
    }
    integer(result["bars"], 1, 8, "bars")
    integer(result["low"], 12, 108, "low")
    integer(result["high"], result["low"] + 7, 120, "high")
    if result["grid"] not in ("straight", "triplet") or type(result["harmony"]) is not bool:
        raise CompositionError("Use straight or triplet grid and a boolean harmony setting.")
    if result["mode"] not in MODES:
        raise CompositionError("Unsupported mode.")
    if result["key"] not in (
        "C",
        "C#",
        "Db",
        "D",
        "D#",
        "Eb",
        "E",
        "F",
        "F#",
        "Gb",
        "G",
        "G#",
        "Ab",
        "A",
        "A#",
        "Bb",
        "B",
        "Cb",
    ):
        raise CompositionError("Use a supported key spelling such as D, F# or Bb.")
    meter = result["meter"]
    # The portable validator is also the single meter/tempo validation boundary.
    validate(
        {
            "schema": "orchestron.composition",
            "version": 1,
            "tempo": result["tempo"],
            "mode": result["mode"],
            "key": result["key"],
            "meter": meter,
            "length_qn": "1",
            "parts": [{"id": "lead", "channel": 1, "events": []}],
        }
    )
    result["title"] = str(result["title"])[:200]
    return result


def reference_scale(brief: dict):
    return SCALES[brief["mode"]](brief["key"].replace("b", "-") + "4")


def scale_pitches(brief: dict) -> list[int]:
    return [
        int(p.midi)
        for p in reference_scale(brief).getPitches(note.Note(brief["low"]).pitch, note.Note(brief["high"]).pitch)
    ]


def fit_pitch(value: int, brief: dict) -> int:
    choices = scale_pitches(brief)
    return min(choices, key=lambda p: abs(p - value))


def new_phrase(brief: dict, seed: int, variant: int, trace: Recorder | None = None) -> dict:
    brief = validate_brief(brief)
    rng = random.Random(seed)
    beat = Fraction(4, brief["meter"][1])
    length = brief["bars"] * brief["meter"][0] * beat
    unit = beat / (3 if brief["grid"] == "triplet" else 4)
    pitches = scale_pitches(brief)
    tonic_pc = reference_scale(brief).tonic.pitchClass
    tonic = min(
        [p for p in pitches if p % 12 == tonic_pc] or pitches, key=lambda p: abs(p - (brief["low"] + brief["high"]) / 2)
    )
    motif = [0, rng.choice([1, 2]), rng.choice([2, 4]), rng.choice([1, -1])]
    events, position, index = [], Fraction(0), 0
    while position < length:
        remaining = length - position
        if remaining <= beat:
            events.append(event(tonic, position, remaining, 82))
            break
        sizes = [2, 2, 3, 1] if variant == 1 else [2, 2, 4, 2] if variant == 0 else [1, 2, 1, 3]
        duration = min(unit * sizes[index % len(sizes)], remaining)
        # Keep the cadence on a beat and retain occasional deliberate breathing space.
        if position < length - beat < position + duration:
            duration = length - beat - position
        if index % 7 != 5:
            degree = pitches.index(tonic) + motif[index % 4] + (index // 4) % 2
            pitch = pitches[max(0, min(len(pitches) - 1, degree))]
            events.append(event(pitch, position, duration, 94 if position % beat == 0 else rng.randint(70, 86)))
        position += duration
        index += 1
    result = {
        "schema": "orchestron.composition",
        "version": 1,
        "title": brief["title"],
        "tempo": brief["tempo"],
        "key": brief["key"],
        "mode": brief["mode"],
        "meter": brief["meter"],
        "length_qn": str(length),
        "parts": [{"id": "lead", "name": "Melody", "channel": 1, "program": 0, "events": events}],
    }
    if trace:
        trace.record(
            "orchestron.new_phrase",
            "Seeded motif, rhythmic slots, breathing spaces and tonic cadence.",
            parameters={
                "seed": seed,
                "variant": variant,
                "brief": brief,
                "motif_degrees": motif,
                "tonic_midi": tonic,
                "scale_pitches": pitches,
                "unit_qn": unit,
            },
            inputs=brief,
            output=result["parts"][0],
        )
    if brief["harmony"]:
        bass = tonic - 24
        accompaniment = []
        bar = brief["meter"][0] * beat
        for i in range(brief["bars"]):
            chord_root = bass if i % 4 in (0, 3) else bass + (5 if i % 4 == 1 else 7)
            triad = reference_scale(brief).getPitches(note.Note(chord_root).pitch, note.Note(chord_root + 12).pitch)
            for p in triad[::2][:3]:
                accompaniment.append(event(int(p.midi), i * bar, bar, 54))
        result["parts"].append(
            {"id": "harmony", "name": "Harmony", "channel": 2, "program": 0, "events": accompaniment}
        )
    if trace:
        trace.record(
            "orchestron.harmony",
            "Build modal triads when accompaniment is enabled.",
            parameters={"enabled": brief["harmony"], "tonic_midi": tonic, "bars": brief["bars"]},
            inputs={"scale": reference_scale(brief), "meter": brief["meter"]},
            output=result["parts"][1:],
        )
    return validate(result)


def transform_pitches(
    events: list[dict], operation: str, brief: dict, seed: int, trace: Recorder | None = None
) -> list[int]:
    if not events:
        raise CompositionError("The selected melody has no notes to develop.")
    original = stream.Stream([note.Note(e["pitch_midi"], quarterLength=1) for e in events])
    ref = reference_scale(brief)
    call = trace.call if trace else lambda function, *args, **kwargs: function(*args, **kwargs)
    if trace:
        trace.record(
            "orchestron.pitch_material",
            "Extract pitches into unit-duration notes for transformation.",
            parameters={"operation": operation, "seed": seed},
            inputs=events,
            output=original,
        )
    if operation == "invert":
        transformed = call(transformations.scalar_inversion, original, original.notes[0].pitch, ref)
    elif operation == "answer":
        transformed = call(transformations.scalar_transposition, original, 2 if seed % 2 else -2, ref)
    elif operation == "retrograde":
        transformed = call(transformations.retrograde, original)
    elif operation == "isorhythm":
        transformed = call(isorhythm.create_isorhythm, [e["pitch_midi"] for e in events[:5]], [1], length=len(events))
    elif operation == "additive":
        transformed = call(minimalism.additive_process, original, iterations_end=min(4, len(events)))
    elif operation == "subtractive":
        transformed = call(minimalism.subtractive_process, original, iterations_end=min(4, len(events)))
    elif operation == "scan":
        transformed = call(minimalism.scanning_process, original, window_size=3, iterations_end=3)
    elif operation == "tintinnabuli":
        triad = [ref.pitchFromDegree(i).name for i in (1, 3, 5)]
        transformed = call(tintinnabuli.create_t_voice, original, triad)
    else:
        rng = random.Random(seed)
        transformed = call(transformations.scalar_transposition, original, rng.choice([-1, 1, 2]), ref)
    pitches = [fit_pitch(int(n.pitch.midi), brief) for n in transformed.flatten().notes]
    if trace:
        trace.record(
            "orchestron.fit_pitch",
            "Fit transformed pitches to the allowed scale and register.",
            parameters={"low": brief["low"], "high": brief["high"], "choices": scale_pitches(brief)},
            inputs=[int(n.pitch.midi) for n in transformed.flatten().notes],
            output=pitches,
        )
    if not pitches:
        raise CompositionError("This operation produced no notes; choose another motif or operation.")
    return pitches


def develop(
    parent: dict,
    brief: dict,
    seed: int,
    operation: str,
    locks: list[dict],
    rhythm: dict | None = None,
    trace: Recorder | None = None,
) -> dict:
    validate(parent)
    if operation not in OPERATIONS:
        raise CompositionError("Unknown development operation.")
    result = copy.deepcopy(parent)
    source = parent["parts"][0]["events"]
    material = transform_pitches(source, operation, brief, seed, trace)
    slots = (rhythm or parent)["parts"][0]["events"]
    if rhythm and qn(rhythm["length_qn"]) != qn(parent["length_qn"]):
        raise CompositionError("Pitch and rhythm parents must have equal phrase lengths.")
    generated = [{**e, "pitch_midi": material[i % len(material)]} for i, e in enumerate(slots)]
    if trace:
        trace.record(
            "orchestron.project_rhythm",
            "Cycle transformed pitches over the source rhythm and dynamics.",
            parameters={"rhythm_source": "rhythm" if rhythm else "pitch"},
            inputs={"pitches": material, "slots": slots},
            output=generated,
        )
        trace.record(
            "orchestron.preserve_harmony",
            "Retain the pitch parent's accompaniment.",
            inputs=parent["parts"][1:],
            output=result["parts"][1:],
        )
    if operation == "continue":
        from .score import assemble

        result["parts"][0]["events"] = generated
        continued = assemble([parent, result], parent["title"])
        if trace:
            trace.record(
                "orchestron.continue",
                "Retain the whole original phrase and append the developed answer.",
                parameters={"offset_qn": parent["length_qn"], **lock_context(source, locks)},
                inputs={"original": parent["parts"], "answer": result["parts"]},
                output=continued["parts"],
            )
        return continued
    protected = [(qn(lock["start_qn"]), qn(lock["end_qn"])) for lock in locks]
    # Preserve complete events intersecting a lock; include their occupied spans
    # so a new rhythm cannot intrude into an accepted sustained note.
    fixed = [e for e in source if any(qn(e["onset_qn"]) < b and end(e) > a for a, b in protected)]
    protected.extend((qn(e["onset_qn"]), end(e)) for e in fixed)
    before_locks = generated
    generated = [e for e in generated if not any(qn(e["onset_qn"]) < b and end(e) > a for a, b in protected)]
    result["parts"][0]["events"] = sorted(generated + copy.deepcopy(fixed), key=lambda e: qn(e["onset_qn"]))
    if trace:
        trace.record(
            "orchestron.restore_locks",
            "Restore complete protected notes and keep locked silence empty.",
            parameters=lock_context(source, locks),
            inputs={"generated": before_locks, "discarded": [e for e in before_locks if e not in generated]},
            output=result["parts"][0]["events"],
        )
    return validate(result)
