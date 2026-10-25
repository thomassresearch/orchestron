"""Back up, preflight and update the existing Trance Gate through the local API."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request

from build import PATCH_ID, build_patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    parser.add_argument("--backup-dir", type=Path, default=Path("output/trance-gate/backups"))
    args = parser.parse_args()

    def api(method, path, payload=None):
        request = urllib.request.Request(args.api_url.rstrip("/") + path, method=method,
                                         data=json.dumps(payload).encode() if payload is not None else None,
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    original = api("GET", f"/patches/{PATCH_ID}")
    if original["name"] != "Trance Gate":
        raise RuntimeError("The expected library ID no longer belongs to Trance Gate")
    patch = build_patch().model_dump(mode="json", by_alias=True,
                                    exclude={"id", "created_at", "updated_at"})
    # Audio engine preferences belong to the saved instrument, not this upgrade.
    patch["graph"]["engine_config"] = original["graph"]["engine_config"]
    args.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = args.backup_dir / f"trance_gate_before_{stamp}.json"
    backup.write_text(json.dumps(original, indent=2, ensure_ascii=False) + "\n")

    candidate = api("POST", "/patches", {**patch, "name": "__preflight__ Trance Gate"})
    session = None
    try:
        session = api("POST", "/sessions", {"instruments": [
            {"id": "trance-gate-preflight", "patch_id": candidate["id"], "midi_channel": 0}]})
        compiled = api("POST", f'/sessions/{session["session_id"]}/compile')
        (args.backup_dir / f"preflight_{stamp}.json").write_text(json.dumps(compiled, indent=2) + "\n")
    finally:
        if session:
            api("DELETE", f'/sessions/{session["session_id"]}')
        api("DELETE", f'/patches/{candidate["id"]}')
    current = api("GET", f"/patches/{PATCH_ID}")
    if current != original:
        raise RuntimeError("Trance Gate changed during preflight; leaving the newer library version intact")
    updated = api("PUT", f"/patches/{PATCH_ID}", patch)
    restored = api("GET", f"/patches/{PATCH_ID}")
    if restored["graph"] != patch["graph"] or restored["id"] != PATCH_ID:
        raise RuntimeError("Saved graph did not match the preflighted graph")
    print(json.dumps(dict(id=updated["id"], name=updated["name"], backup=str(backup),
                         controllers=[n["id"] for n in restored["graph"]["nodes"]
                                      if n["opcode"] == "perf_controller"],
                         diagnostics=compiled.get("diagnostics", [])), indent=2))


if __name__ == "__main__":
    main()
