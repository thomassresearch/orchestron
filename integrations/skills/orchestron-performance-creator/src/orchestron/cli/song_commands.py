"""Agent-facing clip commands. Core operations do not depend on HTTP or argparse."""

from copy import deepcopy
import json
from pathlib import Path

from ..song_model import (
    KEYS,
    QUARTER,
    content_length,
    fail,
    fields,
    fingerprint,
    find,
    integer,
    lane_for,
    model,
    source_for,
    ticks,
)
from ..song_authoring import put_lane, put_definition, put_clip, edit_occurrence, migrate
from ..song_session import atomic_write, transaction
from ..song_spec import apply_song
from ..song_inspect import inspect


def cli():
    from . import orchestron_cli

    return orchestron_cli


def capabilities(args, ctx):
    backend = {"status": "unknown"}
    if not args.offline:
        try:
            backend = {
                "status": "verified",
                **cli().ApiClient(ctx.api_url, timeout=ctx.timeout).get("/performances/capabilities"),
            }
        except cli().OrchestronCliError as exc:
            backend = {"status": "unknown", "reason": exc.message}
    cli().print_payload(
        {
            "responseSchemaVersion": 1,
            "songSchema": {"schema": "orchestron-song", "version": 1},
            "client": {
                "version": "0.3.0",
                "performanceVersions": list(range(1, 27)),
                "clipVersions": [1, 2, 3, 4],
                "historyVersion": 2,
                "quarterTicks": QUARTER,
                "commands": [
                    "inspect",
                    "batch",
                    "apply-song",
                    "lanes",
                    "patterns",
                    "groups",
                    "clips",
                    "song",
                    "transpose",
                    "migrate",
                    "undo",
                    "redo",
                    "adapt-score",
                    "schema",
                    "automation",
                    "structure",
                    "sections",
                    "audition",
                    "transport",
                    "export",
                ],
            },
            "backend": backend,
            "stateChanged": False,
        },
        ctx,
    )


def load(path):
    return cli().load_score_spec(Path(path))


def dispatch(config, session, operation):
    fields(operation, {"op", "laneId", "id", "value", "target", "scope"}, {"op"}, "operation")
    op, value = operation["op"], operation.get("value", {})
    lane_id = operation.get("laneId")
    if op == "lanes.put":
        return put_lane(config, value)
    if op in ("patterns.put", "groups.put"):
        return put_definition(config, lane_id, value)
    if op == "patterns.cells":
        from ..song_authoring import edit_cells

        return edit_cells(config, lane_id, value)
    if op == "patterns.edit":
        return edit_occurrence(config, operation["target"], value, operation.get("scope", "local"))
    if op == "clips.put":
        return put_clip(config, lane_id, value)
    if op == "clips.fit":
        lane = lane_for(config, lane_id)
        clip = find(lane["clips"], operation["id"])
        return put_clip(
            config,
            lane_id,
            {"id": clip["id"], "length": integer(content_length(config, lane, clip["children"]) - clip["offset"], 1)},
        )
    if op == "clips.trim":
        fields(value, {"edge", "at"}, {"edge", "at"})
        clip = find(lane_for(config, lane_id)["clips"], operation["id"])
        at = ticks(value["at"])
        if value["edge"] not in ("left", "right"):
            fail("Trim edge must be left or right.")
        patch = (
            {"length": at - clip["start"]}
            if value["edge"] == "right"
            else {
                "start": at,
                "length": clip["start"] + clip["length"] - at,
                "offset": clip["offset"] + at - clip["start"],
            }
        )
        return put_clip(config, lane_id, {"id": clip["id"], **patch})
    if op in ("lanes.remove", "clips.remove", "patterns.remove", "groups.remove"):
        lane = lane_for(config, lane_id)
        if op == "lanes.remove":
            model(config)["lanes"].remove(lane)
            config["sequencer"][KEYS[lane["source"]]].remove(source_for(config, lane))
            return {"removedId": lane_id, "summary": "Removed source lane; independent automation retained."}
        key = "clips" if op == "clips.remove" else "definitions"
        item = find(lane[key], operation["id"])
        lane[key].remove(item)
        return {"removedId": item["id"], "summary": "Removed object; timeline and unused definitions retained."}
    if op == "song.put":
        fields(value, {"end", "loop", "loopSelection", "tempo"})
        if "end" in value:
            model(config)["end"] = ticks(value["end"])
        if "loop" in value:
            if type(value["loop"]) is not bool:
                fail("Song loop is a boolean.")
            config["sequencer"]["arrangerSongLoopEnabled"] = value["loop"]
        if "loopSelection" in value:
            selection = value["loopSelection"]
            if selection is not None:
                fields(selection, {"start", "end"}, {"start", "end"}, "loopSelection")
                start, end = ticks(selection["start"]), ticks(selection["end"])
                if end <= start or end > model(config)["end"] or start % 2520 or end % 2520:
                    fail(
                        "Loop selection must be a positive song range on transport step boundaries (2520 ticks).",
                        "loopSelection",
                    )
                selection = {"startStep": start // 2520, "endStep": end // 2520}
            config["sequencer"]["arrangerLoopSelection"] = selection
        if "tempo" in value:
            tempo = integer(value["tempo"], 30, 300)
            config["sequencer"]["tempoBPM"] = tempo
            config["sequencer"]["timing"]["tempoBPM"] = tempo
            for key in KEYS.values():
                for track in config["sequencer"].get(key, []):
                    if "timing" in track:
                        track["timing"]["tempoBPM"] = tempo
        return {"endTicks": model(config)["end"]}
    if op == "song.fit":
        model(config)["end"] = max(
            1, *[c["start"] + c["length"] for lane_item in model(config)["lanes"] for c in lane_item["clips"]]
        )
        return {"endTicks": model(config)["end"]}
    if op == "transpose.put":
        from ..song_transpose import edit

        return edit(config, value)
    if op in ("undo", "redo"):
        from ..song_history import replay

        return replay(config, op == "redo")
    if op.startswith("automation."):
        from ..song_automation import command

        return command(config, session.get("patchCatalog", []), op, value)
    if op.startswith("structure.") or op.startswith("sections."):
        from ..song_structure import command

        return command(config, op, value)
    fail("Unknown operation.", "operation.op", operation=op)


def command(args, ctx):
    name = args.edit_command
    if name == "schema":
        from ..song_schema import SONG_SCHEMA

        cli().print_payload(SONG_SCHEMA, ctx)
        return
    if name == "automation" and args.action == "list":
        from ..song_automation import discover

        session = cli().load_edit_session(ctx.session_file)
        patches = cli().ApiClient(ctx.api_url, timeout=ctx.timeout).get("/patches")
        cli().print_payload(discover(session["config"], patches, args.instrument), ctx)
        return
    if name == "inspect":
        session = cli().load_edit_session(ctx.session_file)
        target = load(args.target) if args.target else None
        result = inspect(
            session["config"],
            view=args.view,
            lane_id=args.lane,
            clip_id=args.clip,
            definition_id=args.definition,
            start=ticks(args.start) if args.start else None,
            end=ticks(args.end) if args.end else None,
            offset=args.offset,
            limit=args.limit,
            target=target,
        )
        cli().print_payload({"editRevision": session.get("editRevision", 0), "stateChanged": False, **result}, ctx)
        return
    if name == "adapt-score":
        from ..song_score_adapter import adapt

        spec = load(args.file)

        def mutate(config, session):
            return adapt(config, session, spec, args.id)
    elif name == "apply-song":
        spec = load(args.file)

        def mutate(config, session):
            return apply_song(config, session, spec, mode=args.mode, scope=args.scope)
    elif name == "migrate":

        def mutate(config, session):
            original = deepcopy(config)
            result = migrate(config)
            if config != original:
                if not args.dry_run:
                    if not args.recovery:
                        fail("Migration apply needs --recovery PATH for the original performance.", "recovery")
                    path = Path(args.recovery).expanduser().resolve()
                    if path == ctx.session_file.resolve() or path.exists():
                        fail("Recovery must be a new file outside the edit session.", str(path))
                    atomic_write(path, original)
                    if json.loads(path.read_text()) != original:
                        fail("Recovery verification failed.", str(path))
                    result["recovery"] = {"path": str(path), "fingerprint": fingerprint(original)}
            return result
    elif name == "batch":
        spec = load(args.file)
        fields(spec, {"operations"}, {"operations"}, "batch")

        def mutate(config, session):
            if not isinstance(spec["operations"], list) or not 1 <= len(spec["operations"]) <= 2048:
                fail("A batch needs 1–2048 operations.", "operations")
            results = [dispatch(config, session, op) for op in spec["operations"]]
            return {"results": results[:20], "total": len(results), "truncated": len(results) > 20}
    else:
        op = name if name in ("undo", "redo") else name + "." + args.action
        value = load(args.file) if getattr(args, "file", None) else {}
        operation = {"op": op, "value": value}
        if getattr(args, "lane", None):
            operation["laneId"] = args.lane
        if getattr(args, "id", None):
            operation["id"] = args.id
        if getattr(args, "target", None):
            operation["target"] = load(args.target)
            operation["scope"] = args.scope

        def mutate(config, session):
            return dispatch(config, session, operation)

    original_mutate = mutate
    needs_catalog = (
        name == "automation"
        or name == "apply-song"
        and bool(spec.get("automation"))
        or name == "batch"
        and any(o.get("op", "").startswith("automation.") for o in spec["operations"])
    )
    if needs_catalog and not args.offline:
        patches = cli().ApiClient(ctx.api_url, timeout=ctx.timeout).get("/patches")

        def mutate(config, session):
            session["patchCatalog"] = patches
            return original_mutate(config, session)

    result = transaction(
        ctx.session_file,
        name,
        mutate,
        expected=args.expected_revision,
        dry_run=args.dry_run,
        history=name not in ("undo", "redo", "migrate"),
    )
    cli().print_payload(result, ctx)


def register(root, edit):
    from ..song_export import register as register_export

    register_export(edit)
    from ..song_runtime import register as register_runtime

    register_runtime(edit)
    cap = root.add_parser("capabilities", help="Discover client formats and verified/unknown backend support.")
    cap.add_argument("--offline", action="store_true")
    cap.set_defaults(func=capabilities)
    read = edit.add_parser("inspect", help="Inspect authoritative definitions and bounded occurrence windows.")
    read.add_argument(
        "--view",
        choices=["summary", "definitions", "payload", "usage", "clips", "tree", "window", "effective"],
        default="summary",
    )
    for flag in ("lane", "clip", "definition", "target", "start", "end"):
        read.add_argument("--" + flag)
    read.add_argument("--offset", type=int, default=0)
    read.add_argument("--limit", type=int, default=20)
    read.set_defaults(func=command)

    def mutation(parser):
        parser.add_argument("--expected-revision", type=int)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument(
            "--offline",
            action="store_true",
            help="Use cached controller discovery; online validation remains separate.",
        )
        parser.set_defaults(func=command)

    song = edit.add_parser("apply-song", help="Reconcile a strict reusable song document.")
    song.add_argument("--file", required=True)
    song.add_argument("--mode", choices=["create", "update", "replace"], default="update")
    song.add_argument(
        "--scope", action="append", help="Exact lane ID managed by replacement; repeat for multiple lanes."
    )
    mutation(song)
    edit.add_parser("schema", help="Return the versioned song-authoring JSON schema.").set_defaults(func=command)
    adapter = edit.add_parser(
        "adapt-score", help="Explicitly adapt a Composition Creator v1/v2 document to reusable clips."
    )
    adapter.add_argument("--file", required=True)
    adapter.add_argument("--id", required=True, help="Stable handoff identity for retry protection.")
    mutation(adapter)
    batch = edit.add_parser("batch", help="Apply a list of authoring operations atomically.")
    batch.add_argument("--file", required=True)
    mutation(batch)
    migration = edit.add_parser("migrate", help="Explicitly convert supported legacy sources; use --dry-run first.")
    migration.add_argument("--recovery")
    mutation(migration)
    for name in ("undo", "redo"):
        mutation(edit.add_parser(name, help="Replay compatible arranger history."))
    families = {
        "lanes": ("put", "remove"),
        "patterns": ("put", "edit", "cells", "remove"),
        "groups": ("put", "remove"),
        "clips": ("put", "trim", "fit", "remove"),
        "song": ("put", "fit"),
        "transpose": ("put",),
        "automation": ("list", "generate", "map", "reconcile", "curve"),
        "structure": ("edit", "copy", "convert-cycle"),
        "sections": ("paste", "insert-time", "close-time"),
    }
    for family, actions in families.items():
        parser = edit.add_parser(family, help=f"Clip {family} operations; use inspect for discovery.")
        sub = parser.add_subparsers(dest="action", required=True)
        for action in actions:
            p = sub.add_parser(action)
            if family == "automation" and action == "list":
                p.add_argument("--instrument")
                p.set_defaults(func=command)
                continue
            if action not in ("remove", "fit"):
                p.add_argument(
                    "--file", required=True, help="Authoring operation JSON/YAML (not persisted configuration)."
                )
            if family in ("patterns", "groups", "clips") or family == "lanes" and action == "remove":
                p.add_argument("--lane", required=action != "edit")
            if action in ("remove", "fit", "trim") and family != "song":
                p.add_argument("--id", required=family != "lanes")
            if family == "patterns" and action == "edit":
                p.add_argument("--target", required=True, help="Occurrence selector returned by inspect --view tree.")
                p.add_argument("--scope", choices=["local", "shared"], default="local")
            mutation(p)
