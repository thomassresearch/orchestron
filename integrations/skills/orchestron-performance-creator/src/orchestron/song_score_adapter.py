"""Explicit score v1/v2 handoff; keep the existing musical parser and voice choices."""

from copy import deepcopy
from .song_authoring import migrate, stable_id
from .song_model import KEYS, fail, fingerprint, identity, model


def adapt(config, session, spec, document_id):
    from .cli.orchestron_cli import apply_score_spec_to_config, empty_performance_config

    identity(document_id)
    registry = session.setdefault("scoreHandoffs", {})
    digest = fingerprint(spec)
    if document_id in registry:
        if registry[document_id] == digest:
            return {"summary": "This score handoff was already applied; no music duplicated.", "handoffId": document_id}
        fail(
            "Handoff identity already names a different score. Use a new identity or edit its returned lanes.",
            "id",
            "conflict",
        )
    if "arrangement" in spec:
        fail("Composition score arrangement extensions are unsupported; use the song schema.", "score.arrangement")
    temporary = empty_performance_config(tempo=config["sequencer"].get("tempoBPM", 120))
    tracks = apply_score_spec_to_config(temporary, spec)
    for track in tracks:
        track["padLoopEnabled"] = True
        if not track["padLoopPattern"]["rootSequence"]:
            track["padLoopPattern"]["rootSequence"] = [{"type": "pad", "padIndex": track.get("activePad", 0)}]
            track["padLoopRepeat"] = False
    migrate(temporary)
    mapping = {}

    def collect(value):
        if isinstance(value, dict):
            if isinstance(value.get("id"), str):
                mapping[value["id"]] = stable_id(document_id, value["id"])
            for v in value.values():
                collect(v)
        elif isinstance(value, list):
            for v in value:
                collect(v)

    collect(temporary["sequencer"])

    def remap(value, key=None):
        if isinstance(value, dict):
            return {k: remap(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v, key) for v in value]
        return (
            mapping.get(value, value)
            if isinstance(value, str) and key in ("id", "definitionId", "rowId", "syncToTrackId")
            else value
        )

    temporary = remap(temporary)
    for key in KEYS.values():
        config["sequencer"][key].extend(deepcopy(temporary["sequencer"].get(key, [])))
    model(config)["lanes"].extend(model(temporary)["lanes"])
    model(config)["end"] = max(model(config)["end"], model(temporary)["end"])
    registry[document_id] = digest
    return {
        "summary": "Adapted accepted voices and timing using the existing score parser.",
        "handoffId": document_id,
        "lanes": [{"laneId": lane["id"], "source": lane["source"]} for lane in model(temporary)["lanes"]],
    }
