"""Clip-aware runtime operations using the existing backend preparation/scheduler."""

from copy import deepcopy
from urllib.parse import quote
import re

from .song_model import content_length, fail, leaves, target_at, uid
from .clip_arrangement import project_clips
from .song_transpose import offset_at


def coordinated_push(client, session_id, config):
    from .cli.orchestron_cli import build_runtime_config

    prefix = f"/sessions/{quote(session_id)}"
    snapshots = client.get(prefix + "/performance-controllers")
    changed = []
    for binding in config.get("instruments", []):
        snapshot = snapshots.get(binding["id"], {})
        old, new = snapshot.get("midi_ccs", {}), binding.get("performanceControllerMidiCCs", {})
        delta = {n: new.get(n) for n in old.keys() | new.keys() if old.get(n) != new.get(n)}
        if delta:
            changed.append((binding, snapshot, delta))
    if len(changed) > 1:
        fail(
            "This backend coordinates one instrument mapping per request. Stage/push one owner at a time, or rebuild a CLI-owned runtime.",
            "instruments",
            "multiple_mapping_transactions",
            instrumentIds=[i[0]["id"] for i in changed],
        )
    if not changed:
        return None
    binding, snapshot, delta = changed[0]
    other_values = [
        i["id"]
        for i in config.get("instruments", [])
        if i["id"] != binding["id"]
        and i.get("performanceControllerValues", {}) != snapshots.get(i["id"], {}).get("values", {})
    ]
    if other_values:
        fail(
            "Push other owners' fixed values separately before coordinating this mapping change.",
            code="multiple_mapping_transactions",
            instrumentIds=other_values,
        )
    values = binding.get("performanceControllerValues", {})
    prior = snapshot.get("values", {})
    value_delta = {n: values.get(n) for n in values.keys() | prior.keys() if values.get(n) != prior.get(n)}
    result = client.patch(
        prefix + f"/instruments/{quote(binding['id'])}/performance-controllers",
        {
            "midi_ccs": delta,
            "values": value_delta,
            "revisions": snapshot.get("revisions", {}),
            "midi_revisions": snapshot.get("midi_revisions", {}),
            "sequencer_config": build_runtime_config(config),
        },
    )
    return {
        "instrumentId": binding["id"],
        "controllerState": result,
        "status": client.get(prefix + "/sequencer/status"),
        "state": "applied_at_render_boundary",
        "audible": "unknown",
    }


def audition_wire(config, target, scope="full"):
    """Freeze every contribution at its own repetition index; exact rest/crop timing."""
    from .cli.orchestron_cli import build_runtime_config, normalize_performance_config

    config = normalize_performance_config(deepcopy(config), [])
    lane, clip, ancestry = target_at(config, target)
    spans = leaves(config, lane, clip["children"])
    _, schedules, _ = project_clips(config)
    schedule = schedules[lane["id"]]
    source_clip = next(c for c in schedule["clips"] if c["id"] == clip["id"])
    matching = [i for i, s in enumerate(spans) if s["path"][: len(target["path"])] == target["path"]]
    if not matching:
        fail("Selected context has no audition content.", "target")
    content = deepcopy([source_clip["content"][i] for i in matching])
    logical = clip.get("repeatIndexBase", 0) + target.get("pass", 0)
    plans = [{"base": deepcopy(offset_at(p, logical)), "repetitions": []} for p in schedule.get("transpose_plans", [])]
    length = sum(s["length"] for s in content)
    offset = 0
    if scope == "cropped":
        duration = content_length(config, lane, clip["children"])
        start = clip["start"] - clip["offset"] + target.get("pass", 0) * duration + spans[matching[0]]["start"]
        left, right = max(clip["start"], start), min(clip["start"] + clip["length"], start + length)
        if right <= left:
            fail("This occurrence is hidden outside the clip window.")
        offset, length = left - start, right - left
    elif scope != "full":
        fail("Audition scope is full or cropped.")
    audition = {
        "version": 2,
        "transpose_plans": plans,
        "end": length,
        "cycle_ticks": length,
        "clips": [
            {
                "id": "cli-audition",
                "start": 0,
                "length": length,
                "offset": offset,
                "mode": "once",
                "content": [{**s, "transpose_refs": s.get("transpose_refs", [])} for s in content],
            }
        ],
    }
    wire = build_runtime_config(config)
    track_ids, arp_id = [], None
    for key in ("tracks", "score_tracks", "controller_tracks", "arpeggiators"):
        for track in wire.get(key, []):
            identity = track.get("track_id", track.get("arpeggiator_id"))
            if identity == lane["id"] or identity.startswith("drumrow:" + lane["id"] + ":"):
                track["audition_schedule"] = audition
                if key == "arpeggiators":
                    arp_id = identity
                else:
                    track_ids.append(identity)
    return wire, {
        "track_ids": track_ids,
        "arpeggiator_id": arp_id,
        "clip_context": True,
        "sequence": [next((s["pad"] for s in content if s["pad"] is not None), -1)],
    }


def command(args, ctx):
    from .cli import orchestron_cli as cli

    session = cli.load_edit_session(ctx.session_file)
    session_id = args.session_id or session.get("attachedSessionId")
    if not session_id:
        fail("Create or attach a runtime first.", "sessionId", "runtime_session_missing")
    client = cli.ApiClient(ctx.api_url, timeout=ctx.timeout)
    prefix = "/sessions/" + quote(session_id)
    if args.action == "status":
        cli.print_payload(
            {"stateChanged": False, "status": client.get(prefix + "/sequencer/status"), "audible": "unknown"}, ctx
        )
        return
    if args.edit_command == "transport":
        if args.action == "play":
            info = client.get(prefix)
            started = info.get("state") != "running"
            if started:
                client.post(prefix + "/start")
            result = client.post(prefix + "/sequencer/device-transport", {"action": "play", "arranger": True})
            session["transportStartedEngine"] = started or (
                session.get("transportSessionId") == session_id and session.get("transportStartedEngine", False)
            )
            session["transportSessionId"] = session_id
        elif args.action == "stop":
            result = client.post(prefix + "/sequencer/device-transport", {"action": "stop", "arranger": True})
            if session.get("transportStartedEngine") and session.get("transportSessionId") == session_id:
                client.post(prefix + "/stop")
            session["transportStartedEngine"] = False
        else:
            snapshot = client.get(prefix + "/sequencer/config")
            if snapshot["config"] is None:
                fail("Push a runtime configuration before seeking.")
            result = client.post(
                prefix + "/sequencer/seek",
                {
                    "position_step": args.step,
                    "config": {**snapshot["config"], "expected_generation": snapshot["generation"]},
                },
            )
    elif args.action == "start":
        target = cli.load_score_spec(__import__("pathlib").Path(args.target))
        wire, request = audition_wire(session["config"], target, args.scope)
        info = client.get(prefix)
        if not cli.runtime_assignments_match(session["config"], info):
            fail(
                "Rack topology differs from runtime; create/rebuild the runtime first.",
                code="runtime_instruments_changed",
            )
        if session.get("audition"):
            fail("Stop the existing CLI audition before starting another.", code="audition_active")
        snapshot = client.get(prefix + "/sequencer/config")
        base = cli.build_runtime_config(cli.normalize_performance_config(deepcopy(session["config"]), []))
        if snapshot["config"] is None or not contains_wire(snapshot["config"], base):
            fail(
                "The runtime music differs from this draft. Push the intended configuration explicitly before auditioning.",
                code="runtime_draft_differs",
            )
        wire["expected_generation"] = snapshot["generation"]
        # Only audition schedules differ from the existing music; ending the preview
        # restores the source at its current position without replacing external edits.
        previous = client.get(prefix + "/sequencer/status")
        identities = request["track_ids"] or [request["arpeggiator_id"]]
        if any(previous.get("auditions", {}).get(identity, {}).get("active") for identity in identities):
            fail(
                "The selected source already has an audition. End it before starting a CLI preview.",
                code="audition_active",
            )
        cli.validate_edit_session(session, client)
        client.put(prefix + "/sequencer/config", wire)
        started = info.get("state") != "running"
        if started:
            client.post(prefix + "/start")
        gesture = uid()
        revision = session.get("auditionRevisions", {}).get(session_id, 0) + 1
        request.update(action="preview_start", gesture_id=gesture, revision=revision)
        try:
            result = client.post(prefix + "/sequencer/audition", request)
        except Exception:
            if started:
                client.post(prefix + "/stop")
            raise
        session["audition"] = {
            "request": request,
            "startedEngine": started,
            "target": target,
            "previousRunning": previous.get("arrangement_running", False),
            "sessionId": session_id,
        }
        session.setdefault("auditionRevisions", {})[session_id] = revision
    else:
        audition = session.get("audition")
        if not audition or audition.get("sessionId") != session_id:
            fail("No CLI-owned audition is active on this session.", code="audition_missing")
        request = {**audition["request"], "action": "preview_end", "revision": audition["request"]["revision"] + 1}
        result = client.post(prefix + "/sequencer/audition", request)
        session.setdefault("auditionRevisions", {})[session_id] = request["revision"]
        if audition["startedEngine"]:
            client.post(prefix + "/stop")
        session.pop("audition", None)
    cli.save_edit_session(ctx.session_file, session)
    cli.print_payload(
        {
            "operation": args.edit_command + "." + args.action,
            "status": result,
            "state": "accepted",
            "audible": "unknown",
            "authoredStateChanged": False,
        },
        ctx,
    )


def contains_wire(actual, authored):
    if isinstance(authored, dict):
        if not isinstance(actual, dict):
            return False
        for key, value in authored.items():
            wire_key = key if key in actual else re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()
            if wire_key not in actual or not contains_wire(actual[wire_key], value):
                return False
        return True
    if isinstance(authored, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(authored)
            and all(contains_wire(a, b) for a, b in zip(actual, authored))
        )
    return actual == authored


def register(edit):
    for family, actions in [
        ("audition", ("start", "stop", "status")),
        ("transport", ("play", "stop", "seek", "status")),
    ]:
        parser = edit.add_parser(family, help="Temporary clip-aware runtime control; authored music is unchanged.")
        sub = parser.add_subparsers(dest="action", required=True)
        for action in actions:
            p = sub.add_parser(action)
            p.add_argument("--session-id")
            if family == "audition" and action == "start":
                p.add_argument("--target", required=True)
                p.add_argument("--scope", choices=["full", "cropped"], default="full")
            if action == "seek":
                p.add_argument("--step", type=int, required=True)
            p.set_defaults(func=command)
