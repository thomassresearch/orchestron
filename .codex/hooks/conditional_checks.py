"""Run repository checks only for areas changed during this Codex turn."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


REPO = Path(__file__).resolve().parents[2]
CHECKS = {"frontend": "frontend-check", "backend": "backend-check"}
SOURCE_SUFFIXES = {
    "frontend": {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".json"},
    "backend": {".py"},
}
STATE_DIR = Path(tempfile.gettempdir()) / f"orchestron-codex-hooks-{os.getuid()}"


def respond(**fields):
    print(json.dumps(fields))


def state_path(event):
    identity = f"{REPO}\0{event['session_id']}\0{event['turn_id']}"
    return STATE_DIR / (hashlib.sha256(identity.encode()).hexdigest() + ".json")


def source_state():
    """Hash tracked and non-ignored untracked files, including existing dirty files."""
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "frontend", "backend"],
        cwd=REPO,
    )
    result = {area: {} for area in CHECKS}
    for raw_path in set(paths.split(b"\0")) - {b""}:
        relative = os.fsdecode(raw_path)
        area = relative.split("/", 1)[0]
        if area not in result or Path(relative).suffix.lower() not in SOURCE_SUFFIXES[area]:
            continue
        path = REPO / relative
        if path.is_symlink():
            content_hash = hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
        elif path.is_file():
            digest = hashlib.sha256()
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            content_hash = digest.hexdigest()
        else:
            content_hash = None  # A tracked file deleted from the working tree.
        result[area][relative] = content_hash
    return result


def save(path, state):
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(".new")
    temporary.write_text(json.dumps(state), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def snapshot(event):
    path = state_path(event)
    if not path.exists():
        save(path, {"before": source_state(), "attempts": {}})
    for old in STATE_DIR.glob("*.json"):
        if old != path and time.time() - old.stat().st_mtime > 7 * 86400:
            old.unlink()
    respond()


def check(event):
    path = state_path(event)
    if not path.exists():
        respond(systemMessage="Conditional checks skipped: no start-of-turn snapshot was available.")
        return

    state = json.loads(path.read_text(encoding="utf-8"))
    current = source_state()
    failures = []
    unchanged_failures = []
    for area, target in CHECKS.items():
        if current[area] == state["before"][area]:
            continue
        fingerprint = hashlib.sha256(json.dumps(current[area], sort_keys=True).encode()).hexdigest()
        previous = state["attempts"].get(area)
        if previous and previous["fingerprint"] == fingerprint:
            if not previous["passed"]:
                unchanged_failures.append(f"make {target} previously failed; its files have not changed.")
            continue
        try:
            completed = subprocess.run(
                ["make", target], cwd=REPO, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=570,
                check=False,
            )
            output = completed.stdout
            success = completed.returncode == 0
        except (OSError, subprocess.TimeoutExpired) as error:
            output = str(error)
            success = False
        state["attempts"][area] = {"fingerprint": fingerprint, "passed": success}
        save(path, state)
        if not success:
            failures.append(f"make {target} failed:\n{output[-6000:]}")

    if failures:
        respond(decision="block", reason="\n\n".join(failures))
    elif unchanged_failures:
        path.unlink(missing_ok=True)
        respond(systemMessage=" ".join(unchanged_failures))
    else:
        path.unlink(missing_ok=True)
        respond()


def main():
    event = json.load(sys.stdin)
    if len(sys.argv) != 2 or sys.argv[1] not in {"snapshot", "check"}:
        raise ValueError("expected snapshot or check")
    if sys.argv[1] == "snapshot":
        snapshot(event)
    else:
        check(event)


if __name__ == "__main__":
    main()
