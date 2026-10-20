"""Compile-preflight and save the two instruments through the running backend."""

import argparse
import json
from pathlib import Path

import httpx

from examples.instruments.ambient_techno.build import build_all


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    args = parser.parse_args()
    saved_items = []
    with httpx.Client(base_url=args.api_url, timeout=60) as client:
        def call(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else None

        call("GET", "/health")
        for patch in build_all():
            preview = call("POST", "/sessions/preview", json=dict(
                patches=[patch.model_dump(mode="json", by_alias=True)],
                session=dict(instruments=[dict(id="ambient-preview", patch_id=patch.id, midi_channel=1)])))
            try:
                compiled = call("POST", f"/sessions/{preview['session_id']}/compile")
                if compiled.get("state") == "error":
                    raise RuntimeError(compiled)
            finally:
                call("DELETE", f"/sessions/{preview['session_id']}")
            existing = [p for p in call("GET", "/patches") if p["name"] == patch.name]
            if existing:
                saved = call("GET", f"/patches/{existing[0]['id']}")
                if saved["graph"] != patch.graph.model_dump(mode="json", by_alias=True):
                    raise RuntimeError(f"A different {patch.name} exists and has been preserved.")
            else:
                saved = call("POST", "/patches", json=patch.model_dump(
                    mode="json", exclude={"id", "created_at", "updated_at"}))
            saved_items.append(saved)
            print(json.dumps({k: saved[k] for k in ("id", "name", "instrument_type")}))
    output = Path("output/ambient-techno/library.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(saved_items, indent=2) + "\n")


if __name__ == "__main__":
    main()
