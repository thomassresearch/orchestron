"""Portable authored Sample Player normalization for the standalone CLI."""
from __future__ import annotations

import hashlib
import re

VERSION = 27
MAX_FILE_BYTES = 64 * 1024 * 1024


def _check_file(ref, extension):
    digest = ref.get("sha256")
    return (isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest)
            and ref.get("stored_name") == f"sam-{digest}.{extension}"
            and type(ref.get("size_bytes")) is int and ref["size_bytes"] > 0)


def canonicalize(config, *, enforce_version=True):
    instruments = config.get("instruments", [])
    if not isinstance(instruments, list):
        raise ValueError("Invalid rack assignments.")
    maps = [row for row in instruments if isinstance(row, dict) and "sampleMap" in row]
    if not maps and "sampleAssets" not in config:
        return False
    if enforce_version and config.get("version") not in (VERSION, 28):
        raise ValueError("Sample maps require performance version 27 or later.")
    assets = config.get("sampleAssets", {})
    if not isinstance(assets, dict) or len(assets) > 2048:
        raise ValueError("Invalid Sample Player manifest.")
    for identity, asset in assets.items():
        source = asset.get("source") if isinstance(asset, dict) else None
        playback = asset.get("playback") if isinstance(asset, dict) else None
        revision = asset.get("decoderRevision") if isinstance(asset, dict) else None
        if (not isinstance(source, dict) or not isinstance(playback, dict) or not isinstance(revision, str)
                or not 1 <= len(revision) <= 128 or source.get("format") not in ("wav", "mp3", "m4a")
                or not _check_file(source, source["format"]) or not _check_file(playback, "wav")
                or not isinstance(source.get("original_name"), str) or not 1 <= len(source["original_name"]) <= 255
                or any(char in source["original_name"] for char in "/\\\x00")
                or playback.get("format") != "wav-f32le" or type(playback.get("sampleRate")) is not int
                or playback["sampleRate"] != 48000
                or type(playback.get("channels")) is not int or playback["channels"] not in (1, 2)
                or type(playback.get("frameCount")) is not int or not 1 <= playback["frameCount"] <= 5760000):
            raise ValueError("Invalid Sample Player asset.")
        stable_id = hashlib.sha256(f"{source['sha256']}:{playback['sha256']}".encode()).hexdigest()
        if stable_id != identity:
            raise ValueError("Sample ID does not match its content.")
    used = set()
    for row in maps:
        mapping = row["sampleMap"]
        if (not isinstance(mapping, dict) or type(mapping.get("version")) is not int or mapping["version"] != 1
                or not isinstance(mapping.get("entries"), list) or len(mapping["entries"]) > 128):
            raise ValueError("Invalid Sample Player map.")
        notes = set()
        for entry in mapping["entries"]:
            note = entry.get("note") if isinstance(entry, dict) else None
            identity = entry.get("assetId") if isinstance(entry, dict) else None
            if type(note) is not int or not 0 <= note <= 127 or note in notes:
                raise ValueError("Sample maps require unique MIDI notes from 0 through 127.")
            if not isinstance(identity, str) or identity not in assets:
                raise ValueError("Sample map references a missing asset.")
            notes.add(note)
            used.add(identity)
        mapping["entries"].sort(key=lambda entry: entry["note"])
    if not maps:
        config.pop("sampleAssets", None)
        return False
    config["sampleAssets"] = {identity: assets[identity] for identity in sorted(used)}
    config["version"] = 28 if (config.get("sequencer", {}).get("clipArrangement") or {}).get("version") == 5 else VERSION
    return True


def wire_map(mapping):
    return {"version": 1, "entries": [{"note": entry["note"], "asset_id": entry["assetId"]}
                                       for entry in mapping["entries"]]}
