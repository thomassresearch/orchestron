import copy

import pytest

from orchestron.cli import orchestron_cli as cli
from orchestron.song_authoring import put_lane, put_definition, put_clip
from orchestron.song_model import empty_clip_config, validate, lane_for, SongError
from orchestron.song_structure import command
from orchestron.song_transpose import edit, contributions
from orchestron.song_score_adapter import adapt
from orchestron.song_session import transaction


def all_sources():
    config = empty_clip_config()
    for source in ("sequencer", "drummer", "score", "controller", "arpeggiator"):
        put_lane(config, {"id": source, "source": source, "channel": 2})
        for i in range(9 if source == "score" else 1):
            put_definition(config, source, {"id": f"{source}-{i}", "music": {"lengthBeats": 4}})
        put_clip(config, source, {"id": f"{source}-clip", "children": [f"{source}-0"], "repeat": 4})
    return config


def test_native_export_zip_suffix_produces_importable_archive(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace
    from zipfile import ZipFile
    from orchestron.song_export import command as export_command
    config = empty_clip_config()
    draft = tmp_path / "draft.json"
    cli.save_edit_session(draft, {"name": "Test", "config": config})
    class Client:
        def download(self, path, payload):
            assert path == "/bundles/export/performance"
            return json.dumps(payload).encode()
    monkeypatch.setattr(cli, "ApiClient", lambda *a, **k: Client())
    monkeypatch.setattr(cli, "validate_edit_session", lambda *a: {})
    output = tmp_path / "test.orch.zip"
    export_command(SimpleNamespace(output=str(output), mode="native"),
                   cli.CliContext(api_url="test", timeout=1, json_output=True, debug=False, session_file=draft))
    with ZipFile(output) as archive:
        assert json.loads(archive.read("performance.orch.json"))["performance"]["config"] == config


@pytest.mark.parametrize("mode", ["native", "midi", "score"])
def test_csd_export_omits_history_without_changing_staged_or_native_config(tmp_path, monkeypatch, mode):
    import json
    from types import SimpleNamespace
    from orchestron.song_export import command as export_command

    config = all_sources()
    config["sequencer"]["clipHistory"] = {
        "version": 2, "cursor": 0, "basis": copy.deepcopy(config["sequencer"]["clipArrangement"]), "entries": []
    }
    config["arrangerHistory"] = {"version": 1, "cursor": 0, "basis": [], "entries": []}
    session = {"name": "With history", "config": config}
    original = copy.deepcopy(session)
    draft = tmp_path / "draft.json"
    cli.save_edit_session(draft, session)
    draft_bytes = draft.read_bytes()
    captured = []

    class Client:
        def download(self, path, payload):
            captured.append((path, payload))
            return json.dumps(payload).encode()

    monkeypatch.setattr(cli, "ApiClient", lambda *a, **k: Client())
    monkeypatch.setattr(cli, "load_edit_session", lambda _: session)
    monkeypatch.setattr(cli, "validate_edit_session", lambda *a: {})
    export_command(SimpleNamespace(output=str(tmp_path / "export.json"), mode=mode),
                   cli.CliContext(api_url="test", timeout=1, json_output=True, debug=False, session_file=draft))

    route, payload = captured[0]
    expected = copy.deepcopy(original["config"])
    if mode == "native":
        assert route == "/bundles/export/performance"
        assert payload["performance"]["config"] == expected
    else:
        assert route == "/bundles/export/performance-csd"
        assert payload["eventSource"] == ("midiFile" if mode == "midi" else "score")
        assert payload["sequencerConfig"] == cli.build_runtime_config(expected)
        assert payload["midiControllers"] == expected["sequencer"].get("midiControllers", [])
        del expected["sequencer"]["clipHistory"]
        del expected["arrangerHistory"]
        assert payload["performanceExport"]["performance"]["config"] == expected
    assert session == original
    assert draft.read_bytes() == draft_bytes


def test_all_five_sources_more_than_eight_definitions_validate_with_backend():
    from backend.app.models.performance import MasterRepairRequest
    from backend.app.models.session import SessionSequencerConfigRequest

    config = all_sources()
    validate(config)
    MasterRepairRequest(config=config)
    wire = SessionSequencerConfigRequest.model_validate(cli.build_runtime_config(config))
    assert len(wire.score_tracks[0].pads) == 9
    assert len(config["sequencer"]["clipArrangement"]["lanes"]) == 5


def test_runtime_snapshot_comparison_accepts_backend_aliases_and_rejects_music_changes():
    from orchestron.song_runtime import contains_wire
    from backend.app.models.session import SessionSequencerConfigRequest

    config = all_sources()
    target = {
        "laneId": "sequencer",
        "clipId": "sequencer-clip",
        "path": [lane_for(config, "sequencer")["clips"][0]["children"][0]["id"]],
    }
    edit(config, {"target": target, "scope": "placement", "offset": {"diatonicSteps": 0, "chromaticSemitones": 12}})
    wire = cli.build_runtime_config(config)
    snapshot = SessionSequencerConfigRequest.model_validate(wire).model_dump(mode="json")
    assert contains_wire(snapshot, wire)
    snapshot["tracks"][0]["pads"][0]["steps"][0]["note"] = 72
    assert not contains_wire(snapshot, wire)


def test_audition_command_revisions_and_arranger_transport_are_separate(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace
    from orchestron.song_runtime import command as runtime_command

    config = cli.normalize_performance_config(all_sources(), [])
    path = tmp_path / "draft.json"
    cli.save_edit_session(path, {"config": config, "attachedSessionId": "runtime"})
    target = tmp_path / "target.json"
    target.write_text(
        json.dumps(
            {
                "laneId": "sequencer",
                "clipId": "sequencer-clip",
                "path": [lane_for(config, "sequencer")["clips"][0]["children"][0]["id"]],
            }
        )
    )
    calls = []

    class Client:
        def get(self, path):
            if path.endswith("/config"):
                return {"generation": 1, "config": cli.build_runtime_config(config)}
            return {"state": "running", "instruments": []}

        def post(self, path, value=None):
            calls.append((path, value))
            return {}

        def put(self, path, value):
            return {}

    monkeypatch.setattr(cli, "ApiClient", lambda *a, **k: Client())
    monkeypatch.setattr(cli, "validate_edit_session", lambda *a: {})
    monkeypatch.setattr(cli, "runtime_assignments_match", lambda *a: True)
    ctx = cli.CliContext(api_url="test", timeout=1, json_output=True, debug=False, session_file=path)
    args = SimpleNamespace(session_id=None, edit_command="audition", action="start", target=str(target), scope="full")
    for action in ("start", "stop", "start", "stop"):
        args.action = action
        runtime_command(args, ctx)
    assert [value["revision"] for path, value in calls if path.endswith("/audition")] == [1, 2, 3, 4]
    args.edit_command, args.action = "transport", "play"
    runtime_command(args, ctx)
    args.action = "stop"
    runtime_command(args, ctx)
    assert calls[-2:] == [
        ("/sessions/runtime/sequencer/device-transport", {"action": "play", "arranger": True}),
        ("/sessions/runtime/sequencer/device-transport", {"action": "stop", "arranger": True}),
    ]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda c: c["sequencer"]["tracks"][0]["timing"].update(stepsPerBeat=7),
        lambda c: c["sequencer"]["tracks"][0].update(midiChannel=0),
        lambda c: lane_for(c, "arpeggiator")["definitions"][0]["payload"].update(lengthBeats=9),
        lambda c: lane_for(c, "arpeggiator")["definitions"][0]["payload"]["steps"][0].update(ratchets=5),
        lambda c: lane_for(c, "sequencer")["definitions"][0]["payload"]["steps"][0].update(typo=True),
    ],
)
def test_invalid_hidden_data_fails_without_staged_changes(tmp_path, mutation):
    path = tmp_path / "session.json"
    cli.save_edit_session(path, {"config": all_sources()})
    before = path.read_bytes()
    with pytest.raises(SongError):
        transaction(path, "bad", lambda config, session: mutation(config))
    assert path.read_bytes() == before


def test_explicit_score_adapter_preserves_events_and_retry():
    config, session = empty_clip_config(), {}
    spec = {
        "version": 2,
        "tempo": 123,
        "tracks": [
            {
                "type": "melodic",
                "name": "Accepted",
                "channel": 2,
                "length_beats": 4,
                "events": [{"at_step": 0, "duration_steps": 4, "root": "C4", "velocity": 87}],
            }
        ],
    }
    result = adapt(config, session, spec, "accepted")
    validate(config)
    before = copy.deepcopy(config)
    assert result["lanes"]
    adapt(config, session, spec, "accepted")
    assert config == before
    assert lane_for(config, result["lanes"][0]["laneId"])["definitions"][0]["payload"]["steps"][0]["velocity"] == 87


def test_shared_group_edit_remaps_other_placement_and_timed_growth_consumes_rest():
    config = empty_clip_config()
    put_lane(config, {"id": "lead", "source": "sequencer"})
    for key in ("a", "b"):
        put_definition(config, "lead", {"id": key, "music": {"lengthBeats": 1}})
    put_definition(config, "lead", {"id": "g", "kind": "group", "children": ["a", {"rest": "1b"}, "b"]})
    for i in range(2):
        put_clip(config, "lead", {"id": f"c{i}", "start": f"{i * 8}b", "children": ["g", {"rest": "1b"}, "b"]})
    lane = lane_for(config, "lead")
    a = lane["definitions"][2]["children"][0]["id"]
    root0, root1 = [c["children"][0]["id"] for c in lane["clips"]]
    target = {"laneId": "lead", "clipId": "c1", "path": [root1, a]}
    edit(config, {"target": target, "scope": "placement", "offset": {"diatonicSteps": 0, "chromaticSemitones": 12}})
    command(
        config,
        "structure.edit",
        {
            "laneId": "lead",
            "clipId": "c0",
            "scope": "shared",
            "command": {
                "kind": "resize",
                "parent": [root0],
                "ids": [a],
                "ticks": "2b",
                "target": {"path": [root0], "ticks": 0},
            },
        },
    )
    validate(config)
    other = lane["clips"][1]
    target["path"] = other["transposePlacements"][0]["path"]
    assert contributions(config, target)["effective"]["chromaticSemitones"] == 12
    assert other["start"] == 8 * 20160
    assert lane["definitions"][0]["payload"]["lengthBeats"] == 2
