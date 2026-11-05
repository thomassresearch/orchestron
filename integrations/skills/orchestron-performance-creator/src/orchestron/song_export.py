"""Native and MIDI/SCORE exports use the backend's existing bounded exporter."""

from copy import deepcopy
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from zipfile import is_zipfile, ZipFile, ZIP_DEFLATED

from .song_model import fail


def command(args, ctx):
    from .cli import orchestron_cli as cli

    path = Path(args.output).expanduser().resolve()
    if path.exists():
        fail("Choose a new export filename; existing files are preserved.", str(path), "output_exists")
    session = cli.load_edit_session(ctx.session_file)
    client = cli.ApiClient(ctx.api_url, timeout=ctx.timeout)
    cli.validate_edit_session(session, client)
    config = deepcopy(session["config"])
    definitions = []
    for patch_id in dict.fromkeys(i["patchId"] for i in config.get("instruments", [])):
        patch = client.get("/patches/" + quote(patch_id))
        definitions.append(
            {
                "sourcePatchId": patch_id,
                "name": patch["name"],
                "description": patch.get("description", ""),
                "isTemplate": patch.get("is_template", False),
                "alwaysOn": cli.patch_is_always_on(patch),
                "instrumentType": patch.get(
                    "instrument_type", "continuous" if cli.patch_is_always_on(patch) else "melody"
                ),
                "schema_version": patch.get("schema_version", 1),
                "graph": patch["graph"],
            }
        )
    bundle = {
        "format": "orchestron.performance",
        "version": 1,
        "exported_at": cli.now_iso(),
        "performance": {"name": session["name"], "description": session.get("description", ""), "config": config},
        "patch_definitions": definitions,
    }
    route, payload = "/bundles/export/performance", bundle
    if args.mode != "native":
        route = "/bundles/export/performance-csd"
        payload = {
            "performanceExport": bundle,
            "sequencerConfig": cli.build_runtime_config(config),
            "eventSource": "midiFile" if args.mode == "midi" else "score",
            "midiControllers": config.get("sequencer", {}).get("midiControllers", []),
        }
    content = client.download(route, payload)
    if args.mode == "native" and path.suffix.lower() == ".zip" and not is_zipfile(BytesIO(content)):
        archive_bytes = BytesIO()
        with ZipFile(archive_bytes, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("performance.orch.json", content)
        content = archive_bytes.getvalue()
    members = []
    if is_zipfile(BytesIO(content)):
        with ZipFile(BytesIO(content)) as archive:
            members = archive.namelist()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(content)
    cli.print_payload(
        {
            "operation": "export",
            "mode": args.mode,
            "path": str(path),
            "bytes": len(content),
            "sha256": sha256(content).hexdigest(),
            "members": members,
            "authoredStateChanged": False,
            "source": "staged",
            "rendered": False,
        },
        ctx,
    )


def register(edit):
    parser = edit.add_parser(
        "export", help="Export staged authored music through the backend's native or CSD exporter."
    )
    parser.add_argument("--mode", choices=["native", "midi", "score"], default="native")
    parser.add_argument("--output", required=True)
    parser.set_defaults(func=command)
