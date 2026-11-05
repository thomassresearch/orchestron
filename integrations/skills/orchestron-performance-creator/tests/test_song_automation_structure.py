import copy
import json
from pathlib import Path

import pytest

from orchestron.cli import orchestron_cli as cli
from orchestron.song_authoring import put_lane, put_definition, put_clip
from orchestron.song_model import QUARTER, SongError, empty_clip_config, lane_for, model, validate
from orchestron.song_automation import generate, command as automation, reconcile
from orchestron.song_structure import command as structure
from orchestron.song_runtime import audition_wire
from orchestron.clip_arrangement import project_clips


def fixture():
    c = empty_clip_config()
    put_lane(c, {"id": "lead", "source": "sequencer", "channel": 2})
    put_definition(c, "lead", {"id": "p", "music": {"lengthBeats": 4, "steps": "s0=C4"}})
    put_clip(c, "lead", {"id": "c", "children": ["p"], "repeat": 4})
    c["instruments"] = [
        {
            "id": "synth",
            "patchId": "patch",
            "midiChannel": 2,
            "performanceControllerMidiCCs": {"cutoff": 1, "resonance": 1},
        }
    ]
    patches = [
        {
            "id": "patch",
            "name": "Synth",
            "always_on": False,
            "performance_controllers": [
                {
                    "node_id": "cutoff",
                    "label": "Cutoff",
                    "controller_type": "float",
                    "min": 20,
                    "max": 20000,
                    "default": 200,
                    "scale": "logarithmic",
                },
                {
                    "node_id": "resonance",
                    "label": "Resonance",
                    "controller_type": "float",
                    "min": 0,
                    "max": 1,
                    "default": 0.5,
                    "scale": "linear",
                },
            ],
        }
    ]
    return c, patches


def test_generate_long_curve_idempotence_split_merge_and_suspend():
    c, patches = fixture()
    result = generate(c, patches, {"instrumentId": "synth", "start": 0, "length": "512b"})
    assert result["created"] == 1
    validate(c)
    before = copy.deepcopy(c)
    assert generate(c, patches, {"instrumentId": "synth", "start": 0, "length": "512b"})["reused"] == 1
    assert c == before
    target = result["targets"][0]
    payload = lane_for(c, target["laneId"])["definitions"][0]["payload"]
    assert payload["curveDurationTicks"] == 512 * QUARTER
    assert payload["keypoints"][0]["value"] == 42
    automation(c, patches, "automation.map", {"instrumentId": "synth", "mappings": {"resonance": 2}})
    assert len(model(c)["lanes"]) == 3
    validate(c)
    automation(c, patches, "automation.map", {"instrumentId": "synth", "mappings": {"resonance": 1}})
    assert len(model(c)["lanes"]) == 2
    automation(c, patches, "automation.map", {"instrumentId": "synth", "mappings": {"resonance": None, "cutoff": None}})
    assert c["sequencer"]["controllerSequencers"][0]["automationSuspended"]
    projected, _, _ = project_clips(c)
    assert not projected["sequencer"]["controllerSequencers"][0]["enabled"]
    assert lane_for(c, target["laneId"])["definitions"][0]["payload"] == payload


def test_different_automation_merge_requires_explicit_survivor():
    c, patches = fixture()
    c["instruments"][0]["performanceControllerMidiCCs"]["resonance"] = 2
    generated = generate(c, patches, {"instrumentId": "synth", "laneId": "lead", "clipId": "c"})
    assert generated["created"] == 2
    with pytest.raises(SongError, match="different automation"):
        automation(copy.deepcopy(c), patches, "automation.map", {"instrumentId": "synth", "mappings": {"resonance": 1}})
    survivor = generated["targets"][0]["laneId"]
    automation(
        c,
        patches,
        "automation.map",
        {"instrumentId": "synth", "mappings": {"resonance": 1}, "choices": {"synth:1": survivor}},
    )
    assert len(model(c)["lanes"]) == 2
    validate(c)


def test_repeat_grouping_preserves_fixed_index_schedule_and_audition():
    root = Path(__file__).resolve().parents[4] / "backend/tests/fixtures/clip_transposition"
    fixture = json.loads((root / "repetition_grouping.json").read_text())
    c = copy.deepcopy(fixture["before"])
    lane = model(c)["lanes"][0]
    clip = lane["clips"][0]
    first = clip["offset"] // sum(s["length"] for s in project_clips(c)[1][lane["id"]]["clips"][0]["content"])
    structure(
        c,
        "structure.edit",
        {
            "laneId": lane["id"],
            "clipId": clip["id"],
            "pass": first,
            "command": {
                "kind": "group-repetitions",
                "name": "Repeated",
                "level": "group",
                "range": {
                    "first": {"pass": first, "id": clip["children"][0]["id"]},
                    "last": {"pass": first + 1, "id": clip["children"][0]["id"]},
                },
            },
        },
    )
    validate(c)
    after = lane["clips"][0]
    assert after["id"] == clip["id"] and after["length"] == clip["length"] and after["mode"] == "once"
    assert c["version"] == 26
    group = next(d for d in lane["definitions"] if d["kind"] == "group")
    assert len({i["repeatIndex"] for i in group["children"]}) == 2
    target = {"laneId": lane["id"], "clipId": after["id"], "path": [after["children"][0]["id"]], "pass": 0}
    wire, request = audition_wire(c, target)
    assert request["clip_context"]
    audition = wire["score_tracks"][0]["audition_schedule"]
    assert all(not p["repetitions"] for p in audition["transpose_plans"])
    assert model(c)["lanes"][0]["clips"][0]["mode"] == "once"


def test_sections_and_duplicate_do_not_copy_patterns():
    c, _ = fixture()
    clip = lane_for(c, "lead")["clips"][0]
    structure(
        c,
        "structure.edit",
        {
            "laneId": "lead",
            "clipId": "c",
            "pass": 1,
            "command": {"kind": "duplicate", "parent": [], "ids": [clip["children"][0]["id"]]},
        },
    )
    validate(c)
    lane = lane_for(c, "lead")
    assert len(lane["definitions"]) == 1
    assert lane["clips"][0]["length"] == 20 * QUARTER
    structure(c, "sections.paste", {"lanes": ["lead"], "from": "0b", "length": "4b", "at": "20b", "mode": "insert"})
    validate(c)
    assert len(lane["definitions"]) == 1
    structure(c, "sections.close-time", {"lanes": ["lead"], "start": "20b", "length": "4b"})
    validate(c)
    assert len(lane["clips"]) == 1


def test_cross_lane_copy_uses_destination_timing_and_independent_definitions():
    c, _ = fixture()
    put_lane(c, {"id": "other", "source": "sequencer", "channel": 3, "timing": {"beatRateNumerator": 2}})
    structure(
        c, "structure.copy", {"laneId": "lead", "clipId": "c", "destinationLaneId": "other", "id": "copy", "start": 0}
    )
    validate(c)
    other = lane_for(c, "other")
    assert other["definitions"][0]["id"] != "p"
    assert other["clips"][0]["length"] == 8 * QUARTER
