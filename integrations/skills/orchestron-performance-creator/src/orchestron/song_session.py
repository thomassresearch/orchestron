"""Process-safe staged transactions and crash-safe JSON replacement."""

from contextlib import contextmanager
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import tempfile

from .song_model import fail, fingerprint, model, validate
from . import song_history


@contextmanager
def session_lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_name(path.name + ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("Another command is editing this session. Retry after it finishes.", str(path), "session_busy")
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def atomic_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=True, indent=2, allow_nan=False) + "\n"
    descriptor, temp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def counts(config):
    m = model(config)
    return {
        "lanes": len(m["lanes"]),
        "patterns": sum(d["kind"] == "pattern" for lane_item in m["lanes"] for d in lane_item["definitions"]),
        "definitions": sum(len(lane_item["definitions"]) for lane_item in m["lanes"]),
        "clips": sum(len(lane_item["clips"]) for lane_item in m["lanes"]),
    }


def transaction(path, operation, mutate, *, expected=None, dry_run=False, history=True):
    from .cli.orchestron_cli import load_edit_session, now_iso

    # The command dispatcher holds the lock across the whole read/HTTP/write cycle.
    session = load_edit_session(path)
    before = deepcopy(session)
    revision = session.get("editRevision", 0)
    if expected is not None and expected != revision:
        fail(
            "Staged revision changed. Inspect and retry with the current revision.",
            "expectedRevision",
            "conflict",
            currentRevision=revision,
        )
    config = session["config"]
    prior_model = deepcopy(config.get("sequencer", {}).get("clipArrangement"))
    detail = mutate(config, session) or {}
    changed = config != before["config"] or any(
        session.get(k) != before.get(k) for k in ("songDocuments", "scoreHandoffs")
    )
    warnings = detail.pop("warnings", [])
    validate(config)
    if changed:
        if history and prior_model is not None:
            model(config)["revision"] = prior_model["revision"] + 1
            warning = song_history.record(config, prior_model, operation)
            if warning:
                warnings.append(warning)
        validate(config)
        session.update(editRevision=revision + 1, dirty=True, updatedAt=now_iso())
        if not dry_run:
            atomic_write(path, session)
    after_counts = counts(config)
    before_counts = counts(before["config"]) if prior_model is not None else {k: 0 for k in after_counts}
    return {
        "operation": operation,
        "summary": detail.pop(
            "summary", f"{operation}: " + ("previewed" if dry_run else "staged" if changed else "unchanged")
        ),
        "state": {
            "stage": "preview" if dry_run else "staged",
            "changed": changed and not dry_run,
            "beforeRevision": revision,
            "revision": revision + int(changed and not dry_run),
            "arrangementRevision": model(config)["revision"],
            "fingerprint": fingerprint(model(config)),
            "runtimeApplied": False,
            "saved": False,
        },
        "changes": {k: after_counts[k] - before_counts[k] for k in after_counts},
        "counts": after_counts,
        "validation": {"authored": "passed", "routing": "not_run", "preparation": "not_run"},
        "warnings": warnings,
        **detail,
    }
