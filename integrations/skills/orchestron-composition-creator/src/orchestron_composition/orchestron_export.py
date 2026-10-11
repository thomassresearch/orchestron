"""Exact lowering to editor-compatible monophonic tracks and finite pad loops."""

from __future__ import annotations

import json
from fractions import Fraction

from .score import CompositionError, end, qn, validate


def note_name(midi: int) -> str:
    return ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][midi % 12] + str(midi // 12 - 1)


def voices(events: list[dict]) -> list[list[dict]]:
    lanes: list[list[dict]] = []
    for item in sorted(events, key=lambda e: (qn(e["onset_qn"]), e["pitch_midi"])):
        lane = next((v for v in lanes if end(v[-1]) <= qn(item["onset_qn"])), None)
        if lane is None:
            lane = []
            lanes.append(lane)
        lane.append(item)
    return lanes or [[]]


def pauses(beats: int) -> list[str]:
    result = []
    for size in (32, 16, 8, 4, 2, 1):
        result.extend([f"P{size}"] * (beats // size))
        beats %= size
    return result


def export_score(score: dict) -> dict:
    validate(score)
    beat = Fraction(4, score["meter"][1])
    total = qn(score["length_qn"]) / beat
    if total.denominator != 1:
        raise CompositionError("Orchestron export needs a whole number of local beats, including trailing rests.")
    result = {
        "version": 2,
        "title": score.get("title", "Composition"),
        "tempo": score["tempo"],
        "key": score["key"],
        "mode": score["mode"],
        "tracks": [],
    }
    for part in score["parts"]:
        for voice_index, lane in enumerate(voices(part["events"])):
            grid = next(
                (
                    g
                    for g in (1, 2, 3, 4, 6, 8)
                    if all(
                        (qn(e[key]) * g / beat).denominator == 1 for e in lane for key in ("onset_qn", "duration_qn")
                    )
                ),
                None,
            )
            if grid is None:
                raise CompositionError(
                    f"{part['id']}: rhythm cannot fit a supported grid exactly. No quantization was applied."
                )
            segments = []
            start = 0
            while start < total:
                possible = min(int(total), start + min(16, 128 // grid))
                stop = next(
                    (
                        boundary
                        for boundary in range(possible, start, -1)
                        if not any(qn(e["onset_qn"]) < boundary * beat < end(e) for e in lane)
                    ),
                    None,
                )
                if stop is None:
                    raise CompositionError(
                        f"{part['id']}: a note crosses every possible pad boundary. Shorten or rephrase it explicitly."
                    )
                events = [
                    {
                        "root": note_name(e["pitch_midi"]),
                        "at_step": int((qn(e["onset_qn"]) / beat - start) * grid),
                        "duration_steps": int(qn(e["duration_qn"]) / beat * grid),
                        "velocity": e["velocity"],
                    }
                    for e in lane
                    if start * beat <= qn(e["onset_qn"]) < stop * beat
                ]
                segments.append({"length_beats": stop - start, "events": events})
                start = stop
            # More than eight distinct pads become additional tracks, padded with
            # silence to preserve absolute song position and the finite closing time.
            offset = 0
            while segments:
                pads, identities, root = [], {}, pauses(offset)
                length = 0
                consumed = 0
                for segment in segments:
                    identity = json.dumps(segment, sort_keys=True)
                    if identity not in identities:
                        if len(pads) == 8:
                            break
                        identities[identity] = len(pads) + 1
                        pads.append({"pad": len(pads) + 1, **segment})
                    root.append(identities[identity])
                    length += segment["length_beats"]
                    consumed += 1
                root += pauses(int(total) - offset - length)
                if len(root) > 256:
                    raise CompositionError("Arrangement exceeds 256 pad/rest tokens in one track.")
                result["tracks"].append(
                    {
                        "type": "melodic",
                        "name": f"{part.get('name', part['id'])} · {voice_index + 1}.{offset + 1}",
                        "channel": part["channel"],
                        "length_beats": pads[0]["length_beats"],
                        "scale_type": "neutral",
                        "timing": {
                            "meter_numerator": score["meter"][0],
                            "meter_denominator": score["meter"][1],
                            "steps_per_beat": grid,
                            "beat_rate_numerator": 1,
                            "beat_rate_denominator": 1,
                        },
                        "pads": pads,
                        "pad_loop": {"repeat": False, "root": root},
                    }
                )
                segments = segments[consumed:]
                offset += length
                if len(result["tracks"]) > 64:
                    raise CompositionError("Export exceeds 64 melodic voice tracks.")
    return result
