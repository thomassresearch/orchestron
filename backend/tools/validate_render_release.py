"""Validate an operator-reviewed catalog; never create or approve evidence.

Run: python -m backend.tools.validate_render_release catalog.json --runtime
Use --schema output.json to export the catalog format without native loading.
"""
import argparse
import json
from pathlib import Path

from backend.app.engine.render_qualification import runtime_fingerprint
from backend.app.engine.render_release import MAX_CATALOG_BYTES, ReleaseCatalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path, nargs="?")
    parser.add_argument("--runtime", action="store_true", help="Require evidence matching this native build")
    parser.add_argument("--schema", type=Path)
    args = parser.parse_args()
    if args.schema:
        args.schema.write_text(json.dumps(ReleaseCatalog.model_json_schema(), indent=2) + "\n")
    if args.catalog is None:
        if not args.schema:
            parser.error("Supply a catalog or --schema")
        return
    try:
        with args.catalog.open("rb") as stream:
            raw = stream.read(MAX_CATALOG_BYTES + 1)
        if len(raw) > MAX_CATALOG_BYTES:
            raise ValueError("Qualification catalog exceeds size limit")
        catalog = ReleaseCatalog.model_validate_json(raw)
        runtime = runtime_fingerprint() if args.runtime else None
        matching = [p for p in catalog.profiles if p.evidence.runtime == runtime] if args.runtime else []
        if args.runtime and len({p.evidence.workload for p in matching}) < 2:
            raise ValueError("This build has fewer than two distinct qualified workloads")
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"Catalog rejected: {exc}\n")
    print(json.dumps({"profiles": len(catalog.profiles), "runtime": runtime,
        "matching_workloads": sorted({p.evidence.workload for p in matching}),
        "default_renderer": "single", "allow_unqualified": False,
        "note": "Validation is not new measurement, approval, or permission to enlarge a workload envelope."}, indent=2))


if __name__ == "__main__":
    main()
