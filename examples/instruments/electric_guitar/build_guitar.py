"""Build and publish the editable, sample-free reference electric guitar."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))

from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    ApiClient,
    DEFAULT_API_URL,
    compile_payload_preflight,
)
from backend.app.models.patch import PatchGraph  # noqa: E402

from electric_voice import build, CONTROLS  # noqa: E402, F401

RAW = HERE / "E_Guitar.patch.json"
NATIVE = HERE.parent / "E_Guitar.orch.instrument.json"


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def normalized(graph):
    return PatchGraph.model_validate(graph).model_dump(mode="json")


def graph_hash(graph):
    return hashlib.sha256(json.dumps(normalized(graph), sort_keys=True).encode()).hexdigest()


def main(action, api_url):
    payload = build()
    dump(RAW, payload)
    if action == "build":
        return
    client = ApiClient(api_url, timeout=120)
    result = compile_payload_preflight(client, payload)
    assert result["state"] == "compiled", result
    dump(HERE / "validation/compile.json", {k: v for k, v in result.items() if k not in ("orc", "session_id")})
    if action == "preflight":
        return
    checks = json.loads((HERE / "validation/audio.json").read_text())
    assert checks["passed"] and checks["spectrograms_inspected"]
    assert checks["graph_sha256"] == graph_hash(payload["graph"])
    comparison = json.loads((HERE / "validation/range_comparison.json").read_text())
    assert comparison["source_user_provided"] and comparison["spectrograms_inspected"]
    assert comparison["graph_sha256"] == graph_hash(payload["graph"])
    pick_comparison = json.loads((HERE / "validation/pick_comparison.json").read_text())
    assert pick_comparison["spectrograms_inspected"]
    assert pick_comparison["graph_sha256"] == graph_hash(payload["graph"])
    vibrato = json.loads((HERE / "validation/vibrato.json").read_text())
    assert vibrato["passed"] and vibrato["audio_pitch_checked"] and vibrato["spectrograms_inspected"]
    assert vibrato["graph_sha256"] == graph_hash(payload["graph"])
    pitch_decay = json.loads((HERE / "validation/pitch_decay.json").read_text())
    assert pitch_decay["passed"] and pitch_decay["decay_ratios_measured"] and pitch_decay["spectrograms_inspected"]
    assert pitch_decay["graph_sha256"] == graph_hash(payload["graph"])
    manifest_path = HERE / "library_manifest.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        current = client.get("/patches/" + previous["patch_id"])
        assert graph_hash(current["graph"]) == previous["graph_sha256"], "Preserve unexpected library edits."
        saved = client.put("/patches/" + previous["patch_id"], payload)
    else:
        assert not any(p["name"] == payload["name"] for p in client.get("/patches")), (
            "Same-name instrument already exists."
        )
        saved = client.post("/patches", payload)
    verified = client.get("/patches/" + saved["id"])
    assert normalized(verified["graph"]) == normalized(payload["graph"])
    bundle = dict(
        sourcePatchId=saved["id"],
        name=saved["name"],
        description=saved["description"],
        isTemplate=False,
        alwaysOn=False,
        instrumentType="melody",
        schema_version=saved["schema_version"],
        graph=saved["graph"],
    )
    exported = client.post("/bundles/export/patch", bundle)
    preview = client.post("/bundles/import/expand?preview=true", exported)
    assert normalized(preview["graph"]) == normalized(payload["graph"])
    dump(NATIVE, exported)
    dump(
        manifest_path,
        dict(
            patch_id=saved["id"],
            name=saved["name"],
            graph_sha256=graph_hash(saved["graph"]),
            saved_and_read_back=True,
            native_import_preview=True,
        ),
    )
    print(saved["name"], saved["id"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "preflight", "publish"])
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    args = parser.parse_args()
    main(args.action, args.api_url)
