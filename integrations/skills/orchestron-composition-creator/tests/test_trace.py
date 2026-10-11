import copy
import hashlib
import json
from fractions import Fraction
from pathlib import Path

import pytest
from music21 import note, stream

from orchestron_composition import session
from orchestron_composition.cli import main
from orchestron_composition.generators import OPERATIONS, develop, new_phrase, validate_brief
from orchestron_composition.score import CompositionError
from orchestron_composition.trace import Recorder, lock_context, resolve, snapshot, validate_history
from orchestron_composition.vendor.arvo import transformations


def accepted(directory):
    session.create(directory, {}, 42)
    ids = session.generate(directory)
    for identity in ids:
        session.review(directory, identity, "keep", "Accepted source", [])
    return ids


@pytest.mark.parametrize("operation", OPERATIONS)
def test_recording_preserves_preexisting_musical_output_and_records_resolved_calls(operation):
    fingerprints = json.loads((Path(__file__).parent / "fixtures/generation_fingerprints.json").read_text())
    brief = validate_brief({})
    recorder = Recorder()
    parent = new_phrase(brief, 52, 1, recorder)

    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

    assert digest(parent) == fingerprints["starter"]
    assert not any(s["function"].startswith("arvo.") for s in recorder.steps)
    recorder = Recorder()
    result = develop(parent, brief, 55, operation, [{"start_qn": "0", "end_qn": "2"}], trace=recorder)
    assert digest(result) == fingerprints[operation]
    assert recorder.finish(result)["result"]["parts"] == result["parts"]
    call = next(s for s in recorder.steps if s["function"].startswith("arvo."))
    assert all(call["inputs"][key] == value for key, value in call["parameters"].items())
    assert call["output"]["events"]
    assert all(isinstance(n["duration_qn"], str) for n in call["output"]["events"])
    if operation in ("vary", "answer", "continue"):
        assert call["parameters"]["steps"] in (-1, 1, 2)
        assert call["parameters"]["in_place"] is False
        assert call["parameters"]["reference_scale"]["type"] == "DorianScale"
    fitted = next(s for s in recorder.steps if s["function"] == "orchestron.fit_pitch")
    projected = next(s for s in recorder.steps if s["function"] == "orchestron.project_rhythm")
    assert projected["inputs"]["pitches"] == fitted["output"]
    assert projected["inputs"]["slots"] == parent["parts"][0]["events"]


def test_capture_snapshots_in_place_arguments_and_defaults():
    recorder = Recorder()
    motif = stream.Stream([note.Note(60), note.Note(64)])
    recorder.call(transformations.octave_shift, motif, 1, in_place=True)
    call = recorder.steps[0]
    assert [e["pitches_midi"] for e in call["inputs"]["original_stream"]["events"]] == [[60], [64]]
    assert [e["pitches_midi"] for e in call["output"]["events"]] == [[72], [76]]
    assert snapshot(note.Rest(quarterLength=Fraction(1, 3)))["duration_qn"] == "1/3"


def test_hybrid_chain_freezes_reviews_locks_and_deduplicates_ancestors(tmp_path):
    pitch, rhythm, _ = accepted(tmp_path)
    session.review(tmp_path, pitch, "favourite", "Keep the opening", [{"start_qn": "0", "end_qn": "2"}])
    child = session.generate(tmp_path, parent_id=pitch, rhythm_id=rhythm, operation="answer", seed=2, count=1)[0]
    session.review(tmp_path, child, "keep", "Another round", [])
    final = session.generate(tmp_path, parent_id=child, rhythm_id=rhythm, operation="retrograde", count=1)[0]
    before = resolve(session.load(tmp_path), [final])
    assert [n["id"] for n in before["nodes"]] == [pitch, rhythm, child, final]
    c = next(n for n in before["nodes"] if n["id"] == child)
    assert [s["role"] for s in c["sources"]] == ["pitch", "rhythm"]
    assert c["sources"][0]["review"]["feedback"] == "Keep the opening"
    restore = next(s for s in c["steps"] if s["function"] == "orchestron.restore_locks")
    assert restore["parameters"]["retained_notes"]
    assert restore["parameters"]["locks"] == [{"start_qn": "0", "end_qn": "2"}]
    assert restore["inputs"]["discarded"]
    session.review(tmp_path, pitch, "reject", "Changed later", [])
    assert resolve(session.load(tmp_path), [final]) == before
    session.undo(tmp_path)
    assert resolve(session.load(tmp_path), [final]) == before


def test_locked_silence_and_whole_sustained_notes_are_explicit():
    events = [{"pitch_midi": 62, "onset_qn": "0", "duration_qn": "5/3", "velocity": 90}]
    context = lock_context(events, [{"start_qn": "1", "end_qn": "3"}])
    assert context["retained_notes"] == events
    assert context["protected_silence"] == [{"start_qn": "5/3", "end_qn": "3"}]
    brief = validate_brief({})
    parent = new_phrase(brief, 52, 1)
    parent["parts"][0]["events"] = events
    rhythm = copy.deepcopy(parent)
    rhythm["parts"][0]["events"] = [{"pitch_midi": 64, "onset_qn": "1", "duration_qn": "1", "velocity": 80}]
    recorder = Recorder()
    child = develop(parent, brief, 2, "answer", context["locks"], rhythm, recorder)
    restore = recorder.steps[-1]
    assert restore["parameters"] == context
    assert restore["inputs"]["discarded"] == restore["inputs"]["generated"]
    assert child["parts"][0]["events"] == restore["output"] == events


def test_custom_trace_import_and_legacy_gaps(tmp_path):
    parent, rhythm, _ = accepted(tmp_path)
    score = copy.deepcopy(session.load(tmp_path)["candidates"][parent]["score"])
    recorder = Recorder()
    recorder.authored("Combine authored material", inputs={"source": parent}, output=score["parts"])
    trace = recorder.finish(score, sources=[{"candidate_id": rhythm, "role": "rhythm"}])
    identity = session.import_candidate(tmp_path, score, parent, trace)
    history = resolve(session.load(tmp_path), [identity])
    current = history["nodes"][-1]
    assert current["origin"] == "supplied" and current["steps"][0]["evidence"] == "declared"
    assert [s["candidate_id"] for s in current["sources"]] == [parent, rhythm]
    imported = session.import_candidate(tmp_path, score)
    assert "gap" in resolve(session.load(tmp_path), [imported])["nodes"][-1]
    with session.transaction(tmp_path) as state:
        del state["candidates"][parent]["trace"]
    root = resolve(session.load(tmp_path), [identity])["nodes"][0]
    assert root["steps"] == [] and "gap" in root


@pytest.mark.parametrize("invalid", ["missing", "cycle", "result", "version"])
def test_invalid_creation_records_do_not_modify_session(tmp_path, invalid):
    parent = accepted(tmp_path)[0]
    score = session.load(tmp_path)["candidates"][parent]["score"]
    trace = Recorder().finish(score)
    if invalid == "missing":
        trace["sources"] = [{"candidate_id": "missing", "role": "pitch"}]
    elif invalid == "result":
        trace["result"]["tempo"] += 1
    elif invalid == "version":
        trace["version"] = 900
    else:
        trace["history"] = {
            "version": 1,
            "roots": ["a"],
            "nodes": [{"version": 1, "id": "a", "steps": [], "sources": [{"candidate_id": "a", "role": "pitch"}]}],
        }
    before = (tmp_path / "session.json").read_bytes()
    with pytest.raises(CompositionError):
        session.import_candidate(tmp_path, score, trace=trace)
    assert (tmp_path / "session.json").read_bytes() == before


def test_export_reimport_preserves_complete_history_and_repetitions(tmp_path, capsys):
    directory, output, destination = tmp_path / "source", tmp_path / "export", tmp_path / "destination"
    parent = accepted(directory)[0]
    child = session.generate(directory, parent_id=parent, operation="answer", seed=2, count=1)[0]
    session.review(directory, child, "keep", "Export this", [])
    assert main(["export", str(directory), "--ids", child, child, "--output", str(output)]) == 0
    capsys.readouterr()
    score = json.loads((output / "composition.json").read_text())
    history = score["provenance"]["creation_history"]
    assert len(history["nodes"]) == 2
    assert history["assembly"] == [
        {"candidate_id": child, "onset_qn": "0", "duration_qn": "8"},
        {"candidate_id": child, "onset_qn": "8", "duration_qn": "8"},
    ]
    session.create(destination, {}, 42)
    imported = session.import_candidate(destination, score)
    result = resolve(session.load(destination), [imported])
    assert len(result["nodes"]) == 3
    assert result["nodes"][1]["steps"] == history["nodes"][1]["steps"]
    assert result["nodes"][-1]["imported_assembly"][1]["onset_qn"] == "8"
    validate_history(result)
    assert main(["trace", str(destination), imported]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == result
    session.review(destination, imported, "keep", "Round trip", [])
    second_export = tmp_path / "second-export"
    assert main(["export", str(destination), "--ids", imported, "--output", str(second_export)]) == 0
    capsys.readouterr()
    third = tmp_path / "third"
    session.create(third, {}, 42)
    second_score = json.loads((second_export / "composition.json").read_text())
    identity = session.import_candidate(third, second_score)
    second_history = resolve(session.load(third), [identity])
    validate_history(second_history)
    assert len(second_history["nodes"]) == 4
    assert second_history["nodes"][-2]["imported_assembly"][1]["onset_qn"] == "8"
    second_score["parts"][0]["events"][0]["velocity"] -= 1
    changed = session.import_candidate(third, second_score)
    assert "differs" in resolve(session.load(third), [changed])["nodes"][-1]["gap"]


def test_cli_custom_trace_and_missing_reference_diagnostic(tmp_path, capsys):
    directory = tmp_path / "session"
    parent = accepted(directory)[0]
    score = session.load(directory)["candidates"][parent]["score"]
    score_path, trace_path = tmp_path / "score.json", tmp_path / "trace.json"
    score_path.write_text(json.dumps(score))
    trace_path.write_text(json.dumps(Recorder().finish(score)))
    assert main(["import-score", str(directory), str(score_path), "--from", parent, "--trace", str(trace_path)]) == 0
    capsys.readouterr()
    with session.transaction(directory) as state:
        state["candidates"][parent].pop("trace")
        state["candidates"][parent]["parents"] = ["lost-ancestor"]
    assert main(["trace", str(directory), parent]) == 1
    assert "Missing creation history candidate: lost-ancestor" in capsys.readouterr().err
