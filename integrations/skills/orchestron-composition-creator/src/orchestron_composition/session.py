"""Atomic, revisioned sessions shared by the CLI and loopback audition server."""

from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

from .generators import develop, new_phrase, validate_brief
from .comparisons import endings, harmonies
from .orchestron_export import export_score
from .score import CompositionError, qn, validate, verify_melody_locks
from .trace import Recorder, lock_context, material, resolve, source_snapshot, validate_trace


def read_json(path: Path) -> dict:
    if path.stat().st_size > 16 * 1024 * 1024:
        raise CompositionError("JSON exceeds 16 MiB.")
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise CompositionError("Expected a JSON object.")
    return value


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    if len(encoded.encode()) > 16 * 1024 * 1024:
        raise CompositionError("JSON exceeds 16 MiB.")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, path)


def load(directory: Path) -> dict:
    state = read_json(directory / "session.json")
    if state.get("version") != 1 or not isinstance(state.get("candidates"), dict):
        raise CompositionError("Unsupported composition session.")
    return state


@contextmanager
def transaction(directory: Path, expected_revision: int | None = None, *, restoring: bool = False):
    with (directory / ".session.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        before = load(directory)
        if expected_revision is not None and before["revision"] != expected_revision:
            raise CompositionError("The session changed. Refresh before saving this selection.")
        state = copy.deepcopy(before)
        if not restoring:
            state.pop("undo_target", None)
        yield state
        state["revision"] = before["revision"] + 1
        write_json(directory / "history" / f"{before['revision']}.json", before)
        write_json(directory / "session.json", state)


def create(directory: Path, brief: dict, seed: int) -> dict:
    brief = validate_brief(brief)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "session.json"
    if path.exists():
        raise CompositionError("This directory already contains a session; resume it or choose another directory.")
    state = {"version": 1, "revision": 0, "brief": brief, "seed": seed, "rounds": [], "candidates": {}}
    # Exclusive creation prevents accidentally replacing an existing session.
    with path.open("x") as handle:
        json.dump(state, handle, indent=2)
    return state


def candidate(state: dict, candidate_id: str, *, accepted: bool = False) -> dict:
    item = state["candidates"].get(candidate_id)
    if item is None:
        raise CompositionError(f"Unknown candidate: {candidate_id}")
    if accepted and item["review"]["decision"] not in ("keep", "favourite"):
        raise CompositionError("Select Keep or Favourite before developing or exporting this candidate.")
    return item


def review(
    directory: Path, candidate_id: str, decision: str, feedback: str, locks: list[dict], revision: int | None = None
) -> dict:
    if (
        decision not in ("pending", "keep", "reject", "favourite")
        or not isinstance(feedback, str)
        or len(feedback) > 4000
    ):
        raise CompositionError("Invalid review decision or feedback (maximum 4000 characters).")
    if not isinstance(locks, list) or len(locks) > 32:
        raise CompositionError("Use at most 32 locked ranges.")
    with transaction(directory, revision) as state:
        item = candidate(state, candidate_id)
        length = qn(item["score"]["length_qn"])
        ranges = []
        for lock in locks:
            if not isinstance(lock, dict):
                raise CompositionError("A locked range must be an object.")
            start, stop = qn(lock.get("start_qn")), qn(lock.get("end_qn"))
            if not 0 <= start < stop <= length:
                raise CompositionError("Locked ranges must lie inside the phrase and have positive length.")
            ranges.append({"start_qn": str(start), "end_qn": str(stop)})
        item["review"] = {"decision": decision, "feedback": feedback, "locks": ranges}
    return load(directory)


def generate(
    directory: Path,
    *,
    parent_id: str | None = None,
    rhythm_id: str | None = None,
    operation: str = "vary",
    count: int = 3,
    seed: int | None = None,
    fresh: bool = False,
) -> list[str]:
    if type(count) is not int or not 1 <= count <= 4:
        raise CompositionError("Present one to four candidates per round.")
    ids = []
    with transaction(directory) as state:
        if len(state["candidates"]) + count > 128:
            raise CompositionError(
                "Session has reached its 128-candidate limit; start a new session from an exported score."
            )
        if state["candidates"] and not parent_id and not fresh:
            raise CompositionError("Choose an accepted --from candidate, or explicitly request --fresh ideas.")
        if rhythm_id and not parent_id:
            raise CompositionError("--rhythm-from also needs a --from pitch candidate.")
        parent = candidate(state, parent_id, accepted=True) if parent_id else None
        rhythm = candidate(state, rhythm_id, accepted=True) if rhythm_id else None
        round_index = len(state["rounds"]) + 1
        seed = state["seed"] + round_index * 100 if seed is None else seed
        fingerprints = set()
        if parent:
            fingerprints.add(json.dumps(parent["score"]["parts"], sort_keys=True))
        for index in range(count):
            recorder = Recorder()
            op = ("vary", "answer", "invert", "isorhythm")[index] if parent and operation == "vary" else operation
            if parent:
                score = develop(
                    parent["score"],
                    state["brief"],
                    seed + index,
                    op,
                    parent["review"]["locks"],
                    rhythm["score"] if rhythm else None,
                    trace=recorder,
                )
            else:
                score = new_phrase(state["brief"], seed + index, index, trace=recorder)
            export_score(score)  # Reject inexpressible candidates before presenting them.
            fingerprint = json.dumps(score["parts"], sort_keys=True)
            if fingerprint in fingerprints:
                continue
            fingerprints.add(fingerprint)
            identity = f"r{round_index}-{uuid.uuid4().hex[:8]}"
            state["candidates"][identity] = {
                "id": identity,
                "round": round_index,
                "kind": op if parent else ("lyrical", "syncopated", "active", "active")[index],
                "seed": seed + index,
                "parents": [i for i in (parent_id, rhythm_id) if i],
                "score": score,
                "trace": recorder.finish(
                    score,
                    sources=[
                        source_snapshot(item, role, state["revision"])
                        for item, role in ((parent, "pitch"), (rhythm, "rhythm"))
                        if item is not None
                    ],
                ),
                "review": {
                    "decision": "pending",
                    "feedback": "",
                    "locks": copy.deepcopy(parent["review"]["locks"]) if parent else [],
                },
            }
            ids.append(identity)
        if not ids:
            raise CompositionError(
                "No distinct candidates remain under these locks; change the operation or unlock a passage."
            )
        state["rounds"].append({"ids": ids, "seed": seed, "operation": operation})
    return ids


def compare(
    directory: Path, parent_id: str, *, start_qn: str | None = None,
    settings: dict | None = None, part_id: str = "harmony",
) -> list[str]:
    """Publish a complete comparison as one revision, or leave the session untouched."""
    if (start_qn is None) == (settings is None):
        raise CompositionError("Choose either an ending boundary or harmonic settings.")
    ids = []
    with transaction(directory) as state:
        parent = candidate(state, parent_id, accepted=True)
        locks = copy.deepcopy(parent["review"]["locks"])
        if start_qn is not None:
            variants, locks = endings(parent["score"], state["brief"], start_qn, locks)
            operation = "compare-endings"
        else:
            variants = harmonies(parent["score"], settings, part_id)
            operation = "compare-harmony"
        if len(state["candidates"]) + len(variants) > 128:
            raise CompositionError("Comparison would exceed the session's 128-candidate limit.")
        round_index = len(state["rounds"]) + 1
        for kind, score, recorder in variants:
            export_score(score)
            verify_melody_locks(parent["score"], score, locks)
            recorder.record(
                "orchestron.verify_locks", "Verify and inherit the protected melody and silence.",
                parameters=lock_context(parent["score"]["parts"][0]["events"], locks),
                inputs=parent["score"]["parts"][0], output=score["parts"][0],
            )
            trace = recorder.finish(score, sources=[source_snapshot(parent, "pitch", state["revision"])])
            validate_trace(trace, score)
            identity = f"r{round_index}-{uuid.uuid4().hex[:8]}"
            state["candidates"][identity] = {
                "id": identity, "round": round_index, "kind": kind, "seed": None,
                "parents": [parent_id], "score": score, "trace": trace,
                "review": {"decision": "pending", "feedback": "", "locks": copy.deepcopy(locks)},
            }
            ids.append(identity)
        resolve(state, ids)
        state["rounds"].append({"ids": ids, "operation": operation})
    return ids


def import_candidate(directory: Path, score: dict, parent_id: str | None = None, trace: dict | None = None) -> str:
    validate(score)
    export_score(score)
    if trace is not None:
        validate_trace(trace, score)
    with transaction(directory) as state:
        if len(state["candidates"]) >= 128:
            raise CompositionError("Session has reached its 128-candidate limit.")
        if any(score[k] != state["brief"][k] for k in ("tempo", "key", "mode", "meter")):
            raise CompositionError("Imported score must match the session's tempo, key, mode and meter.")
        parent = candidate(state, parent_id, accepted=True) if parent_id else None
        locks = copy.deepcopy(parent["review"]["locks"]) if parent else []
        supplied = copy.deepcopy(trace)
        recorder = Recorder()
        recorder.record(
            "orchestron.import_score",
            "Import an authored score; supplied steps are author-provided records.",
            parameters={"supplied_trace": supplied is not None},
            inputs={"material": material(score), "has_export_provenance": "provenance" in score},
            output={k: score[k] for k in ("tempo", "key", "mode", "meter", "length_qn", "parts")},
        )
        creation = supplied or recorder.finish(score)
        if supplied:
            creation["steps"].extend(recorder.steps)
            creation["origin"] = "supplied"
        sources = [source_snapshot(parent, "pitch", state["revision"])] if parent else []
        for source in creation["sources"]:
            if source["candidate_id"] == parent_id and source["role"] == "pitch":
                continue
            source_item = candidate(state, source["candidate_id"], accepted=True)
            sources.append(source_snapshot(source_item, source["role"], state["revision"]))
        creation["sources"] = sources
        provenance = score.get("provenance", {})
        history = provenance.get("creation_history") if isinstance(provenance, dict) else None
        if history is not None:
            if "history" in creation and creation["history"] != history:
                raise CompositionError("The supplied trace and score contain conflicting creation histories.")
            creation["history"] = copy.deepcopy(history)
        if (supplied is None or not supplied["steps"]) and history is None:
            creation["gap"] = "The imported score's internal creation operations were not recorded."
        if supplied is None and isinstance(history, dict) and history.get("result") != material(score):
            creation["gap"] = "The imported material differs from the recorded export, or its result was not recorded."
        if parent:
            verify_melody_locks(parent["score"], score, locks)
            recorder = Recorder()
            recorder.record(
                "orchestron.verify_locks",
                "Verify the primary parent's protected notes and silence.",
                parameters=lock_context(parent["score"]["parts"][0]["events"], locks),
                inputs=parent["score"]["parts"][0]["events"],
                output=score["parts"][0]["events"],
            )
            creation["steps"].extend(recorder.steps)
        validate_trace(creation, score)
        identity = f"import-{uuid.uuid4().hex[:8]}"
        state["candidates"][identity] = {
            "id": identity,
            "round": len(state["rounds"]) + 1,
            "kind": "imported",
            "seed": None,
            "parents": list(dict.fromkeys(s["candidate_id"] for s in sources)),
            "score": score,
            "trace": creation,
            "review": {"decision": "pending", "feedback": "", "locks": locks},
        }
        resolve(state, [identity])  # Validate ancestry before committing the candidate.
        state["rounds"].append({"ids": [identity], "operation": "import"})
    return identity


def undo(directory: Path) -> dict:
    with transaction(directory, restoring=True) as state:
        revision = state["revision"]
        target = state.get("undo_target", revision - 1)
        if target < 0:
            raise CompositionError("No earlier session state to restore.")
        previous = read_json(directory / "history" / f"{target}.json")
        state.clear()
        state.update(previous)
        state["undo_target"] = target - 1
    return load(directory)


def fingerprint(score: dict) -> str:
    return hashlib.sha256(json.dumps(score, sort_keys=True).encode()).hexdigest()
