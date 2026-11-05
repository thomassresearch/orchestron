"""Bounded discovery over authoritative definitions, never shadow pads."""

from .song_model import (
    QUARTER,
    content_length,
    duration,
    fail,
    find,
    fingerprint,
    integer,
    lane_for,
    leaves,
    model,
    source_for,
    target_at,
)
from .song_session import counts
from .song_transpose import contributions, pitch


def page(items, offset=0, limit=20):
    integer(offset)
    integer(limit, 1, 100)
    return {
        "items": items[offset : offset + limit],
        "total": len(items),
        "offset": offset,
        "nextOffset": offset + limit if offset + limit < len(items) else None,
        "truncated": offset + limit < len(items),
    }


def inspect(
    config,
    *,
    view="summary",
    lane_id=None,
    clip_id=None,
    definition_id=None,
    start=None,
    end=None,
    offset=0,
    limit=20,
    target=None,
):
    m = model(config)
    integer(offset)
    integer(limit, 1, 100)
    base = {
        "arrangementRevision": m["revision"],
        "fingerprint": fingerprint(m),
        "timebase": QUARTER,
        "endTicks": m["end"],
        "endMasterBeats": str(m["end"] / QUARTER),
        "counts": counts(config),
    }
    if view == "summary":
        return {
            **base,
            **page(
                [
                    {
                        "laneId": lane_item["id"],
                        "name": source_for(config, lane_item).get("name"),
                        "source": lane_item["source"],
                        "definitions": len(lane_item["definitions"]),
                        "clips": len(lane_item["clips"]),
                        "cycleTicks": lane_item["cycleTicks"],
                        "automationTarget": source_for(config, lane_item).get("automationTarget"),
                        "suspended": source_for(config, lane_item).get("automationSuspended", False),
                    }
                    for lane_item in m["lanes"]
                ],
                offset,
                limit,
            ),
        }
    lane = lane_for(config, lane_id or (target or {}).get("laneId"))
    if view == "definitions":
        rows = []
        for d in lane["definitions"]:
            if definition_id and d["id"] != definition_id:
                continue
            uses = [
                {"containerId": c["id"], "childId": i["id"]}
                for c in [*lane["definitions"], *lane["clips"]]
                for i in c.get("children", [])
                if i.get("definitionId") == d["id"]
            ]
            payload = d.get("payload", {})
            rows.append(
                {
                    "definitionId": d["id"],
                    "name": d["name"],
                    "kind": d["kind"],
                    "revision": d["revision"],
                    "durationTicks": duration(config, lane, d)
                    if d["kind"] == "pattern"
                    else content_length(config, lane, d["children"]),
                    "directUses": len(uses),
                    "unused": not uses,
                    "storedSteps": len(payload.get("steps", [])),
                    "storedNotes": len(payload.get("notes", [])),
                    "children": len(d.get("children", [])),
                    "transposeProfileId": d.get("transposeProfileId"),
                }
            )
        return {**base, **page(rows, offset, limit)}
    if view == "payload":
        d = find(lane["definitions"], definition_id)
        return {**base, "definition": d, "detail": True}
    if view == "usage":
        find(lane["definitions"], definition_id)
        rows = [
            {"containerId": c["id"], "childId": i["id"], "containerKind": c.get("kind", "clip")}
            for c in [*lane["definitions"], *lane["clips"]]
            for i in c.get("children", [])
            if i.get("definitionId") == definition_id
        ]
        return {**base, **page(rows, offset, limit)}
    if view == "clips":
        rows = []
        for c in lane["clips"]:
            if clip_id and c["id"] != clip_id:
                continue
            length = content_length(config, lane, c["children"])
            rows.append(
                {
                    **{k: c[k] for k in ("id", "name", "start", "length", "offset", "mode")},
                    "contentTicks": length,
                    "firstPass": c["offset"] // length if c["mode"] == "loop" else 0,
                    "lastPass": (c["offset"] + c["length"] - 1) // length if c["mode"] == "loop" else 0,
                    "childCount": len(c["children"]),
                    "childrenTruncated": len(c["children"]) > 20,
                    "children": [
                        {
                            "id": i["id"],
                            **(
                                {"definitionId": i["definitionId"]}
                                if "definitionId" in i
                                else {"restTicks": i["restTicks"]}
                            ),
                        }
                        for i in c["children"][:20]
                    ],
                }
            )
        return {**base, **page(rows, offset, limit)}
    if view == "effective":
        lane, clip, ancestry = target_at(config, target)
        value = contributions(config, target)
        d = ancestry[-1][1]
        original = []
        if d["kind"] == "pattern":
            p = d["payload"]
            if d["source"] == "score":
                original = [n["pitch"] for n in p["notes"]]
            elif d["source"] == "sequencer":
                from .cli.orchestron_cli import chord_notes

                for s in p["steps"]:
                    note = s.get("note") if isinstance(s, dict) else s
                    if note is not None:
                        notes = (
                            chord_notes(note, s.get("chord", "none"))
                            if isinstance(s, dict) and not isinstance(note, list)
                            else note
                        )
                        original.extend(notes if isinstance(notes, list) else [notes])
            rows = [
                {
                    "original": n,
                    "effective": pitch(n, p.get("scaleRoot", "C"), p.get("mode", "aeolian"), value["effective"]),
                }
                for n in original
            ]
        else:
            rows = []
        return {
            **base,
            **value,
            **page(rows, offset, limit),
            "outOfRange": "omitted",
            "arpeggiator": "Input-dependent; applied during preparation." if lane["source"] == "arpeggiator" else None,
        }
    if view not in ("tree", "window"):
        fail("Unknown inspection view.", "view")
    clip = find(lane["clips"], clip_id)
    spans = leaves(config, lane, clip["children"])
    length = sum(s["length"] for s in spans)
    if view == "tree":

        def tree(items, at=0, path=()):
            result, cursor = [], at
            for item in items:
                current = [*path, item["id"]]
                definition = find(lane["definitions"], item["definitionId"]) if "definitionId" in item else None
                size = content_length(config, lane, [item])
                result.append({"definition": definition, "path": current, "start": cursor, "length": size})
                if definition and definition["kind"] != "pattern":
                    result.extend(tree(definition["children"], cursor, current))
                cursor += size
            return result

        spans = tree(clip["children"])
    if view == "window" and (start is None or end is None):
        fail("Window inspection requires from/to exact ticks.", "window")
    start = clip["start"] if start is None else max(start, clip["start"])
    end = min(clip["start"] + clip["length"], end if end is not None else start + length)
    first = (clip["offset"] + start - clip["start"]) // length if clip["mode"] == "loop" else 0
    last = (clip["offset"] + end - clip["start"] - 1) // length if clip["mode"] == "loop" else 0
    # Arithmetic paging skips virtual passes without enumerating the intervening song.
    total = max(0, last - first + 1) * len(spans)
    rows = []
    for index in range(offset, min(total, offset + limit)):
        source_pass, i = first + index // len(spans), index % len(spans)
        span = spans[i]
        source_start = clip["start"] - clip["offset"] + source_pass * length + span["start"]
        left, right = max(start, source_start), min(end, source_start + span["length"])
        if right <= left:
            continue
        selector = {
            "laneId": lane["id"],
            "clipId": clip["id"],
            "path": span["path"],
            "pass": source_pass,
            "revision": m["revision"],
            "fingerprint": base["fingerprint"],
        }
        rows.append(
            {
                "target": selector,
                "definitionId": span["definition"]["id"] if span["definition"] else None,
                "start": left,
                "length": right - left,
                "sourceOffset": left - source_start,
            }
        )
    return {
        **base,
        "items": rows,
        "totalCandidateSpans": total,
        "offset": offset,
        "nextOffset": offset + limit if offset + limit < total else None,
        "truncated": offset + limit < total,
    }
