from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from . import session
from .generators import OPERATIONS
from .orchestron_export import export_score
from .preview import render
from .score import CompositionError, assemble, qn
from .server import make_server
from .trace import material, resolve


def render_candidates(directory: Path, ids: list[str], soundfont: str | None = None) -> None:
    soundfont = soundfont or os.environ.get("ORCHESTRON_SOUNDFONT")
    state = session.load(directory)
    for identity in ids:
        item = session.candidate(state, identity)
        target = directory / "previews" / identity
        signature = session.fingerprint(item["score"])
        cached = target / "render.json"
        metadata = session.read_json(cached) if cached.exists() else {}
        if (
            metadata.get("score_sha256") == signature
            and metadata.get("renderer") == "builtin-midi-synth"
            and not soundfont
            and all(
                (target / name).is_file() for name in ("mix.wav", "solo.wav", "mix.mid", "solo.mid", "score.musicxml")
            )
        ):
            continue
        result = render(item["score"], target, soundfont)
        session.write_json(cached, {"score_sha256": signature, **result})


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Compose, compare and export music for Orchestron.")
    sub = result.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="Create a local composition session.")
    init.add_argument("directory", type=Path)
    init.add_argument("--title", default="Untitled sketch")
    init.add_argument("--key", default="D")
    init.add_argument("--mode", default="dorian")
    init.add_argument("--tempo", type=int, default=108)
    init.add_argument("--bars", type=int, default=2)
    init.add_argument("--meter", default="4/4")
    init.add_argument("--grid", choices=["straight", "triplet"], default="straight")
    init.add_argument("--low", type=int, default=60, help="Lowest MIDI pitch.")
    init.add_argument("--high", type=int, default=81, help="Highest MIDI pitch.")
    init.add_argument("--harmony", action=argparse.BooleanOptionalAction, default=True)
    init.add_argument("--seed", type=int, default=42)
    generate = sub.add_parser("generate", help="Generate a shortlist; previews are rendered automatically.")
    generate.add_argument("directory", type=Path)
    generate.add_argument("--from", dest="parent_id")
    generate.add_argument("--rhythm-from", dest="rhythm_id")
    generate.add_argument("--operation", choices=OPERATIONS, default="vary")
    generate.add_argument("--count", type=int, default=3)
    generate.add_argument("--seed", type=int)
    generate.add_argument("--fresh", action="store_true")
    generate.add_argument("--soundfont")
    status = sub.add_parser("status", help="Read candidates, feedback and locked ranges.")
    status.add_argument("directory", type=Path)
    show = sub.add_parser("show", help="Read one complete candidate, including its score.")
    show.add_argument("directory", type=Path)
    show.add_argument("id")
    trace = sub.add_parser("trace", help="Read the complete creation history of a candidate.")
    trace.add_argument("directory", type=Path)
    trace.add_argument("id")
    review = sub.add_parser("review", help="Record the user's selection, feedback and melody locks.")
    review.add_argument("directory", type=Path)
    review.add_argument("id")
    review.add_argument("--decision", choices=["pending", "keep", "reject", "favourite"], required=True)
    review.add_argument("--feedback", default="")
    review.add_argument(
        "--lock",
        action="append",
        default=[],
        metavar="START:END",
        help="Quarter-note positions; repeat for several ranges. Replaces existing locks.",
    )
    serve = sub.add_parser("serve", help="Open a loopback audition server (stop with Ctrl-C).")
    serve.add_argument("directory", type=Path)
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--soundfont")
    preview = sub.add_parser("render", help="Render or repair candidate previews.")
    preview.add_argument("directory", type=Path)
    preview.add_argument("--id")
    preview.add_argument("--soundfont")
    export = sub.add_parser("export", help="Assemble accepted phrases in order and write the score handoff.")
    export.add_argument("directory", type=Path)
    export.add_argument(
        "--ids", nargs="+", required=True, help="Accepted candidate IDs, in song order; repetitions are allowed."
    )
    export.add_argument("--output", type=Path, required=True, help="New output directory.")
    export.add_argument("--title")
    export.add_argument("--soundfont")
    imported = sub.add_parser("import-score", help="Add an authored composition.json as an audition candidate.")
    imported.add_argument("directory", type=Path)
    imported.add_argument("score", type=Path)
    imported.add_argument("--from", dest="parent_id", help="Accepted parent; verifies and inherits its melody locks.")
    imported.add_argument("--trace", type=Path, help="Creation record from Recorder.finish(score).")
    undo = sub.add_parser("undo", help="Restore the previous session revision.")
    undo.add_argument("directory", type=Path)
    return result


def run(args) -> dict:
    directory = args.directory.resolve()
    if args.command == "init":
        brief = {
            k: getattr(args, k) for k in ("title", "key", "mode", "tempo", "bars", "grid", "low", "high", "harmony")
        }
        brief["meter"] = [int(x) for x in args.meter.split("/")]
        return session.create(directory, brief, args.seed)
    if args.command == "generate":
        ids = session.generate(
            directory,
            **{k: getattr(args, k) for k in ("parent_id", "rhythm_id", "operation", "count", "seed", "fresh")},
        )
        render_candidates(directory, ids, args.soundfont)
        return {"candidates": ids, "next": "Run serve, listen, and wait for the user's selection."}
    if args.command == "status":
        state = session.load(directory)
        return {
            **state,
            "candidates": {
                k: {key: value for key, value in v.items() if key not in ("score", "trace")}
                for k, v in state["candidates"].items()
            },
        }
    if args.command == "show":
        return session.candidate(session.load(directory), args.id)
    if args.command == "trace":
        return resolve(session.load(directory), [args.id])
    if args.command == "review":
        locks = []
        for value in args.lock:
            pieces = value.split(":")
            if len(pieces) != 2:
                raise CompositionError("Use --lock START:END, measured in quarter notes.")
            locks.append({"start_qn": pieces[0], "end_qn": pieces[1]})
        state = session.review(directory, args.id, args.decision, args.feedback, locks)
        return {"revision": state["revision"], "review": state["candidates"][args.id]["review"]}
    if args.command == "undo":
        state = session.undo(directory)
        return {"revision": state["revision"], "candidates": list(state["candidates"])}
    if args.command == "import-score":
        identity = session.import_candidate(
            directory,
            session.read_json(args.score),
            args.parent_id,
            session.read_json(args.trace) if args.trace else None,
        )
        render_candidates(directory, [identity])
        return {"candidate": identity}
    if args.command in ("serve", "render"):
        state = session.load(directory)
        ids = [args.id] if getattr(args, "id", None) else list(state["candidates"])
        render_candidates(directory, ids, args.soundfont)
        if args.command == "render":
            return {"rendered": ids}
        server = make_server(directory, args.port)
        print(
            json.dumps(
                {
                    "ok": True,
                    "url": f"http://127.0.0.1:{server.server_port}",
                    "next": "Save selections, then return to chat and say continue.",
                }
            ),
            flush=True,
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return {"stopped": True}
    if args.command == "export":
        state = session.load(directory)
        selected = [session.candidate(state, identity, accepted=True) for identity in args.ids]
        score = assemble([item["score"] for item in selected], args.title or state["brief"]["title"])
        score["provenance"] = {
            "candidates": args.ids,
            "session_revision": state["revision"],
            "recipes": [{k: item[k] for k in ("id", "seed", "parents", "kind", "review")} for item in selected],
        }
        history = resolve(state, args.ids)
        history["result"] = material(score)
        position = qn("0")
        for item in selected:
            history["assembly"].append(
                {"candidate_id": item["id"], "onset_qn": str(position), "duration_qn": item["score"]["length_qn"]}
            )
            position += qn(item["score"]["length_qn"])
        score["provenance"]["creation_history"] = history
        lowered = export_score(score)
        output = args.output.resolve()
        if output.exists():
            raise CompositionError("Choose a new export directory; existing exports are preserved.")
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".composition-export-", dir=output.parent) as temporary:
            staging = Path(temporary)
            session.write_json(staging / "composition.json", score)
            session.write_json(staging / "orchestron-score.json", lowered)
            session.write_json(staging / "render.json", render(score, staging, args.soundfont))
            staging.rename(output)
        return {
            "composition": str(output / "composition.json"),
            "score": str(output / "orchestron-score.json"),
            "tracks": len(lowered["tracks"]),
            "next": "Use Performance Creator: add instruments on the score channels, edit apply-score, edit validate, edit commit.",
        }
    raise CompositionError("Unknown command.")


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        result = run(args)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except (CompositionError, OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
