"""Compile-preflight and optionally update the original library instrument.

Run with --apply only after audio validation. The original extension uses its
snapshot as a guard; --cymbals-only preserves edits outside notes 49/51.
Both modes check updated_at again immediately before saving.
"""
import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))
from orchestron_patch.cli.orchestron_patch_cli import ApiClient, compile_payload_preflight
from cymbals import apply_approved_cymbals

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--api-url", default="http://localhost:8000/api")
parser.add_argument("--out-dir", type=Path, required=True)
parser.add_argument("--apply", action="store_true")
parser.add_argument("--cymbals-only", action="store_true",
                    help="Replace only notes 49/51 in an existing 17-voice kit, preserving other edits.")
args = parser.parse_args()
args.out_dir.mkdir(parents=True, exist_ok=True)
original = json.loads((HERE / "Analog_Drumkit.original.orch.instrument.json").read_text())
updated = json.loads((HERE.parent / "Analog_Drumkit.orch.instrument.json").read_text())
patch_id = original["sourcePatchId"]
client = ApiClient(args.api_url, timeout=60)
current = client.get(f"/patches/{patch_id}")
if args.cymbals_only:
    cases = current["graph"]["control_flow"]["kit"]["cases"]
    if not {49, 51}.issubset({case["value"] for case in cases}):
        raise RuntimeError("Cymbal-only update requires the existing 17-voice kit.")
    target_graph = copy.deepcopy(current["graph"])
    apply_approved_cymbals(target_graph)
    payload = {key: current[key] for key in [
        "name", "description", "schema_version", "is_template", "always_on", "instrument_type",
    ]}
    payload["graph"] = target_graph
else:
    if current["graph"] != updated["graph"] and current["graph"] != original["graph"]:
        raise RuntimeError("Library graph changed since the original snapshot; use --cymbals-only for the 17-voice kit.")
    payload = {key: updated[key] for key in ["name", "description", "schema_version", "graph"]}
    payload.update(is_template=False, always_on=False, instrument_type="percussion")
if current["graph"] == payload["graph"]:
    print("Library already contains this revision.")
    raise SystemExit(0)
result = compile_payload_preflight(client, payload)
(args.out_dir / "api-preflight.json").write_text(json.dumps(result, indent=2) + "\n")
if result.get("state") != "compiled" or result.get("diagnostics"):
    raise RuntimeError(f"Review compiler diagnostics before updating: {result['diagnostics']}")
print(f"API compile preflight: {result['state']}")
if args.apply:
    # Preflight takes time; guard against edits made during compilation as well.
    latest = client.get(f"/patches/{patch_id}")
    if latest["updated_at"] != current["updated_at"]:
        raise RuntimeError("Library patch changed during preflight; update refused.")
    (args.out_dir / "library-backup.json").write_text(json.dumps(current, indent=2) + "\n")
    saved = client.put(f"/patches/{patch_id}", payload)
    fetched = client.get(f"/patches/{patch_id}")
    assert fetched["graph"] == saved["graph"] == payload["graph"]
    (args.out_dir / "library-updated.json").write_text(json.dumps(fetched, indent=2) + "\n")
    print(f"Updated and verified {patch_id}: {fetched['name']}")
