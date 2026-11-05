"""Strict, retry-safe declarative song schema, distinct from composition score v1/v2."""

from copy import deepcopy
from .song_model import fields, fail, fingerprint, identity, integer, lane_for, model, ticks
from .song_authoring import put_lane, put_definition, put_clip

SONG_KEYS = {"schema", "version", "id", "songMeter", "tempo", "end", "loop", "instruments", "lanes", "automation"}
LANE_KEYS = {"id", "source", "name", "channel", "timing", "settings", "automationTarget", "definitions", "clips"}


def apply_song(config, session, spec, *, mode="update", scope=None):
    fields(spec, SONG_KEYS, {"schema", "version", "id"}, "song")
    if spec["schema"] != "orchestron-song" or spec["version"] != 1:
        fail("Expected orchestron-song version 1; composition scores use apply-score or adapt-score.", "song.schema")
    identity(spec["id"], "song.id")
    if mode not in ("create", "update", "replace"):
        fail("Mode is create, update or replace.", "mode")
    if mode == "replace" and not scope:
        fail("Replacement requires an explicit list of managed lane IDs.", "scope")
    registry = session.setdefault("songDocuments", {})
    # Repeating create is safe only when the exact document was already accepted.
    if mode == "create" and spec["id"] in registry:
        prior = registry[spec["id"]]
        if prior.get("fingerprint", fingerprint(prior.get("document"))) != fingerprint(spec):
            fail("Document already exists; use update.", "song.id", "conflict")
        mode = "update"
    meter = spec.get("songMeter")
    if meter is not None and (
        not isinstance(meter, list) or len(meter) != 2 or any(type(v) is not int or v <= 0 for v in meter)
    ):
        fail("songMeter is [positive numerator, positive denominator].", "song.songMeter")
    if "tempo" in spec:
        tempo = integer(spec["tempo"], 30, 300, "song.tempo")
        config["sequencer"]["tempoBPM"] = tempo
        config["sequencer"]["timing"]["tempoBPM"] = tempo
        for key in ("tracks", "scoreTracks", "drummerTracks", "controllerSequencers"):
            for track in config["sequencer"].get(key, []):
                track["timing"]["tempoBPM"] = tempo
    seen = set()
    for i, instrument in enumerate(spec.get("instruments", [])):
        fields(
            instrument,
            {"id", "patchId", "channel", "values", "mappings"},
            {"id", "patchId", "channel"},
            f"song.instruments[{i}]",
        )
        identity(instrument["id"])
        if instrument["id"] in seen:
            fail("Duplicate instrument ID.", f"song.instruments[{i}].id")
        seen.add(instrument["id"])
        found = next((b for b in config["instruments"] if b["id"] == instrument["id"]), None)
        if mode == "create" and found:
            fail("Instrument ID already exists.", instrument["id"], "conflict")
        binding = found if found else {"id": instrument["id"]}
        binding.update(patchId=instrument["patchId"], midiChannel=integer(instrument["channel"], 0, 16))
        if "values" in instrument:
            binding["performanceControllerValues"] = deepcopy(instrument["values"])
        if "mappings" in instrument:
            for cc in instrument["mappings"].values():
                integer(cc, 1, 50)
            binding["performanceControllerMidiCCs"] = deepcopy(instrument["mappings"])
        if not found:
            config["instruments"].append(binding)
    seen_lanes, results, removed = set(), [], []
    for i, spec_lane in enumerate(spec.get("lanes", [])):
        fields(spec_lane, LANE_KEYS, {"id", "source"}, f"song.lanes[{i}]")
        if spec_lane["id"] in seen_lanes:
            fail("Duplicate lane ID.", f"song.lanes[{i}].id")
        seen_lanes.add(spec_lane["id"])
        if mode == "replace" and spec_lane["id"] not in scope:
            fail("Replacement document may only edit explicitly scoped lanes.", spec_lane["id"])
        existing = next((lane_item for lane_item in model(config)["lanes"] if lane_item["id"] == spec_lane["id"]), None)
        if mode == "create" and existing:
            fail("Lane ID already exists; use update.", spec_lane["id"], "conflict")
        put_lane(config, {k: v for k, v in spec_lane.items() if k not in ("definitions", "clips")})
        lane = lane_for(config, spec_lane["id"])
        ids = set()
        for definition in spec_lane.get("definitions", []):
            if definition.get("id") in ids:
                fail("Duplicate definition ID.", definition["id"])
            ids.add(definition.get("id"))
            results.append(put_definition(config, lane["id"], definition))
        clip_ids = set()
        for clip in spec_lane.get("clips", []):
            if clip.get("id") in clip_ids:
                fail("Duplicate clip ID.", clip["id"])
            clip_ids.add(clip.get("id"))
            results.append(put_clip(config, lane["id"], clip, meter))
        if mode == "replace":
            removed.extend(d["id"] for d in lane["definitions"] if d["id"] not in ids)
            removed.extend(c["id"] for c in lane["clips"] if c["id"] not in clip_ids)
            lane["definitions"] = [d for d in lane["definitions"] if d["id"] in ids]
            lane["clips"] = [c for c in lane["clips"] if c["id"] in clip_ids]
    if mode == "replace":
        # Omission is destructive only inside an explicitly supplied scope.
        for lane_id in scope:
            if lane_id not in seen_lanes:
                lane = lane_for(config, lane_id)
                from .clip_arrangement import KEYS

                removed.append(lane_id)
                model(config)["lanes"].remove(lane)
                config["sequencer"][KEYS[lane["source"]]] = [
                    t for t in config["sequencer"][KEYS[lane["source"]]] if t["id"] != lane_id
                ]
    if "automation" in spec:
        from .song_automation import generate

        for automation in spec["automation"]:
            results.append(generate(config, session.get("patchCatalog", []), automation))
    if "end" in spec:
        model(config)["end"] = ticks(spec["end"], meter=meter, path="song.end")
    if "loop" in spec:
        if type(spec["loop"]) is not bool:
            fail("Song loop must be a boolean.", "song.loop")
        config["sequencer"]["arrangerSongLoopEnabled"] = spec["loop"]
    registry[spec["id"]] = {"fingerprint": fingerprint(spec)}
    return {
        "documentId": spec["id"],
        "summary": f"Reconciled song '{spec['id']}' using shared definitions.",
        "objects": results[:20],
        "objectCount": len(results),
        "truncated": len(results) > 20,
        "removedIds": removed[:100],
        "removedCount": len(removed),
    }
