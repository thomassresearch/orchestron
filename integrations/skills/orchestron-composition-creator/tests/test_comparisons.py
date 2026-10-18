import copy
import importlib.util
import json
from pathlib import Path

import pytest

from orchestron_composition import session
from orchestron_composition.cli import asset_path, main
from orchestron_composition.comparisons import endings, harmonies
from orchestron_composition.generators import validate_brief
from orchestron_composition.score import CompositionError, end
from orchestron_composition.trace import resolve, validate_history


@pytest.fixture
def motif():
    return json.loads((Path(__file__).parent / "fixtures/motif.json").read_text())


@pytest.fixture
def brief():
    return validate_brief({"key": "A", "mode": "aeolian", "low": 60, "high": 81})


@pytest.fixture
def settings():
    return {
        "schema": "orchestron.harmony-comparison",
        "version": 1,
        "settings": [
            {"label": "Tonic", "degrees": [1, 3, 5], "bass_degree": 1},
            {"label": "Mediant", "degrees": [3, 5, 7], "bass_degree": 3},
        ],
    }


def accepted(directory, motif, brief, locks=None):
    session.create(directory, brief, 42)
    identity = session.import_candidate(directory, motif)
    session.review(directory, identity, "keep", "Preserve the delayed opening", locks or [])
    return identity


def test_endings_have_four_audible_goals_and_preserve_opening_and_harmony(motif, brief):
    original = copy.deepcopy(motif)
    variants, locks = endings(motif, brief, "4", [])
    assert locks == [{"start_qn": "0", "end_qn": "4"}]
    assert len(variants) == 4
    assert len({json.dumps(s["parts"]) for _, s, _ in variants}) == 4
    results = {}
    for kind, score, recorder in variants:
        results[kind] = score["parts"][0]["events"][4:]
        assert score["parts"][0]["events"][:4] == motif["parts"][0]["events"][:4]
        assert score["parts"][1:] == motif["parts"][1:]
        assert score["length_qn"] == "8"
        assert recorder.steps[0]["parameters"]["protected_silence"] == [
            {"start_qn": "0", "end_qn": "1/2"},
            {"start_qn": "1", "end_qn": "3/2"},
            {"start_qn": "7/2", "end_qn": "4"},
        ]
    assert results["ending_settled"][-1]["pitch_midi"] % 12 == 9
    assert results["ending_suspended"][-1]["pitch_midi"] % 12 == 11
    peak_notes = results["ending_peak"]
    assert peak_notes[1]["pitch_midi"] > max(e["pitch_midi"] for e in motif["parts"][0]["events"])
    assert peak_notes[1]["pitch_midi"] > max(peak_notes[0]["pitch_midi"], peak_notes[-1]["pitch_midi"])
    assert end(results["ending_space"][-1]) == 6
    assert motif == original
    assert [s for _, s, _ in endings(motif, brief, "4", [])[0]] == [s for _, s, _ in variants]


def test_boundary_note_is_preserved_whole_and_tail_start_is_recorded(motif, brief):
    motif["parts"][0]["events"][3]["duration_qn"] = "3/2"
    motif["parts"][0]["events"][4]["onset_qn"] = "9/2"
    motif["parts"][0]["events"][4]["duration_qn"] = "1/2"
    variants, _ = endings(motif, brief, "4", [])
    for _, score, recorder in variants:
        assert score["parts"][0]["events"][3] == motif["parts"][0]["events"][3]
        assert score["parts"][0]["events"][4]["onset_qn"] == "9/2"
        assert recorder.steps[0]["parameters"]["effective_start_qn"] == "9/2"


def test_endings_choose_an_octave_that_leaves_room_for_the_peak(motif, brief):
    brief["low"] = 57
    brief["high"] = 72
    variants, _ = endings(motif, brief, "4", [])
    peak = variants[2][1]["parts"][0]["events"][5]["pitch_midi"]
    assert 69 < peak <= 72


def test_failed_preview_can_be_repaired_without_regenerating(tmp_path, motif, brief, monkeypatch, capsys):
    from orchestron_composition import cli

    parent = accepted(tmp_path, motif, brief)
    with monkeypatch.context() as patch:

        def fail(*args):
            raise CompositionError("Test renderer failure")

        patch.setattr(cli, "render", fail)
        assert main(["compare-endings", str(tmp_path), "--from", parent, "--start", "4"]) == 1
    assert "Test renderer failure" in capsys.readouterr().err
    before = (tmp_path / "session.json").read_bytes()
    state = session.load(tmp_path)
    assert len(state["rounds"][-1]["ids"]) == 4
    assert main(["render", str(tmp_path)]) == 0
    assert (tmp_path / "session.json").read_bytes() == before
    for identity in state["rounds"][-1]["ids"]:
        assert (tmp_path / "previews" / identity / "mix.wav").is_file()


@pytest.mark.parametrize("problem", ["tail_note", "tail_silence", "no_room", "bad_grid", "pending", "capacity"])
def test_failed_comparison_leaves_no_partial_round(tmp_path, motif, brief, problem):
    locks = []
    if problem == "tail_note":
        locks = [{"start_qn": "6", "end_qn": "8"}]
    elif problem == "tail_silence":
        motif["parts"][0]["events"].pop()
        locks = [{"start_qn": "6", "end_qn": "8"}]
    elif problem == "no_room":
        motif["parts"][0]["events"][2]["pitch_midi"] = 81
    parent = accepted(tmp_path, motif, brief, locks)
    if problem == "pending":
        session.review(tmp_path, parent, "pending", "", [])
    elif problem == "capacity":
        with session.transaction(tmp_path) as state:
            for i in range(124):
                state["candidates"][f"extra-{i}"] = copy.deepcopy(state["candidates"][parent])
    before = (tmp_path / "session.json").read_bytes()
    with pytest.raises(CompositionError):
        session.compare(tmp_path, parent, start_qn="18/5" if problem == "bad_grid" else "4")
    assert (tmp_path / "session.json").read_bytes() == before


def test_harmony_preserves_entire_melody_other_parts_and_instrument_metadata(motif, settings):
    motif["parts"].append({"id": "counterline", "channel": 3, "program": 8, "events": []})
    motif["parts"][1]["program"] = 12
    original = copy.deepcopy(motif)
    variants = harmonies(motif, settings, "harmony")
    assert len(variants) == 2
    for _, score, recorder in variants:
        assert score["parts"][0] == motif["parts"][0]
        assert score["parts"][2] == motif["parts"][2]
        assert score["parts"][1]["program"] == 12
        assert score["parts"][1]["channel"] == 2
        assert {e["duration_qn"] for e in score["parts"][1]["events"]} == {"8"}
        assert recorder.steps[0]["inputs"] == original["parts"]
    assert [e["pitch_midi"] for e in variants[0][1]["parts"][1]["events"]] == [45, 57, 60, 64]
    assert [e["pitch_midi"] for e in variants[1][1]["parts"][1]["events"]] == [48, 60, 64, 67]
    assert motif == original


def test_harmony_can_add_a_part_and_respects_enharmonic_octave(motif, settings):
    motif["parts"] = motif["parts"][:1]
    motif["key"] = "Cb"
    motif["mode"] = "ionian"
    variants = harmonies(motif, settings, "new-harmony")
    first = variants[0][1]
    assert first["parts"][0] == motif["parts"][0]
    assert first["parts"][1]["channel"] == 2
    assert first["parts"][1]["id"] == "new-harmony"
    assert [e["pitch_midi"] for e in first["parts"][1]["events"]] == [35, 47, 51, 54]


@pytest.mark.parametrize(
    "problem", ["identical", "reordered", "duplicate_degree", "bad_degree", "bad_label", "lead", "shared_channel"]
)
def test_invalid_harmony_is_atomic(tmp_path, motif, brief, settings, problem):
    part = "harmony"
    if problem in ("identical", "reordered"):
        settings["settings"][1] = copy.deepcopy(settings["settings"][0])
        if problem == "reordered":
            settings["settings"][1]["degrees"].reverse()
    elif problem == "duplicate_degree":
        settings["settings"][1]["degrees"] = [1, 1, 5]
    elif problem == "bad_degree":
        settings["settings"][1]["bass_degree"] = True
    elif problem == "bad_label":
        settings["settings"][1]["label"] = None
    elif problem == "lead":
        part = "lead"
    elif problem == "shared_channel":
        motif["parts"][1]["channel"] = 1
        for note in motif["parts"][1]["events"]:
            note["pitch_midi"] -= 12
    parent = accepted(tmp_path, motif, brief)
    before = (tmp_path / "session.json").read_bytes()
    with pytest.raises(CompositionError):
        session.compare(tmp_path, parent, settings=settings, part_id=part)
    assert (tmp_path / "session.json").read_bytes() == before


def test_comparison_undo_and_portable_history(tmp_path, motif, brief, settings, capsys):
    parent = accepted(tmp_path, motif, brief)
    parent_review = copy.deepcopy(session.load(tmp_path)["candidates"][parent]["review"])
    ids = session.compare(tmp_path, parent, start_qn="4")
    state = session.load(tmp_path)
    assert state["candidates"][parent]["review"] == parent_review
    assert all(state["candidates"][i]["review"]["decision"] == "pending" for i in ids)
    assert state["rounds"][-1]["ids"] == ids
    session.review(tmp_path, ids[0], "keep", "This arrival works", state["candidates"][ids[0]]["review"]["locks"])
    pair = session.compare(tmp_path, ids[0], settings=settings)
    state = session.load(tmp_path)
    before = resolve(state, [pair[1]])
    session.review(tmp_path, pair[1], "keep", "Prefer this context", state["candidates"][pair[1]]["review"]["locks"])
    output = tmp_path / "export"
    assert main(["export", str(tmp_path), "--ids", pair[1], "--output", str(output)]) == 0
    capsys.readouterr()
    score = session.read_json(output / "composition.json")
    assert len(score["provenance"]["creation_history"]["nodes"]) == 3
    destination = tmp_path / "reimport"
    session.create(destination, brief, 42)
    imported = session.import_candidate(destination, score)
    history = resolve(session.load(destination), [imported])
    validate_history(history)
    assert history["nodes"][2]["steps"] == before["nodes"][2]["steps"]
    session.undo(tmp_path)  # review
    session.undo(tmp_path)  # whole harmony round
    assert all(i not in session.load(tmp_path)["candidates"] for i in pair)


def test_script_and_cli_study_wait_for_selection_and_render_all_previews(tmp_path, capsys):
    script = Path(__file__).parents[1] / "scripts/start_motif_study.py"
    spec = importlib.util.spec_from_file_location("motif_study", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    directory = tmp_path / "study"
    result = module.start(directory)
    parent = result["candidate"]
    assert session.load(directory)["candidates"][parent]["review"]["decision"] == "pending"
    assert main(["compare-endings", str(directory), "--from", parent, "--start", "4"]) == 1
    capsys.readouterr()
    session.review(directory, parent, "keep", "Test selection", [])
    assert main(["compare-endings", str(directory), "--from", parent, "--start", "4"]) == 0
    ids = json.loads(capsys.readouterr().out)["result"]["candidates"]
    assert len(ids) == 4
    state = session.load(directory)
    session.review(directory, ids[0], "keep", "Test selection", state["candidates"][ids[0]]["review"]["locks"])
    assert main(["compare-harmony", str(directory), "--from", ids[0]]) == 0
    pair = json.loads(capsys.readouterr().out)["result"]["candidates"]
    assert len(pair) == 2
    for identity in [*ids, *pair]:
        for name in ("mix.wav", "solo.wav", "mix.mid", "solo.mid", "score.musicxml"):
            assert (directory / "previews" / identity / name).stat().st_size > 0
    assert (directory / "previews" / pair[0] / "solo.wav").read_bytes() == (
        directory / "previews" / pair[1] / "solo.wav"
    ).read_bytes()
    assert asset_path("motif-study/harmonies.json").is_file()
    before = (directory / "session.json").read_bytes()
    with pytest.raises(CompositionError):
        module.start(directory)
    assert (directory / "session.json").read_bytes() == before
