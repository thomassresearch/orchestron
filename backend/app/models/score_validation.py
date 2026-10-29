"""Score-specific persisted bounds; older documents without scores are unchanged."""
from backend.app.models.session import SessionScoreNoteConfig, SessionScorePadConfig


def validate_authored_scores(document):
    sequencer = document.get("sequencer", {}) if isinstance(document, dict) else {}
    tracks = sequencer.get("scoreTracks", []) if isinstance(sequencer, dict) else []
    if not isinstance(tracks, list) or len(tracks) > 16:
        raise ValueError("A performance supports at most 16 Score Sequencers.")
    total = 0
    track_ids = set()
    for track in tracks:
        if not isinstance(track, dict):
            raise ValueError("A score track must be an object.")
        identity = track.get("id")
        if not isinstance(identity, str) or not identity or identity in track_ids:
            raise ValueError("Score track IDs must be unique nonempty strings.")
        track_ids.add(identity)
        pads = track.get("pads", [])
        if not isinstance(pads, list) or len(pads) > 8:
            raise ValueError("A score track supports eight pads.")
        for index, pad in enumerate(pads):
            if not isinstance(pad, dict):
                raise ValueError("A score pad must be an object.")
            notes = pad.get("notes", [])
            if not isinstance(notes, list) or len(notes) > 10000:
                raise ValueError("A score pad supports at most 10000 notes.")
            parsed = []
            for note in notes:
                if not isinstance(note, dict):
                    raise ValueError("A score note must be an object.")
                parsed.append(SessionScoreNoteConfig.model_validate({
                    "id": note.get("id"), "pitch": note.get("pitch"), "velocity": note.get("velocity", 100),
                    "start_ticks": note.get("startTicks"), "duration_ticks": note.get("durationTicks")}))
            SessionScorePadConfig(pad_index=index, length_beats=pad.get("lengthBeats", track.get("lengthBeats", 16)), notes=parsed)
            total += len(notes)
            if total > 50000:
                raise ValueError("A performance supports at most 50000 score notes.")
    return document
