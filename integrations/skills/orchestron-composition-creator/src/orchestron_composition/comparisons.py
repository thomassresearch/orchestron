"""Small, explicit musical experiments; every result still needs a listening decision."""

from __future__ import annotations

import copy
from fractions import Fraction

from .generators import reference_scale, scale_pitches
from .score import CompositionError, end, event, integer, qn, validate, verify_melody_locks
from .trace import Recorder, lock_context


def opening_locks(locks: list[dict], start: Fraction) -> list[dict]:
    """Combine the requested opening with existing locks without losing protected silence."""
    spans = sorted([(Fraction(0), start), *[(qn(r["start_qn"]), qn(r["end_qn"])) for r in locks]])
    merged = []
    for left, right in spans:
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], right)
        else:
            merged.append([left, right])
    if len(merged) > 32:
        raise CompositionError("The opening and inherited locks exceed 32 ranges.")
    return [{"start_qn": str(a), "end_qn": str(b)} for a, b in merged]


def endings(parent: dict, brief: dict, start_qn: str, locks: list[dict]) -> tuple[list, list[dict]]:
    """Replace the tail with settled, suspended, higher-peak and spacious alternatives."""
    validate(parent)
    start, length = qn(start_qn), qn(parent["length_qn"])
    if not 0 < start < length:
        raise CompositionError("Ending start must be after the opening and before the phrase end.")
    melody = sorted(parent["parts"][0]["events"], key=lambda e: qn(e["onset_qn"]))
    if any(end(a) > qn(b["onset_qn"]) for a, b in zip(melody, melody[1:])):
        raise CompositionError("Ending comparisons require a monophonic first part.")
    opening = [e for e in melody if qn(e["onset_qn"]) < start]
    if not opening:
        raise CompositionError("Choose an ending start after at least one opening note.")
    # A note intersecting the opening is retained whole, even across the requested boundary.
    effective = max(start, max(end(e) for e in opening))
    if effective >= length:
        raise CompositionError("The protected opening fills the phrase; choose an earlier boundary or another motif.")
    inherited = opening_locks(locks, start)
    pitches = scale_pitches(brief)
    tonic_pc = reference_scale(brief).tonic.pitchClass
    roots = [i for i, p in enumerate(pitches) if p % 12 == tonic_pc and i + 2 < len(pitches)]
    if not roots:
        raise CompositionError("The register needs a tonic and two scale steps above it for these ending recipes.")
    original_peak = max(e["pitch_midi"] for e in melody)
    roots = [i for i in roots if max(pitches) > max(original_peak, pitches[i + 2])]
    if not roots:
        raise CompositionError("A higher-peak ending needs room above the motif and approach in the brief's register.")
    root = min(roots, key=lambda i: abs(pitches[i] - opening[-1]["pitch_midi"]))
    tonic, second, third = pitches[root : root + 3]
    higher = [p for p in pitches if p > max(third, original_peak)]
    peak = higher[0]
    unit = (length - effective) / 4
    velocity = opening[-1]["velocity"]
    recipes = [
        (
            "ending_settled",
            [(third, 0, 1), (second, 1, 1), (tonic, 2, 2)],
            "Descend by scale steps to a sustained tonic.",
        ),
        (
            "ending_suspended",
            [(third, 0, 1), (second, 1, 1), (second, 2, 2)],
            "Retain the approach but repeat and sustain scale degree two.",
        ),
        (
            "ending_peak",
            [(third, 0, 1), (peak, 1, 1), (tonic, 2, 2)],
            "Reach above the original motif's peak, then return to the tonic.",
        ),
        (
            "ending_space",
            [(third, 0, 1), (tonic, 1, 1)],
            "Arrive early and leave the final half of the editable tail silent.",
        ),
    ]
    variants = []
    for kind, recipe, description in recipes:
        score = copy.deepcopy(parent)
        score["parts"][0]["events"] = copy.deepcopy(opening) + [
            event(pitch, effective + offset * unit, duration * unit, velocity) for pitch, offset, duration in recipe
        ]
        validate(score)
        verify_melody_locks(parent, score, inherited)
        recorder = Recorder()
        recorder.record(
            "orchestron.compare_endings",
            description,
            parameters={
                "recipe": kind,
                "requested_start_qn": str(start),
                "effective_start_qn": str(effective),
                "unit_qn": str(unit),
                "tonic_midi": tonic,
                "higher_peak_midi": peak,
                "low": brief["low"],
                "high": brief["high"],
                **lock_context(melody, inherited),
            },
            inputs=parent["parts"],
            output=score["parts"],
        )
        variants.append((kind, score, recorder))
    return variants, inherited


def harmonies(parent: dict, settings: dict, part_id: str) -> list:
    """Change one harmonic part; leave the complete melody and all other parts untouched."""
    validate(parent)
    if (
        not isinstance(settings, dict)
        or settings.get("schema") != "orchestron.harmony-comparison"
        or type(settings.get("version")) is not int
        or settings["version"] != 1
        or not isinstance(settings.get("settings"), list)
        or len(settings["settings"]) != 2
    ):
        raise CompositionError("Use a version 1 orchestron.harmony-comparison with exactly two settings.")
    if not part_id or part_id == parent["parts"][0]["id"]:
        raise CompositionError("Choose a harmony part distinct from the first (melody) part.")
    existing = next((p for p in parent["parts"] if p["id"] == part_id), None)
    if existing and any(p["channel"] == existing["channel"] for p in parent["parts"] if p["id"] != part_id):
        raise CompositionError("The harmony part needs its own MIDI channel for an isolated comparison.")
    available = [c for c in range(1, 17) if c != 10 and c not in {p["channel"] for p in parent["parts"]}]
    if not existing and (not available or len(parent["parts"]) >= 16):
        raise CompositionError("There is no free part/channel for the harmonic settings.")
    target = (
        copy.deepcopy(existing)
        if existing
        else {
            "id": part_id,
            "name": "Harmony",
            "channel": available[0],
            "program": 0,
            "events": [],
        }
    )
    if target["channel"] == 10:
        raise CompositionError("Harmonic settings need a melodic channel, not percussion channel 10.")
    octave = integer(settings.get("octave", 3), 1, 6, "harmony octave")
    velocity = integer(settings.get("velocity", 54), 1, 127, "harmony velocity")
    scale = reference_scale(parent)
    tonic = int(scale.tonic.midi) + 12 * (octave - 4)
    # Resolve degrees relative to the chosen octave, independently of melody register.
    pitch_classes = [scale.pitchFromDegree(i).pitchClass for i in range(1, 8)]
    collection = [tonic + (pc - tonic) % 12 for pc in pitch_classes]
    variants = []
    for index, setting in enumerate(settings["settings"]):
        if not isinstance(setting, dict):
            raise CompositionError("Each harmonic setting must be an object.")
        degrees = setting.get("degrees")
        if not isinstance(degrees, list) or not 2 <= len(degrees) <= 6:
            raise CompositionError("Each harmonic setting needs two to six distinct scale degrees.")
        for degree in degrees:
            integer(degree, 1, 7, "harmony scale degree")
        if len(set(degrees)) != len(degrees):
            raise CompositionError("Harmonic scale degrees must be distinct.")
        label = setting.get("label")
        if not isinstance(label, str) or not label.strip() or len(label) > 120:
            raise CompositionError("Each harmonic setting needs a label of at most 120 characters.")
        root = integer(setting.get("bass_degree"), 1, 7, "bass degree")
        chord = sorted(collection[d - 1] for d in degrees)
        bass = collection[root - 1] - 12
        part = copy.deepcopy(target)
        part["events"] = [event(p, Fraction(0), qn(parent["length_qn"]), velocity) for p in [bass, *chord]]
        score = copy.deepcopy(parent)
        if existing:
            score["parts"] = [part if p["id"] == part_id else p for p in score["parts"]]
        else:
            score["parts"].append(part)
        validate(score)
        recorder = Recorder()
        recorder.record(
            "orchestron.compare_harmony",
            "Keep the melody fixed and replace the selected harmonic part.",
            parameters={
                "setting": setting,
                "part_id": part_id,
                "octave": octave,
                "velocity": velocity,
                "resolved_pitches_midi": [bass, *chord],
            },
            inputs=parent["parts"],
            output=score["parts"],
        )
        variants.append((f"harmony_{index + 1}", score, recorder))
    if variants[0][1]["parts"] == variants[1][1]["parts"]:
        raise CompositionError("The two harmonic settings must produce different notes.")
    return variants
