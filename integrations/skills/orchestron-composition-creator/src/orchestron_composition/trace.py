"""Creation records, captured at execution time; never a replay engine."""

from __future__ import annotations

import copy
from enum import Enum
from fractions import Fraction
from importlib.metadata import version
import inspect
import json
import platform

from music21 import chord, note, pitch, scale, stream

from .score import CompositionError, end, qn


def lock_context(events, locks):
    retained = [
        e for e in events if any(qn(e["onset_qn"]) < qn(r["end_qn"]) and end(e) > qn(r["start_qn"]) for r in locks)
    ]
    silence = []
    for lock in locks:
        gaps = [(qn(lock["start_qn"]), qn(lock["end_qn"]))]
        for event in retained:
            a, b = qn(event["onset_qn"]), end(event)
            gaps = [(x, y) for start, stop in gaps for x, y in ((start, min(stop, a)), (max(start, b), stop)) if x < y]
        silence.extend({"start_qn": str(a), "end_qn": str(b)} for a, b in gaps)
    return {"locks": copy.deepcopy(locks), "retained_notes": copy.deepcopy(retained), "protected_silence": silence}


def snapshot(value):
    """Portable musical values, copied before a potentially in-place operation."""
    if isinstance(value, Enum):
        return {"enum": type(value).__name__, "name": value.name, "value": value.value}
    if isinstance(value, Fraction):
        return str(value)
    if isinstance(value, pitch.Pitch):
        return {"pitch_midi": int(value.midi), "spelling": value.nameWithOctave}
    if isinstance(value, scale.ConcreteScale):
        return {"type": type(value).__name__, "tonic": snapshot(value.tonic)}
    if isinstance(value, stream.Stream):
        return {"type": "stream", "events": [snapshot(n) for n in value.flatten().notesAndRests]}
    if isinstance(value, (note.Note, note.Rest, chord.Chord)):
        return {
            "pitches_midi": [int(p.midi) for p in value.pitches],
            "onset_qn": str(Fraction(value.offset)),
            "duration_qn": str(Fraction(value.quarterLength)),
            "velocity": value.volume.velocity if not value.isRest else None,
        }
    if isinstance(value, dict):
        return {str(k): snapshot(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [snapshot(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise CompositionError(f"Cannot record trace value of type {type(value).__name__}.")


def material(score):
    return copy.deepcopy({k: score[k] for k in ("tempo", "key", "mode", "meter", "length_qn", "parts")})


class Recorder:
    """Use call() for executed functions; authored() for explicitly described edits."""

    def __init__(self):
        self.steps = []

    def record(self, function, description, *, parameters=None, inputs=None, output=None, evidence="captured"):
        self.steps.append(
            snapshot(
                {
                    "function": function,
                    "description": description,
                    "evidence": evidence,
                    "parameters": parameters or {},
                    "inputs": inputs,
                    "output": output,
                }
            )
        )

    def authored(self, description, *, inputs, output, parameters=None):
        self.record(
            "authored.edit", description, parameters=parameters, inputs=inputs, output=output, evidence="declared"
        )

    def call(self, function, *args, **kwargs):
        bound = inspect.signature(function).bind(*args, **kwargs)
        bound.apply_defaults()
        arguments = snapshot(bound.arguments)
        parameters = {
            key: arguments[key] for key, value in bound.arguments.items() if not isinstance(value, stream.Stream)
        }
        result = function(*args, **kwargs)
        name = f"{function.__module__}.{function.__name__}".replace("orchestron_composition.vendor.", "")
        self.record(
            name,
            function.__name__.replace("_", " ").capitalize() + ".",
            parameters=parameters,
            inputs=arguments,
            output=result,
        )
        return result

    def finish(self, score, *, sources=None):
        return {
            "version": 1,
            "versions": {
                "python": platform.python_version(),
                "music21": version("music21"),
                "arvo": "0.3.0 (bundled compatibility copy)",
                "composition_creator": version("orchestron-composition-creator"),
                "trace": 1,
            },
            "sources": copy.deepcopy(sources or []),
            "steps": copy.deepcopy(self.steps),
            "result": material(score),
        }


def validate_trace(trace, score=None):
    if not isinstance(trace, dict) or type(trace.get("version")) is not int or trace["version"] != 1:
        raise CompositionError("Unsupported creation trace version.")
    steps, sources = trace.get("steps"), trace.get("sources")
    if not isinstance(steps, list) or len(steps) > 512 or not isinstance(sources, list):
        raise CompositionError("A trace needs sources and at most 512 steps.")
    for source in sources:
        if (
            not isinstance(source, dict)
            or not isinstance(source.get("candidate_id"), str)
            or not source["candidate_id"]
            or not isinstance(source.get("role"), str)
            or not source["role"]
        ):
            raise CompositionError("Trace sources need candidate_id and role.")
    for step in steps:
        if (
            not isinstance(step, dict)
            or not isinstance(step.get("function"), str)
            or not isinstance(step.get("description"), str)
            or step.get("evidence") not in ("captured", "declared")
            or not isinstance(step.get("parameters"), dict)
            or "inputs" not in step
            or "output" not in step
        ):
            raise CompositionError("Invalid creation trace step.")
    if score is not None and trace.get("result") != material(score):
        raise CompositionError("The trace result does not match the imported score.")
    if "history" in trace:
        validate_history(trace["history"])
    try:
        if len(json.dumps(trace, allow_nan=False).encode()) > 16 * 1024 * 1024:
            raise CompositionError("Creation trace exceeds 16 MiB.")
    except (TypeError, ValueError) as exc:
        raise CompositionError("Creation trace must contain finite JSON values.") from exc


def validate_history(history):
    if not isinstance(history, dict) or type(history.get("version")) is not int or history["version"] != 1:
        raise CompositionError("Unsupported creation history version.")
    nodes, roots = history.get("nodes"), history.get("roots")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 512 or not isinstance(roots, list) or not roots:
        raise CompositionError("Creation history needs roots and at most 512 candidates.")
    indexed = {}
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or node["id"] in indexed:
            raise CompositionError("Creation history candidate IDs must be unique.")
        if "history" in node:
            raise CompositionError("Portable history nodes must be flat; use sources to reference ancestors.")
        validate_trace(node)
        indexed[node["id"]] = node
    visited, active, ordered = set(), set(), []

    def visit(identity):
        if not isinstance(identity, str) or identity not in indexed:
            raise CompositionError(f"Missing creation history candidate: {identity}")
        if identity in active:
            raise CompositionError("Cycle in creation history.")
        if identity in visited:
            return
        if len(active) >= 128:
            raise CompositionError("Creation history exceeds 128 ancestry levels.")
        active.add(identity)
        for source in indexed[identity]["sources"]:
            visit(source["candidate_id"])
        active.remove(identity)
        visited.add(identity)
        ordered.append(indexed[identity])

    for identity in [*roots, *indexed]:
        visit(identity)
    for assembly in [history.get("assembly", []), *[n.get("imported_assembly", []) for n in nodes]]:
        if not isinstance(assembly, list):
            raise CompositionError("Creation history assembly must be a list.")
        for section in assembly:
            if (
                not isinstance(section, dict)
                or not isinstance(section.get("candidate_id"), str)
                or section["candidate_id"] not in indexed
            ):
                raise CompositionError("Invalid creation history assembly reference.")
            if qn(section.get("onset_qn")) < 0 or qn(section.get("duration_qn")) <= 0:
                raise CompositionError("Invalid creation history assembly timing.")
    return ordered


def source_snapshot(item, role, revision):
    return {"candidate_id": item["id"], "role": role, "revision": revision, "review": copy.deepcopy(item["review"])}


def resolve(state, identities):
    """A topologically ordered, portable graph; shared ancestors appear only once."""
    nodes, visited, active = [], set(), set()

    def visit(identity):
        if identity in active:
            raise CompositionError("Cycle in candidate creation history.")
        if identity in visited:
            return
        if len(active) >= 128:
            raise CompositionError("Creation history exceeds 128 ancestry levels.")
        item = state["candidates"].get(identity)
        if item is None:
            raise CompositionError(f"Missing creation history candidate: {identity}")
        active.add(identity)
        trace = copy.deepcopy(item.get("trace"))
        if trace is None:
            trace = {
                "version": 1,
                "steps": [],
                "sources": [{"candidate_id": p, "role": "unknown"} for p in item.get("parents", [])],
                "gap": "Historical operations and inputs were not recorded.",
            }
        else:
            validate_trace(trace)
        for source in trace["sources"]:
            visit(source["candidate_id"])
        # Imported portable histories have their own ID space. Prefix them so an
        # unrelated candidate with the same ID in this session cannot replace one.
        history = trace.pop("history", None)
        if history:
            prefix = identity + "::"
            for ancestor in validate_history(history):
                ancestor = copy.deepcopy(ancestor)
                ancestor["original_id"] = ancestor["id"]
                ancestor["id"] = prefix + ancestor["id"]
                for source in ancestor["sources"]:
                    source["candidate_id"] = prefix + source["candidate_id"]
                for section in ancestor.get("imported_assembly", []):
                    section["candidate_id"] = prefix + section["candidate_id"]
                nodes.append(ancestor)
            trace["sources"].extend(
                {"candidate_id": prefix + root, "role": "exported_phrase"} for root in dict.fromkeys(history["roots"])
            )
            trace["imported_assembly"] = [
                {**s, "candidate_id": prefix + s["candidate_id"]} for s in history.get("assembly", [])
            ]
        nodes.append(
            {
                **trace,
                "id": identity,
                "title": item["score"].get("title", identity),
                "kind": item["kind"],
                "seed": item.get("seed"),
                "meter": item["score"]["meter"],
            }
        )
        active.remove(identity)
        visited.add(identity)

    for identity in identities:
        visit(identity)
    result = {"version": 1, "roots": list(identities), "nodes": nodes, "assembly": []}
    validate_history(result)
    return result
