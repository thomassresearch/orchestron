"""Compile-preflight and save Stereo Auto Wah Wah through the backend API."""

import argparse
import json
from pathlib import Path

import httpx

from examples.instruments.stereo_auto_wah_wah.build import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    args = parser.parse_args()
    patch = build()
    with httpx.Client(base_url=args.api_url, timeout=60) as client:
        def call(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else None

        call("GET", "/health")
        payload = patch.model_dump(mode="json", by_alias=True)
        preview = call("POST", "/sessions/preview", json=dict(
            patches=[payload], session=dict(instruments=[
                dict(id="wah-preview", patch_id=patch.id, midi_channel=0),
            ])))
        try:
            compiled = call("POST", f"/sessions/{preview['session_id']}/compile")
            code = "\n".join(line for line in compiled["orc"].splitlines() if not line.lstrip().startswith(";"))
            assert code.count(" moogvcf ") == 2
        finally:
            call("DELETE", f"/sessions/{preview['session_id']}")
        existing = [item for item in call("GET", "/patches") if item["name"] == patch.name]
        if existing:
            saved = call("GET", f"/patches/{existing[0]['id']}")
            if saved["graph"] != payload["graph"] or saved["instrument_type"] != "continuous":
                raise RuntimeError("A different Stereo Auto Wah Wah already exists; it has been preserved.")
        else:
            saved = call("POST", "/patches", json=patch.model_dump(
                mode="json", exclude={"id", "created_at", "updated_at"}))
        output = Path("output/stereo-auto-wah-wah/library.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(saved, indent=2) + "\n")
        print(json.dumps({key: saved[key] for key in ("id", "name", "instrument_type")}))


if __name__ == "__main__":
    main()
