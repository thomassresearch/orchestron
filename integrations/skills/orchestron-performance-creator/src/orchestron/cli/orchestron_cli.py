#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib import error, parse, request


DEFAULT_API_URL = os.environ.get("ORCHESTRON_API_URL", "http://localhost:8000/api")
SESSION_DIR = Path(".orchestron")
SESSION_FILE = SESSION_DIR / "edit-session.json"
CURRENT_CONFIG_VERSION = 8
DEFAULT_PAD_COUNT = 8
MAX_STEPS_PER_PAD = 128

SCALE_ROOTS = {
    "C": (0, False),
    "C#": (1, False),
    "Db": (1, True),
    "D": (2, False),
    "D#": (3, False),
    "Eb": (3, True),
    "E": (4, False),
    "F": (5, True),
    "F#": (6, False),
    "Gb": (6, True),
    "G": (7, False),
    "G#": (8, False),
    "Ab": (8, True),
    "A": (9, False),
    "A#": (10, False),
    "Bb": (10, True),
    "B": (11, False),
    "Cb": (11, True),
}
SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
MODE_INTERVALS = {
    "ionian": [0, 2, 4, 5, 7, 9, 11],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "aeolian": [0, 2, 3, 5, 7, 8, 10],
    "locrian": [0, 1, 3, 5, 6, 8, 10],
}
SCALE_TYPES = {"major", "neutral", "minor"}
CHORD_INTERVALS = {
    "none": [0],
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "dim": [0, 3, 6],
    "aug": [0, 4, 8],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "maj7": [0, 4, 7, 11],
    "min7": [0, 3, 7, 10],
    "dom7": [0, 4, 7, 10],
    "m7b5": [0, 3, 6, 10],
    "dim7": [0, 3, 6, 9],
    "minmaj7": [0, 3, 7, 11],
}
CHORD_ALIASES = {
    "": "none",
    "none": "none",
    "maj": "maj",
    "major": "maj",
    "M": "maj",
    "min": "min",
    "minor": "min",
    "m": "min",
    "dim": "dim",
    "aug": "aug",
    "+": "aug",
    "sus2": "sus2",
    "sus4": "sus4",
    "maj7": "maj7",
    "major7": "maj7",
    "M7": "maj7",
    "min7": "min7",
    "minor7": "min7",
    "m7": "min7",
    "7": "dom7",
    "dom7": "dom7",
    "m7b5": "m7b5",
    "half-dim7": "m7b5",
    "dim7": "dim7",
    "minmaj7": "minmaj7",
    "mmaj7": "minmaj7",
}
ARPEGGIATOR_PATTERNS = {
    "up",
    "down",
    "up_down",
    "down_up",
    "as_played",
    "random",
    "chord",
    "inside_out",
    "outside_in",
}
ARPEGGIATOR_RATES = {"1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/8T", "1/16T", "1/8D", "1/16D"}
GM_DRUMS = {
    "kick": 36,
    "snare": 38,
    "clap": 39,
    "closed_hat": 42,
    "open_hat": 46,
    "low_tom": 45,
    "mid_tom": 47,
    "high_tom": 50,
    "ride": 51,
    "crash": 49,
}


class OrchestronCliError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retry: list[str] | None = None,
        path: str | None = None,
        data: dict[str, Any] | None = None,
        backend: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry = retry or []
        self.path = path
        self.data = data or {}
        self.backend = backend

    def to_json(self, *, debug: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
            },
        }
        if self.path:
            payload["error"]["path"] = self.path
        if self.retry:
            payload["error"]["retry"] = self.retry
        if self.data:
            payload["error"].update(self.data)
        if debug and self.backend:
            payload["error"]["backend"] = self.backend
        return payload


@dataclass
class CliContext:
    api_url: str
    json_output: bool
    debug: bool
    timeout: float
    session_file: Path


class ApiClient:
    def __init__(self, api_url: str, *, timeout: float = 20.0) -> None:
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, payload: Any | None = None) -> Any:
        return self._request("POST", path, payload)

    def put(self, path: str, payload: Any | None = None) -> Any:
        return self._request("PUT", path, payload)

    def delete(self, path: str) -> Any:
        return self._request("DELETE", path)

    def upload_bundle(self, path: Path) -> Any:
        url = self._url("/bundles/import/expand")
        body = path.read_bytes()
        req = request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/octet-stream",
                "X-File-Name": path.name,
            },
        )
        return self._open(req, operation=f"upload bundle {path}")

    def _request(self, method: str, path: str, payload: Any | None = None) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = request.Request(self._url(path), data=data, method=method, headers=headers)
        return self._open(req, operation=f"{method} {path}")

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return self.api_url + path

    def _open(self, req: request.Request, *, operation: str) -> Any:
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read()
                if not raw:
                    return None
                text = raw.decode("utf-8")
                return json.loads(text)
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            retry = [
                f"Verify the backend is the expected Orchestron API: {self.api_url}.",
                "Run the same command with --debug to include the raw backend response.",
            ]
            if exc.code == 404:
                retry.append("Check the performance, patch, or session ID and retry.")
            if exc.code == 409:
                retry.append("Refresh the edit session or retry after stopping conflicting live activity.")
            if exc.code == 422:
                retry.append("Fix the validation error shown by the backend and retry.")
            raise OrchestronCliError(
                "backend_http_error",
                f"Backend rejected {operation}: HTTP {exc.code} {exc.reason}: {body}",
                retry=retry,
                backend={"status": exc.code, "reason": exc.reason, "body": body},
            ) from exc
        except error.URLError as exc:
            raise OrchestronCliError(
                "backend_unreachable",
                f"Could not reach Orchestron backend at {self.api_url}: {exc.reason}",
                retry=[
                    "Start the backend with `make run`.",
                    "Pass --api-url http://HOST:PORT/api if the backend is not on localhost:8000.",
                    "Run `orchestron_cli health` to check connectivity.",
                ],
            ) from exc
        except json.JSONDecodeError as exc:
            raise OrchestronCliError(
                "invalid_backend_json",
                f"Backend response for {operation} was not valid JSON.",
                retry=["Run with --debug and inspect the backend response."],
            ) from exc


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_name_key(value: str) -> str:
    return value.strip().lower()


def clamp_int(value: Any, low: int, high: int, *, field: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise OrchestronCliError("invalid_number", f"{field} must be an integer.", path=field) from exc
    return max(low, min(high, parsed))


def print_payload(payload: Any, ctx: CliContext) -> None:
    if ctx.json_output:
        print(json.dumps({"ok": True, "result": payload}, ensure_ascii=True, indent=2))
        return
    if isinstance(payload, str):
        print(payload)
        return
    print(json.dumps(payload, ensure_ascii=True, indent=2))


def print_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]], ctx: CliContext) -> None:
    if ctx.json_output:
        print_payload(rows, ctx)
        return
    if not rows:
        print("(none)")
        return
    widths = []
    for key, label in columns:
        widths.append(max(len(label), *(len(str(row.get(key, ""))) for row in rows)))
    header = "  ".join(label.ljust(width) for (_, label), width in zip(columns, widths, strict=True))
    print(header)
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(str(row.get(key, "")).ljust(width) for (key, _), width in zip(columns, widths, strict=True)))


def load_edit_session(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise OrchestronCliError(
            "edit_session_missing",
            f"No active edit session found at {path}.",
            retry=[
                "Run `orchestron_cli edit begin --performance PERFORMANCE_ID`.",
                "Run `orchestron_cli edit begin --new --name NAME`.",
                "Pass --session-file PATH if the edit session was stored elsewhere.",
            ],
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OrchestronCliError(
            "edit_session_invalid",
            f"Edit session file {path} is not valid JSON.",
            retry=["Delete the stale session file or run `orchestron_cli edit abort` if it can be parsed."],
        ) from exc


def save_edit_session(path: Path, session: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def default_timing(tempo: int = 120) -> dict[str, int]:
    return {
        "tempoBPM": tempo,
        "meterNumerator": 4,
        "meterDenominator": 4,
        "stepsPerBeat": 4,
        "beatRateNumerator": 1,
        "beatRateDenominator": 1,
    }


def default_step() -> dict[str, Any]:
    return {"note": None, "chord": "none", "hold": False, "velocity": 127}


def empty_pad_loop_pattern() -> dict[str, Any]:
    return {"rootSequence": [], "groups": [], "superGroups": []}


def resolved_pad_steps(length_beats: int, timing: dict[str, Any]) -> int:
    return max(1, min(MAX_STEPS_PER_PAD, int(length_beats) * int(timing.get("stepsPerBeat", 4))))


def default_melodic_pad(
    *,
    length_beats: int,
    timing: dict[str, Any],
    scale_root: str,
    scale_type: str,
    mode: str,
) -> dict[str, Any]:
    return {
        "lengthBeats": length_beats,
        "stepCount": resolved_pad_steps(length_beats, timing),
        "steps": [default_step() for _ in range(MAX_STEPS_PER_PAD)],
        "scaleRoot": scale_root,
        "scaleType": scale_type,
        "mode": mode,
    }


def default_drummer_pad(rows: list[dict[str, Any]], *, length_beats: int, timing: dict[str, Any]) -> dict[str, Any]:
    return {
        "lengthBeats": length_beats,
        "stepCount": resolved_pad_steps(length_beats, timing),
        "rows": [
            {
                "rowId": row["id"],
                "steps": [empty_drum_cell() for _ in range(MAX_STEPS_PER_PAD)],
            }
            for row in rows
        ],
    }


def default_controller_pad(*, length_beats: int, timing: dict[str, Any]) -> dict[str, Any]:
    step_count = max(1, min(MAX_STEPS_PER_PAD, length_beats * int(timing.get("stepsPerBeat", 4))))
    return {
        "lengthBeats": length_beats,
        "stepCount": step_count,
        "keypoints": parse_curve("flat"),
    }


def summarize_device(device: dict[str, Any]) -> dict[str, Any]:
    summary = {
        "id": device.get("id"),
        "name": device.get("name"),
    }
    for key in ("midiChannel", "controllerNumber", "inputChannel", "targetChannel", "lengthBeats", "stepCount", "enabled"):
        if key in device:
            summary[key] = device[key]
    return summary


def empty_performance_config(*, tempo: int = 120) -> dict[str, Any]:
    timing = default_timing(tempo)
    return {
        "version": CURRENT_CONFIG_VERSION,
        "instruments": [],
        "sequencer": {
            "timing": timing,
            "tempoBPM": tempo,
            "meterNumerator": timing["meterNumerator"],
            "meterDenominator": timing["meterDenominator"],
            "stepsPerBeat": timing["stepsPerBeat"],
            "stepCount": 8,
            "arrangerLoopSelection": None,
            "tracks": [],
            "drummerTracks": [],
            "pianoRolls": [],
            "midiControllers": [],
            "controllerSequencers": [],
            "arpeggiators": [],
            "arpeggiatorPresets": [],
        },
    }


def ensure_sequencer(config: dict[str, Any]) -> dict[str, Any]:
    sequencer = config.setdefault("sequencer", {})
    timing = sequencer.setdefault("timing", default_timing())
    sequencer.setdefault("tempoBPM", timing.get("tempoBPM", 120))
    sequencer.setdefault("meterNumerator", timing.get("meterNumerator", 4))
    sequencer.setdefault("meterDenominator", timing.get("meterDenominator", 4))
    sequencer.setdefault("stepsPerBeat", timing.get("stepsPerBeat", 4))
    sequencer.setdefault("stepCount", 8)
    sequencer.setdefault("tracks", [])
    sequencer.setdefault("drummerTracks", [])
    sequencer.setdefault("pianoRolls", [])
    sequencer.setdefault("midiControllers", [])
    sequencer.setdefault("controllerSequencers", [])
    sequencer.setdefault("arpeggiators", [])
    sequencer.setdefault("arpeggiatorPresets", [])
    return sequencer


def find_by_id_or_name(items: list[dict[str, Any]], value: str, *, kind: str) -> dict[str, Any]:
    exact_id = [item for item in items if item.get("id") == value]
    if exact_id:
        return exact_id[0]
    key = normalize_name_key(value)
    matches = [item for item in items if normalize_name_key(str(item.get("name", ""))) == key]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise OrchestronCliError(
            f"{kind}_not_found",
            f"No {kind} found for '{value}'.",
            retry=[f"Run `orchestron_cli {kind}s list` and retry with an exact ID or name."],
            data={"lookup": value},
        )
    raise OrchestronCliError(
        f"{kind}_ambiguous",
        f"Multiple {kind}s match '{value}'.",
        retry=[f"Retry with one of these exact IDs: {', '.join(str(item.get('id')) for item in matches)}."],
        data={"matches": matches},
    )


def suggest_unique_name(base_name: str, taken: set[str]) -> str:
    seed = base_name.strip() or "Imported"
    candidate = f"{seed} Copy"
    index = 2
    while normalize_name_key(candidate) in taken:
        candidate = f"{seed} Copy {index}"
        index += 1
    return candidate


def is_patch_definition(raw: Any) -> bool:
    return isinstance(raw, dict) and isinstance(raw.get("sourcePatchId"), str) and isinstance(raw.get("graph"), dict)


def is_performance_export(raw: Any) -> bool:
    return isinstance(raw, dict) and raw.get("format") == "orchestron.performance" and isinstance(raw.get("performance"), dict)


def exported_patch_name(definition: dict[str, Any]) -> str:
    return str(definition.get("name") or "Imported Patch").strip() or "Imported Patch"


def exported_performance_name(exported: dict[str, Any]) -> str:
    perf = exported.get("performance") if isinstance(exported.get("performance"), dict) else {}
    return str(perf.get("name") or "Imported Performance").strip() or "Imported Performance"


def extract_patch_definitions(raw: Any) -> list[dict[str, Any]]:
    if is_patch_definition(raw):
        return [raw]
    if is_performance_export(raw):
        defs = raw.get("patch_definitions", [])
        return [entry for entry in defs if is_patch_definition(entry)] if isinstance(defs, list) else []
    return []


def conflict_action(
    *,
    kind: str,
    name: str,
    existing: dict[str, Any] | None,
    on_conflict: str,
    taken: set[str],
) -> tuple[str, str | None]:
    if existing is None:
        return "create", name
    if on_conflict == "fail":
        raise OrchestronCliError(
            f"{kind}_conflict",
            f"{kind.title()} '{name}' already exists.",
            retry=[
                f"Retry with --on-conflict overwrite to replace the existing {kind}.",
                f"Retry with --on-conflict skip to keep the existing {kind}.",
                f"Retry with --on-conflict rename to import as a copy.",
            ],
            data={"existing": existing},
        )
    if on_conflict == "overwrite":
        return "update", name
    if on_conflict == "skip":
        return "skip", None
    if on_conflict == "rename":
        return "create", suggest_unique_name(name, taken)
    if on_conflict == "prompt":
        if not sys.stdin.isatty():
            raise OrchestronCliError(
                f"{kind}_conflict_noninteractive",
                f"{kind.title()} '{name}' already exists and prompting is unavailable.",
                retry=[
                    "Retry with --on-conflict overwrite, skip, rename, or fail.",
                    "Use --json for machine-readable conflict details.",
                ],
                data={"existing": existing},
            )
        while True:
            answer = input(f"{kind.title()} '{name}' exists. [o]verwrite, [s]kip, [r]ename? ").strip().lower()
            if answer in {"o", "overwrite"}:
                return "update", name
            if answer in {"s", "skip"}:
                return "skip", None
            if answer in {"r", "rename"}:
                suggested = suggest_unique_name(name, taken)
                renamed = input(f"New name [{suggested}]: ").strip() or suggested
                return "create", renamed
    raise OrchestronCliError("invalid_conflict_mode", f"Unsupported conflict mode: {on_conflict}")


NOTE_RE = re.compile(r"^([A-Ga-g])([#b]?)(-?\d+)$")
NOTE_WITH_SUFFIX_RE = re.compile(r"^([A-Ga-g][#b]?-?\d+)(.*)$")
EXPLICIT_STEP_RE = re.compile(r"^s(\d+)=(.+?)(?:/(\d+)s)?$")
ROMAN_RE = re.compile(r"^([b#]*)([ivIV]+)(.*)$")


def note_name_to_midi(value: str) -> int:
    match = NOTE_RE.match(value.strip())
    if not match:
        raise OrchestronCliError(
            "invalid_note",
            f"Invalid MIDI note name '{value}'.",
            retry=["Use note names with octave, for example C3, Eb4, F#2."],
        )
    letter, accidental, octave_text = match.groups()
    name = letter.upper() + accidental
    if name not in SCALE_ROOTS:
        raise OrchestronCliError("invalid_note", f"Invalid note name '{value}'.")
    octave = int(octave_text)
    midi = (octave + 1) * 12 + SCALE_ROOTS[name][0]
    if midi < 0 or midi > 127:
        raise OrchestronCliError(
            "note_out_of_range",
            f"Note '{value}' resolves to MIDI {midi}, outside 0..127.",
            retry=["Choose an octave that keeps the note inside MIDI 0..127."],
        )
    return midi


def midi_to_note_name(midi: int, *, prefer_flats: bool = False, octave: int | None = None) -> str:
    midi = max(0, min(127, int(midi)))
    names = FLAT_NAMES if prefer_flats else SHARP_NAMES
    resolved_octave = midi // 12 - 1 if octave is None else octave
    return f"{names[midi % 12]}{resolved_octave}"


def normalize_chord_label(value: str) -> str:
    if value in CHORD_INTERVALS:
        return value
    if value in CHORD_ALIASES:
        return CHORD_ALIASES[value]
    lowered = value.strip().lower()
    if lowered in CHORD_ALIASES:
        return CHORD_ALIASES[lowered]
    raise OrchestronCliError(
        "unsupported_chord",
        f"Unsupported chord label '{value}'.",
        retry=[
            "Use one of: " + ", ".join(CHORD_INTERVALS.keys()) + ".",
            "Use aliases such as m7, min7, maj7, or 7 for dom7.",
        ],
    )


def parse_note_chord(token: str) -> tuple[int, str]:
    token = token.strip()
    if ":" in token:
        note_text, chord_text = token.split(":", 1)
        return note_name_to_midi(note_text), normalize_chord_label(chord_text)
    match = NOTE_WITH_SUFFIX_RE.match(token)
    if not match:
        raise OrchestronCliError(
            "invalid_note_chord",
            f"Invalid note/chord token '{token}'.",
            retry=["Use C3, C3:min7, C3m7, F#2:dom7, or Bb4:maj7."],
        )
    note_text, suffix = match.groups()
    return note_name_to_midi(note_text), normalize_chord_label(suffix)


def apply_event_to_steps(
    steps: list[dict[str, Any]],
    *,
    at_step: int,
    note: int,
    chord: str,
    duration_steps: int,
    velocity: int,
) -> None:
    if at_step < 0 or at_step >= len(steps):
        raise OrchestronCliError(
            "step_out_of_range",
            f"Step {at_step} is outside the editable pad capacity 0..{len(steps) - 1}.",
            path=f"steps[{at_step}]",
        )
    steps[at_step] = {"note": note, "chord": chord, "hold": False, "velocity": velocity}
    for step_index in range(at_step + 1, min(len(steps), at_step + max(1, duration_steps))):
        steps[step_index] = {"note": None, "chord": "none", "hold": True, "velocity": velocity}


def apply_explicit_steps(steps: list[dict[str, Any]], pattern: str, *, velocity: int) -> None:
    if not pattern.strip():
        return
    for raw_token in pattern.split():
        match = EXPLICIT_STEP_RE.match(raw_token)
        if not match:
            raise OrchestronCliError(
                "invalid_step_token",
                f"Invalid explicit step token '{raw_token}'.",
                retry=["Use tokens like s0=C3:min7/4s, s4=F3:dom7, or s8=Bb2:maj7/2s."],
            )
        at_step = int(match.group(1))
        note, chord = parse_note_chord(match.group(2))
        duration = int(match.group(3) or "1")
        apply_event_to_steps(steps, at_step=at_step, note=note, chord=chord, duration_steps=duration, velocity=velocity)


def apply_grid_pattern(steps: list[dict[str, Any]], pattern: str, *, velocity: int) -> None:
    if not pattern.strip():
        return
    for index, token in enumerate(pattern.split()):
        if index >= len(steps):
            raise OrchestronCliError(
                "grid_pattern_too_long",
                f"Grid pattern has more than {len(steps)} steps.",
                retry=["Use --length-beats or --steps-per-beat to increase the active pad length, or shorten the pattern."],
            )
        if token == ".":
            steps[index] = default_step()
            continue
        if token == "_":
            steps[index] = {"note": None, "chord": "none", "hold": True, "velocity": velocity}
            continue
        note, chord = parse_note_chord(token)
        steps[index] = {"note": note, "chord": chord, "hold": False, "velocity": velocity}


def chord_notes(note: int | None, chord: str) -> int | list[int] | None:
    if note is None:
        return None
    intervals = CHORD_INTERVALS.get(chord, CHORD_INTERVALS["none"])
    notes = sorted({max(0, min(127, int(note) + interval)) for interval in intervals})
    if not notes:
        return None
    if len(notes) == 1:
        return notes[0]
    return notes


def next_track_id(existing: list[dict[str, Any]], prefix: str) -> str:
    used = {str(item.get("id")) for item in existing}
    index = len(existing) + 1
    candidate = f"{prefix}-{index}"
    while candidate in used:
        index += 1
        candidate = f"{prefix}-{index}"
    return candidate


def add_melodic_track_to_config(
    config: dict[str, Any],
    *,
    channel: int,
    name: str | None,
    length_beats: int,
    scale_root: str,
    scale_type: str,
    mode: str,
    enabled: bool,
    steps_pattern: str | None,
    grid_pattern: str | None,
    velocity: int,
) -> dict[str, Any]:
    if scale_root not in SCALE_ROOTS:
        raise OrchestronCliError("invalid_scale_root", f"Unsupported scale root '{scale_root}'.")
    if scale_type not in SCALE_TYPES:
        raise OrchestronCliError("invalid_scale_type", f"Unsupported scale type '{scale_type}'.")
    if mode not in MODE_INTERVALS:
        raise OrchestronCliError("invalid_mode", f"Unsupported mode '{mode}'.")
    sequencer = ensure_sequencer(config)
    timing = sequencer.get("timing") or default_timing()
    tracks = sequencer.setdefault("tracks", [])
    track_id = next_track_id(tracks, "voice")
    pad = default_melodic_pad(
        length_beats=length_beats,
        timing=timing,
        scale_root=scale_root,
        scale_type=scale_type,
        mode=mode,
    )
    if steps_pattern:
        apply_explicit_steps(pad["steps"], steps_pattern, velocity=velocity)
    if grid_pattern:
        apply_grid_pattern(pad["steps"], grid_pattern, velocity=velocity)
    pads = [
        default_melodic_pad(
            length_beats=length_beats,
            timing=timing,
            scale_root=scale_root,
            scale_type=scale_type,
            mode=mode,
        )
        for _ in range(DEFAULT_PAD_COUNT)
    ]
    pads[0] = pad
    track = {
        "id": track_id,
        "name": name or f"Melodic Sequencer {len(tracks) + 1}",
        "midiChannel": channel,
        "timing": timing,
        "lengthBeats": length_beats,
        "stepCount": pad["stepCount"],
        "syncToTrackId": None,
        "scaleRoot": scale_root,
        "scaleType": scale_type,
        "mode": mode,
        "activePad": 0,
        "queuedPad": None,
        "padLoopEnabled": False,
        "padLoopRepeat": True,
        "padLoopSequence": [],
        "padLoopPattern": empty_pad_loop_pattern(),
        "pads": pads,
        "enabled": enabled,
        "queuedEnabled": None,
    }
    tracks.append(track)
    return track


def default_drum_rows() -> list[dict[str, Any]]:
    names = ["kick", "snare", "closed_hat", "open_hat", "clap", "low_tom", "ride", "crash"]
    return [{"id": f"drum-row-{index + 1}", "key": GM_DRUMS[name]} for index, name in enumerate(names)]


def empty_drum_cell() -> dict[str, Any]:
    return {"active": False, "velocity": 100}


def drum_groove_hits(groove: str, step_count: int) -> dict[str, list[tuple[int, int]]]:
    if groove == "four_on_floor":
        return {
            "kick": [(0, 115), (4, 108), (8, 112), (12, 108)],
            "closed_hat": [(i, 78 if i % 4 else 92) for i in range(0, step_count, 2)],
        }
    if groove == "half_time":
        return {
            "kick": [(0, 116), (6, 96), (10, 94)],
            "snare": [(8, 118)],
            "closed_hat": [(i, 76 if i % 4 else 90) for i in range(0, step_count, 2)],
        }
    if groove == "breakbeat":
        return {
            "kick": [(0, 118), (3, 88), (10, 104)],
            "snare": [(4, 116), (12, 120)],
            "closed_hat": [(i, 72 if i % 4 else 88) for i in range(0, step_count, 2)],
            "open_hat": [(14, 78)],
        }
    if groove == "electro":
        return {
            "kick": [(0, 116), (7, 98), (10, 106)],
            "snare": [(4, 112), (12, 116)],
            "clap": [(4, 86), (12, 92)],
            "closed_hat": [(i, 70 if i % 4 else 86) for i in range(0, step_count, 2)],
        }
    if groove == "sparse":
        return {
            "kick": [(0, 112), (9, 92)],
            "snare": [(8, 104)],
            "closed_hat": [(2, 64), (6, 68), (10, 64), (14, 72)],
        }
    if groove == "backbeat":
        return {
            "kick": [(0, 116), (8, 104)],
            "snare": [(4, 112), (12, 116)],
            "closed_hat": [(i, 76 if i % 4 else 92) for i in range(0, step_count, 2)],
        }
    raise OrchestronCliError(
        "unsupported_drum_groove",
        f"Unsupported drum groove '{groove}'.",
        retry=["Use one of: backbeat, four_on_floor, half_time, breakbeat, electro, sparse."],
    )


def add_drummer_track_to_config(
    config: dict[str, Any],
    *,
    channel: int,
    name: str | None,
    length_beats: int,
    groove: str,
    enabled: bool,
) -> dict[str, Any]:
    sequencer = ensure_sequencer(config)
    timing = sequencer.get("timing") or default_timing()
    tracks = sequencer.setdefault("drummerTracks", [])
    rows = default_drum_rows()
    step_count = resolved_pad_steps(length_beats, timing)
    row_steps = {
        row["id"]: [empty_drum_cell() for _ in range(MAX_STEPS_PER_PAD)]
        for row in rows
    }
    name_by_key = {key: name for name, key in GM_DRUMS.items()}
    row_id_by_name = {name_by_key[row["key"]]: row["id"] for row in rows if row["key"] in name_by_key}
    for drum_name, hits in drum_groove_hits(groove, step_count).items():
        row_id = row_id_by_name.get(drum_name)
        if row_id is None:
            continue
        for step_index, velocity in hits:
            if 0 <= step_index < MAX_STEPS_PER_PAD:
                row_steps[row_id][step_index] = {"active": True, "velocity": velocity}
    pad = {
        "lengthBeats": length_beats,
        "stepCount": step_count,
        "rows": [{"rowId": row["id"], "steps": row_steps[row["id"]]} for row in rows],
    }
    pads = [default_drummer_pad(rows, length_beats=length_beats, timing=timing) for _ in range(DEFAULT_PAD_COUNT)]
    pads[0] = pad
    track = {
        "id": next_track_id(tracks, "drum"),
        "name": name or f"Drummer Sequencer {len(tracks) + 1}",
        "midiChannel": channel,
        "timing": timing,
        "lengthBeats": length_beats,
        "stepCount": step_count,
        "activePad": 0,
        "queuedPad": None,
        "padLoopEnabled": False,
        "padLoopRepeat": True,
        "padLoopSequence": [],
        "padLoopPattern": empty_pad_loop_pattern(),
        "rows": rows,
        "pads": pads,
        "enabled": enabled,
        "queuedEnabled": None,
    }
    tracks.append(track)
    return track


def parse_curve(value: str) -> list[dict[str, Any]]:
    presets = {
        "flat": [(0.0, 64), (1.0, 64)],
        "ramp_up": [(0.0, 0), (1.0, 127)],
        "ramp_down": [(0.0, 127), (1.0, 0)],
        "triangle": [(0.0, 0), (0.5, 127), (1.0, 0)],
        "pulse": [(0.0, 0), (0.49, 0), (0.5, 127), (1.0, 127)],
        "slow_sweep": [(0.0, 24), (0.5, 96), (1.0, 48)],
        "adsr": [(0.0, 0), (0.15, 127), (0.45, 84), (0.85, 84), (1.0, 0)],
    }
    points = presets.get(value)
    if points is None:
        points = []
        for token in value.split(","):
            if ":" not in token:
                raise OrchestronCliError(
                    "invalid_curve",
                    f"Invalid curve token '{token}'.",
                    retry=["Use a preset like slow_sweep or comma-separated position:value pairs such as 0:24,0.5:96,1:48."],
                )
            pos_text, val_text = token.split(":", 1)
            try:
                pos = float(pos_text)
                val = int(val_text)
            except ValueError as exc:
                raise OrchestronCliError("invalid_curve", f"Invalid curve token '{token}'.") from exc
            points.append((pos, val))
    result = []
    for index, (position, cc_value) in enumerate(points):
        result.append(
            {
                "id": f"kp-{index + 1}",
                "position": max(0.0, min(1.0, float(position))),
                "value": max(0, min(127, int(cc_value))),
            }
        )
    return sorted(result, key=lambda item: item["position"])


def add_controller_sequencer_to_config(
    config: dict[str, Any],
    *,
    controller_number: int,
    name: str | None,
    length_beats: int,
    curve: str,
    enabled: bool,
) -> dict[str, Any]:
    sequencer = ensure_sequencer(config)
    timing = sequencer.get("timing") or default_timing()
    tracks = sequencer.setdefault("controllerSequencers", [])
    step_count = max(1, min(MAX_STEPS_PER_PAD, length_beats * int(timing.get("stepsPerBeat", 4))))
    keypoints = parse_curve(curve)
    pad = {"lengthBeats": length_beats, "stepCount": step_count, "keypoints": keypoints}
    pads = [default_controller_pad(length_beats=length_beats, timing=timing) for _ in range(DEFAULT_PAD_COUNT)]
    pads[0] = pad
    track = {
        "id": next_track_id(tracks, "cc-seq"),
        "name": name or f"Controller Sequencer {len(tracks) + 1}",
        "controllerNumber": controller_number,
        "timing": timing,
        "lengthBeats": length_beats,
        "stepCount": step_count,
        "activePad": 0,
        "queuedPad": None,
        "padLoopEnabled": False,
        "padLoopRepeat": True,
        "padLoopSequence": [],
        "padLoopPattern": empty_pad_loop_pattern(),
        "enabled": enabled,
        "pads": pads,
        "keypoints": keypoints,
    }
    tracks.append(track)
    return track


def add_midi_controller_to_config(
    config: dict[str, Any],
    *,
    controller_number: int,
    name: str | None,
    value: int,
    enabled: bool,
) -> dict[str, Any]:
    sequencer = ensure_sequencer(config)
    controllers = sequencer.setdefault("midiControllers", [])
    controller = {
        "id": next_track_id(controllers, "cc"),
        "name": name or f"Controller {len(controllers) + 1}",
        "controllerNumber": controller_number,
        "value": value,
        "enabled": enabled,
    }
    controllers.append(controller)
    return controller


def add_arpeggiator_to_config(
    config: dict[str, Any],
    *,
    input_channel: int,
    target_channel: int,
    name: str | None,
    pattern: str,
    rate: str,
    octaves: int,
    enabled: bool,
) -> dict[str, Any]:
    if pattern not in ARPEGGIATOR_PATTERNS:
        raise OrchestronCliError("invalid_arpeggiator_pattern", f"Unsupported arpeggiator pattern '{pattern}'.")
    if rate not in ARPEGGIATOR_RATES:
        raise OrchestronCliError("invalid_arpeggiator_rate", f"Unsupported arpeggiator rate '{rate}'.")
    sequencer = ensure_sequencer(config)
    arps = sequencer.setdefault("arpeggiators", [])
    arp = {
        "id": next_track_id(arps, "arp"),
        "name": name or f"Arpeggiator {len(arps) + 1}",
        "enabled": enabled,
        "inputChannel": input_channel,
        "targetChannel": target_channel,
        "presetId": None,
        "rate": rate,
        "gateRatio": 0.72,
        "swing": 0.0,
        "octaves": octaves,
        "pattern": pattern,
        "latch": False,
        "velocityMode": "input",
        "fixedVelocity": 100,
        "accentCycle": [],
        "probability": 1.0,
        "repeats": 1,
        "humanizeMs": 0.0,
        "humanizeVelocity": 0,
        "transpose": 0,
        "scaleQuantize": False,
        "scaleRoot": "C",
        "scaleType": "minor",
        "mode": "aeolian",
        "restartMode": "first_note",
    }
    arps.append(arp)
    return arp


def key_pitch_class(root: str) -> tuple[int, bool]:
    if root not in SCALE_ROOTS:
        raise OrchestronCliError("invalid_key", f"Unsupported key/root '{root}'.")
    return SCALE_ROOTS[root]


def roman_to_note_chord(roman: str, *, key: str, mode: str, octave: int) -> tuple[int, str]:
    match = ROMAN_RE.match(roman.strip())
    if not match:
        raise OrchestronCliError(
            "invalid_roman",
            f"Invalid Roman numeral '{roman}'.",
            retry=["Use values like i7, IV7, bVIImaj7, v, or Imaj7."],
        )
    accidentals, numeral, suffix = match.groups()
    mode_intervals = MODE_INTERVALS.get(mode)
    if mode_intervals is None:
        raise OrchestronCliError("invalid_mode", f"Unsupported mode '{mode}'.")
    degree_map = {"I": 0, "II": 1, "III": 2, "IV": 3, "V": 4, "VI": 5, "VII": 6}
    degree = degree_map.get(numeral.upper())
    if degree is None:
        raise OrchestronCliError("invalid_roman_degree", f"Unsupported Roman degree '{numeral}'.")
    root_pc, prefer_flats = key_pitch_class(key)
    accidental_offset = accidentals.count("#") - accidentals.count("b")
    note_pc = (root_pc + mode_intervals[degree] + accidental_offset) % 12
    root_note = note_name_to_midi(midi_to_note_name(note_pc + (octave + 1) * 12, prefer_flats=prefer_flats))
    chord = roman_chord_quality(note_pc, key_root_pc=root_pc, mode=mode, suffix=suffix, lowercase=numeral.islower())
    return root_note, chord


def roman_chord_quality(note_pc: int, *, key_root_pc: int, mode: str, suffix: str, lowercase: bool) -> str:
    normalized_suffix = suffix.strip()
    if normalized_suffix:
        if normalized_suffix == "7":
            return diatonic_seventh_quality(note_pc, key_root_pc=key_root_pc, mode=mode)
        return normalize_chord_label(normalized_suffix)
    return "min" if lowercase else "maj"


def diatonic_seventh_quality(note_pc: int, *, key_root_pc: int, mode: str) -> str:
    scale = [(key_root_pc + interval) % 12 for interval in MODE_INTERVALS[mode]]
    if note_pc not in scale:
        return "dom7"
    degree = scale.index(note_pc)
    pcs = []
    for tone in (0, 2, 4, 6):
        pcs.append(scale[(degree + tone) % len(scale)])
    intervals = sorted(((pc - note_pc) % 12 for pc in pcs))
    if intervals == [0, 4, 7, 11]:
        return "maj7"
    if intervals == [0, 3, 7, 10]:
        return "min7"
    if intervals == [0, 4, 7, 10]:
        return "dom7"
    if intervals == [0, 3, 6, 10]:
        return "m7b5"
    if intervals == [0, 3, 6, 9]:
        return "dim7"
    return "dom7"


def load_score_spec(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise OrchestronCliError("score_spec_missing", f"Score spec file not found: {path}")
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        parsed = json.loads(text)
    else:
        try:
            import yaml  # type: ignore
        except ImportError as exc:
            raise OrchestronCliError(
                "yaml_dependency_missing",
                "YAML score specs require PyYAML.",
                retry=["Use a .json score spec or install PyYAML in the backend environment."],
            ) from exc
        parsed = yaml.safe_load(text)
    if not isinstance(parsed, dict):
        raise OrchestronCliError("invalid_score_spec", "Score spec must be a JSON/YAML object.")
    return parsed


def apply_score_spec_to_config(config: dict[str, Any], spec: dict[str, Any]) -> list[dict[str, Any]]:
    created: list[dict[str, Any]] = []
    sequencer = ensure_sequencer(config)
    tempo = spec.get("tempo")
    if tempo is not None:
        bpm = clamp_int(tempo, 30, 300, field="tempo")
        sequencer["timing"]["tempoBPM"] = bpm
        sequencer["tempoBPM"] = bpm
    key = str(spec.get("key", "C"))
    mode = str(spec.get("mode", "aeolian"))
    default_channel = 1
    tracks = spec.get("tracks", [])
    if not isinstance(tracks, list):
        raise OrchestronCliError("invalid_score_spec", "score.tracks must be a list.", path="tracks")
    for index, track_spec in enumerate(tracks):
        if not isinstance(track_spec, dict):
            raise OrchestronCliError("invalid_score_spec", "track entries must be objects.", path=f"tracks[{index}]")
        track_type = str(track_spec.get("type", "melodic"))
        if track_type == "melodic":
            channel = clamp_int(track_spec.get("channel", default_channel), 1, 16, field=f"tracks[{index}].channel")
            length_beats = clamp_int(track_spec.get("length_beats", 4), 1, 8, field=f"tracks[{index}].length_beats")
            events = track_spec.get("events")
            progression = track_spec.get("progression")
            step_tokens = []
            if isinstance(events, list):
                for event_index, entry in enumerate(events):
                    if not isinstance(entry, dict):
                        raise OrchestronCliError("invalid_score_spec", "event entries must be objects.", path=f"tracks[{index}].events[{event_index}]")
                    note = entry.get("root")
                    if not isinstance(note, str):
                        raise OrchestronCliError("invalid_score_spec", "event.root is required.", path=f"tracks[{index}].events[{event_index}].root")
                    chord = normalize_chord_label(str(entry.get("chord", "none")))
                    at = clamp_int(entry.get("at_step", 0), 0, MAX_STEPS_PER_PAD - 1, field=f"tracks[{index}].events[{event_index}].at_step")
                    duration = clamp_int(entry.get("duration_steps", 1), 1, MAX_STEPS_PER_PAD, field=f"tracks[{index}].events[{event_index}].duration_steps")
                    step_tokens.append(f"s{at}={note}:{chord}/{duration}s")
            elif isinstance(progression, list):
                cursor = 0
                for prog_index, entry in enumerate(progression):
                    if isinstance(entry, str):
                        roman = entry
                        duration = length_beats
                        at = cursor
                    elif isinstance(entry, dict):
                        roman = str(entry.get("roman", ""))
                        duration = clamp_int(entry.get("duration_steps", length_beats), 1, MAX_STEPS_PER_PAD, field=f"tracks[{index}].progression[{prog_index}].duration_steps")
                        at = clamp_int(entry.get("at_step", cursor), 0, MAX_STEPS_PER_PAD - 1, field=f"tracks[{index}].progression[{prog_index}].at_step")
                    else:
                        raise OrchestronCliError("invalid_score_spec", "progression entries must be strings or objects.", path=f"tracks[{index}].progression[{prog_index}]")
                    note, chord = roman_to_note_chord(roman, key=key, mode=mode, octave=int(track_spec.get("octave", 3)))
                    root = midi_to_note_name(note, prefer_flats=key_pitch_class(key)[1])
                    step_tokens.append(f"s{at}={root}:{chord}/{duration}s")
                    cursor = at + duration
            elif isinstance(track_spec.get("grid_pattern"), str):
                created.append(
                    add_melodic_track_to_config(
                        config,
                        channel=channel,
                        name=track_spec.get("name") if isinstance(track_spec.get("name"), str) else None,
                        length_beats=length_beats,
                        scale_root=key,
                        scale_type=str(track_spec.get("scale_type", "minor")),
                        mode=mode,
                        enabled=bool(track_spec.get("enabled", True)),
                        steps_pattern=None,
                        grid_pattern=str(track_spec["grid_pattern"]),
                        velocity=clamp_int(track_spec.get("velocity", 100), 1, 127, field=f"tracks[{index}].velocity"),
                    )
                )
                continue
            else:
                raise OrchestronCliError(
                    "unsupported_score_track",
                    "Melodic score tracks need events, progression, or grid_pattern.",
                    path=f"tracks[{index}]",
                    retry=["Add explicit events or a progression to the score spec."],
                )
            created.append(
                add_melodic_track_to_config(
                    config,
                    channel=channel,
                    name=track_spec.get("name") if isinstance(track_spec.get("name"), str) else None,
                    length_beats=length_beats,
                    scale_root=key,
                    scale_type=str(track_spec.get("scale_type", "minor")),
                    mode=mode,
                    enabled=bool(track_spec.get("enabled", True)),
                    steps_pattern=" ".join(step_tokens),
                    grid_pattern=None,
                    velocity=clamp_int(track_spec.get("velocity", 100), 1, 127, field=f"tracks[{index}].velocity"),
                )
            )
        elif track_type == "drummer":
            created.append(
                add_drummer_track_to_config(
                    config,
                    channel=clamp_int(track_spec.get("channel", 10), 1, 16, field=f"tracks[{index}].channel"),
                    name=track_spec.get("name") if isinstance(track_spec.get("name"), str) else None,
                    length_beats=clamp_int(track_spec.get("length_beats", 4), 1, 8, field=f"tracks[{index}].length_beats"),
                    groove=str(track_spec.get("groove", "backbeat")),
                    enabled=bool(track_spec.get("enabled", True)),
                )
            )
        elif track_type == "controller":
            created.append(
                add_controller_sequencer_to_config(
                    config,
                    controller_number=clamp_int(track_spec.get("cc", track_spec.get("controller_number", 74)), 0, 127, field=f"tracks[{index}].cc"),
                    name=track_spec.get("name") if isinstance(track_spec.get("name"), str) else None,
                    length_beats=clamp_int(track_spec.get("length_beats", 8), 1, 16, field=f"tracks[{index}].length_beats"),
                    curve=str(track_spec.get("curve", "slow_sweep")),
                    enabled=bool(track_spec.get("enabled", True)),
                )
            )
        elif track_type == "arpeggiator":
            created.append(
                add_arpeggiator_to_config(
                    config,
                    input_channel=clamp_int(track_spec.get("input_channel", 3), 1, 16, field=f"tracks[{index}].input_channel"),
                    target_channel=clamp_int(track_spec.get("target_channel", 1), 1, 16, field=f"tracks[{index}].target_channel"),
                    name=track_spec.get("name") if isinstance(track_spec.get("name"), str) else None,
                    pattern=str(track_spec.get("pattern", "up")),
                    rate=str(track_spec.get("rate", "1/16")),
                    octaves=clamp_int(track_spec.get("octaves", 1), 1, 4, field=f"tracks[{index}].octaves"),
                    enabled=bool(track_spec.get("enabled", True)),
                )
            )
        else:
            raise OrchestronCliError("unsupported_score_track", f"Unsupported track type '{track_type}'.", path=f"tracks[{index}].type")
    return created


def compile_pad_loop_sequence(track: dict[str, Any]) -> list[int]:
    pattern = track.get("padLoopPattern")
    if isinstance(pattern, dict):
        compiled = compile_pad_loop_items(pattern, pattern.get("rootSequence", []), depth=0)
        if compiled:
            return compiled[:256]
    sequence = track.get("padLoopSequence")
    if isinstance(sequence, list) and sequence:
        return [int(item) for item in sequence if isinstance(item, int)][:256]
    return [int(track.get("activePad", 0))]


def compile_pad_loop_items(pattern: dict[str, Any], items: Any, *, depth: int) -> list[int]:
    if depth > 6 or not isinstance(items, list):
        return []
    groups = {group.get("id"): group.get("sequence", []) for group in pattern.get("groups", []) if isinstance(group, dict)}
    supers = {group.get("id"): group.get("sequence", []) for group in pattern.get("superGroups", []) if isinstance(group, dict)}
    result: list[int] = []
    for item in items:
        if isinstance(item, int):
            result.append(item)
        elif isinstance(item, dict):
            item_type = item.get("type")
            if item_type == "pad":
                result.append(max(0, min(7, int(item.get("padIndex", 0)))))
            elif item_type == "pause":
                result.append(-max(1, min(16, int(item.get("lengthBeats", 1)))))
            elif item_type == "group":
                result.extend(compile_pad_loop_items(pattern, groups.get(item.get("groupId"), []), depth=depth + 1))
            elif item_type == "super":
                result.extend(compile_pad_loop_items(pattern, supers.get(item.get("superGroupId"), []), depth=depth + 1))
        if len(result) >= 256:
            break
    return result


def timing_to_runtime(timing: dict[str, Any]) -> dict[str, int]:
    return {
        "tempo_bpm": int(timing.get("tempoBPM", timing.get("tempo_bpm", 120))),
        "meter_numerator": int(timing.get("meterNumerator", timing.get("meter_numerator", 4))),
        "meter_denominator": int(timing.get("meterDenominator", timing.get("meter_denominator", 4))),
        "steps_per_beat": int(timing.get("stepsPerBeat", timing.get("steps_per_beat", 4))),
        "beat_rate_numerator": int(timing.get("beatRateNumerator", timing.get("beat_rate_numerator", 1))),
        "beat_rate_denominator": int(timing.get("beatRateDenominator", timing.get("beat_rate_denominator", 1))),
    }


def build_runtime_config(config: dict[str, Any]) -> dict[str, Any]:
    sequencer = ensure_sequencer(config)
    timing = sequencer.get("timing") or default_timing()
    tracks = []
    for track in sequencer.get("tracks", []):
        if not isinstance(track, dict):
            continue
        track_timing = track.get("timing") if isinstance(track.get("timing"), dict) else timing
        pads = []
        for pad_index, pad in enumerate(track.get("pads", [])):
            if not isinstance(pad, dict):
                continue
            steps = []
            for step in pad.get("steps", []):
                if isinstance(step, dict):
                    steps.append(
                        {
                            "note": chord_notes(step.get("note"), str(step.get("chord", "none"))),
                            "hold": bool(step.get("hold", False)),
                            "velocity": max(0, min(127, int(step.get("velocity", 100)))),
                        }
                    )
                else:
                    steps.append(step)
            pads.append(
                {
                    "pad_index": pad_index,
                    "length_beats": int(pad.get("lengthBeats", track.get("lengthBeats", 4))),
                    "scale_root": pad.get("scaleRoot", track.get("scaleRoot", "C")),
                    "scale_type": pad.get("scaleType", track.get("scaleType", "minor")),
                    "mode": pad.get("mode", track.get("mode", "aeolian")),
                    "steps": steps,
                }
            )
        tracks.append(
            {
                "track_id": track.get("id", "voice-1"),
                "midi_channel": int(track.get("midiChannel", 1)),
                "timing": timing_to_runtime(track_timing),
                "scale_root": track.get("scaleRoot", "C"),
                "scale_type": track.get("scaleType", "minor"),
                "mode": track.get("mode", "aeolian"),
                "length_beats": int(track.get("lengthBeats", 4)),
                "velocity": 100,
                "gate_ratio": 0.8,
                "sync_to_track_id": track.get("syncToTrackId"),
                "active_pad": int(track.get("activePad", 0)),
                "queued_pad": track.get("queuedPad"),
                "pad_loop_enabled": bool(track.get("padLoopEnabled", False)),
                "pad_loop_repeat": bool(track.get("padLoopRepeat", True)),
                "pad_loop_sequence": compile_pad_loop_sequence(track),
                "enabled": bool(track.get("enabled", True)),
                "queued_enabled": track.get("queuedEnabled"),
                "pads": pads,
            }
        )
    for drummer in sequencer.get("drummerTracks", []):
        if not isinstance(drummer, dict):
            continue
        drum_timing = drummer.get("timing") if isinstance(drummer.get("timing"), dict) else timing
        rows = [row for row in drummer.get("rows", []) if isinstance(row, dict)]
        for row in rows:
            pads = []
            for pad_index, pad in enumerate(drummer.get("pads", [])):
                if not isinstance(pad, dict):
                    continue
                pad_row = next(
                    (entry for entry in pad.get("rows", []) if isinstance(entry, dict) and entry.get("rowId") == row.get("id")),
                    None,
                )
                steps = []
                for cell in (pad_row or {}).get("steps", []):
                    if isinstance(cell, dict) and cell.get("active"):
                        steps.append({"note": int(row.get("key", 36)), "hold": False, "velocity": int(cell.get("velocity", 100))})
                    else:
                        steps.append({"note": None, "hold": False, "velocity": 1})
                pads.append({"pad_index": pad_index, "length_beats": int(pad.get("lengthBeats", 4)), "steps": steps})
            tracks.append(
                {
                    "track_id": f"drumrow:{drummer.get('id', 'drum-1')}:{row.get('id', 'row')}",
                    "midi_channel": int(drummer.get("midiChannel", 10)),
                    "timing": timing_to_runtime(drum_timing),
                    "scale_root": "C",
                    "scale_type": "neutral",
                    "mode": "ionian",
                    "length_beats": int(drummer.get("lengthBeats", 4)),
                    "velocity": 100,
                    "gate_ratio": 0.8,
                    "sync_to_track_id": None,
                    "active_pad": int(drummer.get("activePad", 0)),
                    "queued_pad": drummer.get("queuedPad"),
                    "pad_loop_enabled": bool(drummer.get("padLoopEnabled", False)),
                    "pad_loop_repeat": bool(drummer.get("padLoopRepeat", True)),
                    "pad_loop_sequence": compile_pad_loop_sequence(drummer),
                    "enabled": bool(drummer.get("enabled", True)),
                    "queued_enabled": drummer.get("queuedEnabled"),
                    "pads": pads,
                }
            )
    controller_tracks = []
    for ctrl in sequencer.get("controllerSequencers", []):
        if not isinstance(ctrl, dict):
            continue
        ctrl_timing = ctrl.get("timing") if isinstance(ctrl.get("timing"), dict) else timing
        controller_tracks.append(
            {
                "track_id": ctrl.get("id", "cc-seq-1"),
                "controller_number": int(ctrl.get("controllerNumber", 0)),
                "timing": timing_to_runtime(ctrl_timing),
                "length_beats": int(ctrl.get("lengthBeats", 4)),
                "active_pad": int(ctrl.get("activePad", 0)),
                "queued_pad": ctrl.get("queuedPad"),
                "pad_loop_enabled": bool(ctrl.get("padLoopEnabled", False)),
                "pad_loop_repeat": bool(ctrl.get("padLoopRepeat", True)),
                "pad_loop_sequence": compile_pad_loop_sequence(ctrl),
                "enabled": bool(ctrl.get("enabled", True)),
                "pads": [
                    {
                        "pad_index": index,
                        "length_beats": int(pad.get("lengthBeats", ctrl.get("lengthBeats", 4))),
                        "keypoints": [
                            {"position": float(point.get("position", 0.0)), "value": int(point.get("value", 0))}
                            for point in pad.get("keypoints", [])
                            if isinstance(point, dict)
                        ],
                    }
                    for index, pad in enumerate(ctrl.get("pads", []))
                    if isinstance(pad, dict)
                ],
            }
        )
    if not tracks and not controller_tracks:
        raise OrchestronCliError(
            "runtime_config_empty",
            "Cannot push runtime config: no sequencer or controller tracks exist.",
            retry=["Add a melodic, drummer, or controller sequencer before pushing runtime config."],
        )
    return {
        "timing": {
            "tempo_bpm": int(timing.get("tempoBPM", 120)),
            "meter_numerator": int(timing.get("meterNumerator", 4)),
            "meter_denominator": int(timing.get("meterDenominator", 4)),
            "steps_per_beat": 8,
            "beat_rate_numerator": 1,
            "beat_rate_denominator": 1,
        },
        "step_count": 8,
        "playback_start_step": 0,
        "playback_end_step": 8,
        "playback_loop": False,
        "tracks": tracks,
        "controller_tracks": controller_tracks,
        "arpeggiators": [
            {
                "arpeggiator_id": arp.get("id", "arp-1"),
                "enabled": bool(arp.get("enabled", False)),
                "input_channel": int(arp.get("inputChannel", 3)),
                "target_channel": int(arp.get("targetChannel", 1)),
                "rate": arp.get("rate", "1/16"),
                "gate_ratio": float(arp.get("gateRatio", 0.72)),
                "swing": float(arp.get("swing", 0.0)),
                "octaves": int(arp.get("octaves", 1)),
                "pattern": arp.get("pattern", "up"),
                "latch": bool(arp.get("latch", False)),
                "velocity_mode": arp.get("velocityMode", "input"),
                "fixed_velocity": int(arp.get("fixedVelocity", 100)),
                "accent_cycle": arp.get("accentCycle", []),
                "probability": float(arp.get("probability", 1.0)),
                "repeats": int(arp.get("repeats", 1)),
                "humanize_ms": float(arp.get("humanizeMs", 0.0)),
                "humanize_velocity": int(arp.get("humanizeVelocity", 0)),
                "transpose": int(arp.get("transpose", 0)),
                "scale_quantize": bool(arp.get("scaleQuantize", False)),
                "scale_root": arp.get("scaleRoot", "C"),
                "scale_type": arp.get("scaleType", "minor"),
                "mode": arp.get("mode", "aeolian"),
                "restart_mode": arp.get("restartMode", "first_note"),
            }
            for arp in sequencer.get("arpeggiators", [])
            if isinstance(arp, dict)
        ],
    }


def validate_edit_session(session: dict[str, Any], client: ApiClient) -> dict[str, Any]:
    config = session.get("config")
    if not isinstance(config, dict):
        raise OrchestronCliError("invalid_edit_session", "Edit session has no valid config object.")
    instruments = config.get("instruments", [])
    if not isinstance(instruments, list) or not instruments:
        raise OrchestronCliError(
            "performance_has_no_instruments",
            "Performance has no instrument assignments.",
            retry=["Run `orchestron_cli edit add-instrument --patch PATCH --channel 1` before commit."],
            path="config.instruments",
        )
    patches = client.get("/patches")
    patch_ids = {patch.get("id") for patch in patches}
    seen_channels: set[int] = set()
    for index, instrument in enumerate(instruments):
        if not isinstance(instrument, dict):
            raise OrchestronCliError("invalid_instrument", "Instrument entries must be objects.", path=f"config.instruments[{index}]")
        patch_id = instrument.get("patchId")
        if patch_id not in patch_ids:
            raise OrchestronCliError(
                "unknown_patch",
                f"Instrument {index} references unknown patch '{patch_id}'.",
                path=f"config.instruments[{index}].patchId",
                retry=["Import or create the referenced patch, or change the instrument assignment."],
            )
        channel = int(instrument.get("midiChannel", 1))
        if channel in seen_channels:
            raise OrchestronCliError(
                "duplicate_midi_channel",
                f"MIDI channel {channel} is assigned more than once.",
                path=f"config.instruments[{index}].midiChannel",
                retry=["Use unique MIDI channels 1..16 for instrument assignments."],
            )
        seen_channels.add(channel)
    return {"valid": True, "instrument_count": len(instruments)}


def command_health(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(client.get("/health"), ctx)


def command_patches_list(args: argparse.Namespace, ctx: CliContext) -> None:
    rows = ApiClient(ctx.api_url, timeout=ctx.timeout).get("/patches")
    print_table(rows, [("id", "ID"), ("name", "Name"), ("schema_version", "Schema"), ("updated_at", "Updated")], ctx)


def command_patches_get(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    patches = client.get("/patches")
    patch = find_by_id_or_name(patches, args.patch, kind="patch")
    print_payload(client.get(f"/patches/{parse.quote(str(patch['id']))}"), ctx)


def import_bundle(args: argparse.Namespace, ctx: CliContext) -> None:
    path = Path(args.file)
    if not path.exists():
        raise OrchestronCliError("bundle_missing", f"Import bundle does not exist: {path}")
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    expanded = client.upload_bundle(path)
    patches = client.get("/patches")
    performances = client.get("/performances")
    patch_by_name = {normalize_name_key(str(item.get("name", ""))): item for item in patches}
    perf_by_name = {normalize_name_key(str(item.get("name", ""))): item for item in performances}
    taken_patch_names = set(patch_by_name)
    imported_patches = []
    patch_id_map: dict[str, str] = {}
    if args.include_patches:
        for definition in extract_patch_definitions(expanded):
            name = exported_patch_name(definition)
            existing = patch_by_name.get(normalize_name_key(name))
            action, target_name = conflict_action(
                kind="patch",
                name=name,
                existing=existing,
                on_conflict=args.on_conflict,
                taken=taken_patch_names,
            )
            source_id = definition.get("sourcePatchId")
            if action == "skip":
                if existing and source_id:
                    patch_id_map[str(source_id)] = str(existing["id"])
                imported_patches.append({"sourcePatchId": source_id, "action": "skip", "existingPatchId": existing.get("id") if existing else None})
                continue
            payload = {
                "name": target_name,
                "description": definition.get("description", ""),
                "schema_version": int(definition.get("schema_version", 1)),
                "graph": definition["graph"],
            }
            if action == "update" and existing:
                saved = client.put(f"/patches/{parse.quote(str(existing['id']))}", payload)
                saved_action = "update"
            else:
                saved = client.post("/patches", payload)
                saved_action = "create"
            if source_id:
                patch_id_map[str(source_id)] = str(saved["id"])
            taken_patch_names.add(normalize_name_key(str(saved["name"])))
            imported_patches.append({"sourcePatchId": source_id, "action": saved_action, "patchId": saved["id"], "name": saved["name"]})
    imported_performance = None
    if args.include_performance and is_performance_export(expanded):
        name = exported_performance_name(expanded)
        existing = perf_by_name.get(normalize_name_key(name))
        action, target_name = conflict_action(
            kind="performance",
            name=name,
            existing=existing,
            on_conflict=args.on_conflict,
            taken=set(perf_by_name),
        )
        if action == "skip":
            imported_performance = {"action": "skip", "existingPerformanceId": existing.get("id") if existing else None}
        else:
            perf = expanded["performance"]
            config = remap_snapshot_patch_ids(copy.deepcopy(perf.get("config", {})), patch_id_map, client.get("/patches"))
            payload = {
                "name": target_name,
                "description": perf.get("description", ""),
                "config": config,
            }
            if action == "update" and existing:
                saved_perf = client.put(f"/performances/{parse.quote(str(existing['id']))}", payload)
                saved_action = "update"
            else:
                saved_perf = client.post("/performances", payload)
                saved_action = "create"
            imported_performance = {"action": saved_action, "performanceId": saved_perf["id"], "name": saved_perf["name"]}
    print_payload({"patches": imported_patches, "performance": imported_performance}, ctx)


def remap_snapshot_patch_ids(config: dict[str, Any], patch_id_map: dict[str, str], patches: list[dict[str, Any]]) -> dict[str, Any]:
    patch_by_name = {normalize_name_key(str(patch.get("name", ""))): patch for patch in patches}
    for instrument in config.get("instruments", []):
        if not isinstance(instrument, dict):
            continue
        source = str(instrument.get("patchId", ""))
        if source in patch_id_map:
            instrument["patchId"] = patch_id_map[source]
            continue
        patch_name = instrument.get("patchName")
        if isinstance(patch_name, str):
            existing = patch_by_name.get(normalize_name_key(patch_name))
            if existing:
                instrument["patchId"] = existing["id"]
    return config


def command_performances_list(args: argparse.Namespace, ctx: CliContext) -> None:
    rows = ApiClient(ctx.api_url, timeout=ctx.timeout).get("/performances")
    print_table(rows, [("id", "ID"), ("name", "Name"), ("updated_at", "Updated")], ctx)


def command_performances_get(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    performances = client.get("/performances")
    perf = find_by_id_or_name(performances, args.performance, kind="performance")
    print_payload(client.get(f"/performances/{parse.quote(str(perf['id']))}"), ctx)


def command_performances_copy(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    performances = client.get("/performances")
    perf = find_by_id_or_name(performances, args.source, kind="performance")
    full = client.get(f"/performances/{parse.quote(str(perf['id']))}")
    payload = {
        "name": args.name,
        "description": args.description if args.description is not None else full.get("description", ""),
        "config": full.get("config", {}),
    }
    saved = client.post("/performances", payload)
    print_payload({"action": "copy", "sourcePerformanceId": full["id"], "performanceId": saved["id"], "name": saved["name"]}, ctx)


def command_edit_begin(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    if args.performance and args.new:
        raise OrchestronCliError("invalid_edit_begin", "Use either --performance or --new, not both.")
    if args.performance:
        performances = client.get("/performances")
        perf_ref = find_by_id_or_name(performances, args.performance, kind="performance")
        full = client.get(f"/performances/{parse.quote(str(perf_ref['id']))}")
        session = {
            "apiUrl": ctx.api_url,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "performanceId": full["id"],
            "name": full["name"],
            "description": full.get("description", ""),
            "config": full.get("config", {}),
            "attachedSessionId": args.attach_live,
            "dirty": False,
        }
    elif args.new:
        if not args.name:
            raise OrchestronCliError("missing_name", "`edit begin --new` requires --name.")
        session = {
            "apiUrl": ctx.api_url,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "performanceId": None,
            "name": args.name,
            "description": args.description or "",
            "config": empty_performance_config(tempo=args.tempo),
            "attachedSessionId": args.attach_live,
            "dirty": True,
        }
    else:
        raise OrchestronCliError("invalid_edit_begin", "Use --performance PERFORMANCE_ID or --new --name NAME.")
    save_edit_session(ctx.session_file, session)
    print_payload({"editSessionFile": str(ctx.session_file), "performanceId": session["performanceId"], "name": session["name"]}, ctx)


def update_session_config(ctx: CliContext, mutator) -> dict[str, Any]:
    session = load_edit_session(ctx.session_file)
    config = session.get("config")
    if not isinstance(config, dict):
        raise OrchestronCliError("invalid_edit_session", "Edit session has no valid config.")
    result = mutator(config)
    session["config"] = config
    session["updatedAt"] = now_iso()
    session["dirty"] = True
    save_edit_session(ctx.session_file, session)
    return result


def command_edit_status(args: argparse.Namespace, ctx: CliContext) -> None:
    session = load_edit_session(ctx.session_file)
    config = session.get("config", {})
    sequencer = ensure_sequencer(config) if isinstance(config, dict) else {}
    print_payload(
        {
            "editSessionFile": str(ctx.session_file),
            "performanceId": session.get("performanceId"),
            "name": session.get("name"),
            "dirty": session.get("dirty"),
            "attachedSessionId": session.get("attachedSessionId"),
            "instruments": len(config.get("instruments", [])) if isinstance(config, dict) else 0,
            "melodicTracks": len(sequencer.get("tracks", [])),
            "drummerTracks": len(sequencer.get("drummerTracks", [])),
            "controllerSequencers": len(sequencer.get("controllerSequencers", [])),
            "arpeggiators": len(sequencer.get("arpeggiators", [])),
        },
        ctx,
    )


def command_edit_add_instrument(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    patch_ref = find_by_id_or_name(client.get("/patches"), args.patch, kind="patch")

    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        instruments = config.setdefault("instruments", [])
        channel = clamp_int(args.channel, 1, 16, field="channel")
        if any(isinstance(item, dict) and int(item.get("midiChannel", -1)) == channel for item in instruments):
            raise OrchestronCliError(
                "duplicate_midi_channel",
                f"MIDI channel {channel} already has an instrument assignment.",
                retry=["Use a different --channel or remove the existing assignment first."],
            )
        binding = {
            "patchId": patch_ref["id"],
            "patchName": patch_ref["name"],
            "midiChannel": channel,
            "level": clamp_int(args.level, 1, 10, field="level"),
        }
        instruments.append(binding)
        return binding

    print_payload(update_session_config(ctx, mutate), ctx)


def command_edit_add_melodic(args: argparse.Namespace, ctx: CliContext) -> None:
    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        return add_melodic_track_to_config(
            config,
            channel=clamp_int(args.channel, 1, 16, field="channel"),
            name=args.name,
            length_beats=clamp_int(args.length_beats, 1, 8, field="length_beats"),
            scale_root=args.scale_root,
            scale_type=args.scale_type,
            mode=args.mode,
            enabled=args.enabled,
            steps_pattern=args.steps,
            grid_pattern=args.grid_pattern,
            velocity=clamp_int(args.velocity, 1, 127, field="velocity"),
        )

    print_payload(summarize_device(update_session_config(ctx, mutate)), ctx)


def command_edit_add_drummer(args: argparse.Namespace, ctx: CliContext) -> None:
    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        return add_drummer_track_to_config(
            config,
            channel=clamp_int(args.channel, 1, 16, field="channel"),
            name=args.name,
            length_beats=clamp_int(args.length_beats, 1, 8, field="length_beats"),
            groove=args.groove,
            enabled=args.enabled,
        )

    print_payload(summarize_device(update_session_config(ctx, mutate)), ctx)


def command_edit_add_controller_sequencer(args: argparse.Namespace, ctx: CliContext) -> None:
    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        return add_controller_sequencer_to_config(
            config,
            controller_number=clamp_int(args.cc, 0, 127, field="cc"),
            name=args.name,
            length_beats=clamp_int(args.length_beats, 1, 16, field="length_beats"),
            curve=args.curve,
            enabled=args.enabled,
        )

    print_payload(summarize_device(update_session_config(ctx, mutate)), ctx)


def command_edit_add_midi_controller(args: argparse.Namespace, ctx: CliContext) -> None:
    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        return add_midi_controller_to_config(
            config,
            controller_number=clamp_int(args.cc, 0, 127, field="cc"),
            name=args.name,
            value=clamp_int(args.value, 0, 127, field="value"),
            enabled=args.enabled,
        )

    print_payload(summarize_device(update_session_config(ctx, mutate)), ctx)


def command_edit_add_arpeggiator(args: argparse.Namespace, ctx: CliContext) -> None:
    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        return add_arpeggiator_to_config(
            config,
            input_channel=clamp_int(args.input_channel, 1, 16, field="input_channel"),
            target_channel=clamp_int(args.target_channel, 1, 16, field="target_channel"),
            name=args.name,
            pattern=args.pattern,
            rate=args.rate,
            octaves=clamp_int(args.octaves, 1, 4, field="octaves"),
            enabled=args.enabled,
        )

    print_payload(summarize_device(update_session_config(ctx, mutate)), ctx)


def command_edit_apply_score(args: argparse.Namespace, ctx: CliContext) -> None:
    spec = load_score_spec(Path(args.score_spec))

    def mutate(config: dict[str, Any]) -> dict[str, Any]:
        created = apply_score_spec_to_config(config, spec)
        return {"created": [{"id": item.get("id"), "name": item.get("name")} for item in created]}

    print_payload(update_session_config(ctx, mutate), ctx)


def command_edit_validate(args: argparse.Namespace, ctx: CliContext) -> None:
    session = load_edit_session(ctx.session_file)
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(validate_edit_session(session, client), ctx)


def command_edit_commit(args: argparse.Namespace, ctx: CliContext) -> None:
    session = load_edit_session(ctx.session_file)
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    if not args.skip_validate:
        validate_edit_session(session, client)
    config = copy.deepcopy(session["config"])
    selected_patch_ids = []
    for instrument in config.get("instruments", []):
        if isinstance(instrument, dict) and instrument.get("patchId") and instrument["patchId"] not in selected_patch_ids:
            selected_patch_ids.append(instrument["patchId"])
    selected_patches = []
    for patch_id in selected_patch_ids:
        patch = client.get(f"/patches/{parse.quote(str(patch_id))}")
        selected_patches.append(patch)
    patch_name_by_id = {patch["id"]: patch["name"] for patch in selected_patches}
    for instrument in config.get("instruments", []):
        if isinstance(instrument, dict):
            instrument["patchName"] = patch_name_by_id.get(instrument.get("patchId"), instrument.get("patchName"))
    config["patchDefinitions"] = [
        {
            "sourcePatchId": patch["id"],
            "name": patch["name"],
            "description": patch.get("description", ""),
            "schema_version": patch.get("schema_version", 1),
            "graph": patch["graph"],
        }
        for patch in selected_patches
    ]
    payload = {"name": session["name"], "description": session.get("description", ""), "config": config}
    if session.get("performanceId"):
        saved = client.put(f"/performances/{parse.quote(str(session['performanceId']))}", payload)
        action = "update"
    else:
        saved = client.post("/performances", payload)
        action = "create"
    session["performanceId"] = saved["id"]
    session["name"] = saved["name"]
    session["description"] = saved.get("description", "")
    session["config"] = saved["config"]
    session["dirty"] = False
    session["updatedAt"] = now_iso()
    save_edit_session(ctx.session_file, session)
    print_payload({"action": action, "performanceId": saved["id"], "name": saved["name"]}, ctx)


def command_edit_abort(args: argparse.Namespace, ctx: CliContext) -> None:
    if ctx.session_file.exists():
        ctx.session_file.unlink()
    print_payload({"action": "abort", "editSessionFile": str(ctx.session_file)}, ctx)


def command_edit_push_runtime(args: argparse.Namespace, ctx: CliContext) -> None:
    session = load_edit_session(ctx.session_file)
    session_id = args.session_id or session.get("attachedSessionId")
    if not session_id:
        raise OrchestronCliError(
            "runtime_session_missing",
            "No runtime session ID supplied or attached to the edit session.",
            retry=["Run `orchestron_cli edit push-runtime --session-id SESSION_ID` or begin with --attach-live SESSION_ID."],
        )
    runtime_config = build_runtime_config(copy.deepcopy(session["config"]))
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    status = client.put(f"/sessions/{parse.quote(str(session_id))}/sequencer/config", runtime_config)
    print_payload({"sessionId": session_id, "sequencerStatus": status}, ctx)


def command_sessions_list(args: argparse.Namespace, ctx: CliContext) -> None:
    rows = ApiClient(ctx.api_url, timeout=ctx.timeout).get("/sessions")
    print_table(rows, [("session_id", "Session"), ("state", "State"), ("patch_id", "Patch"), ("midi_input", "MIDI Input")], ctx)


def command_sessions_start(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(client.post(f"/sessions/{parse.quote(args.session_id)}/start"), ctx)


def command_sessions_stop(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(client.post(f"/sessions/{parse.quote(args.session_id)}/stop"), ctx)


def command_sessions_panic(args: argparse.Namespace, ctx: CliContext) -> None:
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(client.post(f"/sessions/{parse.quote(args.session_id)}/panic"), ctx)


def command_sessions_midi_event(args: argparse.Namespace, ctx: CliContext) -> None:
    payload: dict[str, Any] = {"type": args.type, "channel": clamp_int(args.channel, 1, 16, field="channel")}
    if args.type in {"note_on", "note_off"}:
        payload["note"] = note_name_to_midi(args.note) if args.note and not args.note.isdigit() else clamp_int(args.note, 0, 127, field="note")
        payload["velocity"] = clamp_int(args.velocity, 0, 127, field="velocity")
    if args.type == "control_change":
        payload["controller"] = clamp_int(args.controller, 0, 127, field="controller")
        payload["value"] = clamp_int(args.value, 0, 127, field="value")
    client = ApiClient(ctx.api_url, timeout=ctx.timeout)
    print_payload(client.post(f"/sessions/{parse.quote(args.session_id)}/midi-event", payload), ctx)


def add_global_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help=f"Orchestron API base URL. Default: {DEFAULT_API_URL}")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON output.")
    parser.add_argument("--debug", action="store_true", help="Include backend details in structured errors.")
    parser.add_argument("--timeout", type=float, default=20.0, help="Backend request timeout in seconds. Default: 20.")
    parser.add_argument("--session-file", default=str(SESSION_FILE), help=f"Edit-session metadata file. Default: {SESSION_FILE}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="orchestron_cli",
        description="Backend-only CLI for Orchestron performance creation, editing, import, and live-session control.",
        epilog="Every command supports -h/--help. Start the backend with `make run` before using backend commands.",
    )
    add_global_options(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    health = sub.add_parser("health", help="Check backend connectivity.")
    health.set_defaults(func=command_health)

    patches = sub.add_parser("patches", help="List, inspect, and import instrument patches.")
    patches_sub = patches.add_subparsers(dest="patches_command", required=True)
    patches_list = patches_sub.add_parser("list", help="List available patches/instruments.")
    patches_list.set_defaults(func=command_patches_list)
    patches_get = patches_sub.add_parser("get", help="Get a patch by ID or exact name.")
    patches_get.add_argument("patch", help="Patch ID or exact patch name.")
    patches_get.set_defaults(func=command_patches_get)
    patches_import = patches_sub.add_parser("import", help="Import patch or performance bundles with GUI-like conflicts.")
    patches_import.add_argument("file", help="Bundle file: .orch.instrument.json, .orch.instrument.zip, .orch.json, or .orch.zip.")
    patches_import.add_argument("--on-conflict", choices=["prompt", "overwrite", "skip", "rename", "fail"], default="prompt", help="Conflict handling. Default: prompt in TTY, error in non-TTY.")
    patches_import.add_argument("--include-performance", action=argparse.BooleanOptionalAction, default=True, help="Import performance payload when the bundle contains one.")
    patches_import.add_argument("--include-patches", action=argparse.BooleanOptionalAction, default=True, help="Import embedded patch definitions.")
    patches_import.set_defaults(func=import_bundle)

    performances = sub.add_parser("performances", help="List, inspect, copy, and import performances.")
    perf_sub = performances.add_subparsers(dest="performances_command", required=True)
    perf_list = perf_sub.add_parser("list", help="List saved performances.")
    perf_list.set_defaults(func=command_performances_list)
    perf_get = perf_sub.add_parser("get", help="Get a performance by ID or exact name.")
    perf_get.add_argument("performance", help="Performance ID or exact performance name.")
    perf_get.set_defaults(func=command_performances_get)
    perf_copy = perf_sub.add_parser("copy", help="Copy an existing performance to a new saved performance.")
    perf_copy.add_argument("source", help="Source performance ID or exact name.")
    perf_copy.add_argument("--name", required=True, help="Name for the copied performance.")
    perf_copy.add_argument("--description", default=None, help="Optional description override.")
    perf_copy.set_defaults(func=command_performances_copy)
    perf_import = perf_sub.add_parser("import", help="Import a performance bundle.")
    perf_import.add_argument("file", help="Bundle file: .orch.json or .orch.zip.")
    perf_import.add_argument("--on-conflict", choices=["prompt", "overwrite", "skip", "rename", "fail"], default="prompt")
    perf_import.add_argument("--include-performance", action=argparse.BooleanOptionalAction, default=True)
    perf_import.add_argument("--include-patches", action=argparse.BooleanOptionalAction, default=True)
    perf_import.set_defaults(func=import_bundle)

    edit = sub.add_parser("edit", help="Create and mutate staged performance edit sessions.")
    edit_sub = edit.add_subparsers(dest="edit_command", required=True)
    begin = edit_sub.add_parser("begin", help="Start a staged edit session from a performance or a new draft.")
    begin.add_argument("--performance", help="Existing performance ID or exact name.")
    begin.add_argument("--new", action="store_true", help="Start a new performance draft.")
    begin.add_argument("--name", help="Name for a new draft.")
    begin.add_argument("--description", default="", help="Description for a new draft.")
    begin.add_argument("--tempo", type=int, default=120, help="Initial tempo for --new drafts.")
    begin.add_argument("--attach-live", help="Optional runtime session ID to use for push-runtime.")
    begin.set_defaults(func=command_edit_begin)
    status = edit_sub.add_parser("status", help="Show the active staged edit session summary.")
    status.set_defaults(func=command_edit_status)
    add_inst = edit_sub.add_parser("add-instrument", help="Add an instrument assignment to the staged performance.")
    add_inst.add_argument("--patch", required=True, help="Patch ID or exact name.")
    add_inst.add_argument("--channel", required=True, type=int, help="MIDI channel 1..16.")
    add_inst.add_argument("--level", type=int, default=10, help="Instrument level 1..10.")
    add_inst.set_defaults(func=command_edit_add_instrument)
    add_mel = edit_sub.add_parser("add-melodic", help="Add a melodic sequencer with explicit step/chord patterns.")
    add_mel.add_argument("--channel", required=True, type=int, help="MIDI channel 1..16.")
    add_mel.add_argument("--name", help="Track name.")
    add_mel.add_argument("--length-beats", type=int, default=4, help="Pad length in beats, 1..8.")
    add_mel.add_argument("--scale-root", default="C", choices=sorted(SCALE_ROOTS.keys()), help="Scale root.")
    add_mel.add_argument("--scale-type", default="minor", choices=sorted(SCALE_TYPES), help="Scale type.")
    add_mel.add_argument("--mode", default="aeolian", choices=sorted(MODE_INTERVALS.keys()), help="Mode.")
    add_mel.add_argument("--velocity", type=int, default=100, help="Default velocity 1..127.")
    add_mel.add_argument("--steps", help="Explicit tokens, for example: s0=C3:min7/4s s4=F3:dom7/4s.")
    add_mel.add_argument("--grid-pattern", help="One token per step; . rest, _ hold, C3:min7 attack.")
    add_mel.add_argument("--enabled", action=argparse.BooleanOptionalAction, default=True, help="Enable this sequencer track.")
    add_mel.set_defaults(func=command_edit_add_melodic)
    add_drum = edit_sub.add_parser("add-drummer", help="Add a General MIDI drummer sequencer groove.")
    add_drum.add_argument("--channel", type=int, default=10, help="MIDI channel 1..16. Default: 10.")
    add_drum.add_argument("--name", help="Track name.")
    add_drum.add_argument("--length-beats", type=int, default=4)
    add_drum.add_argument("--groove", default="backbeat", choices=["backbeat", "four_on_floor", "half_time", "breakbeat", "electro", "sparse"])
    add_drum.add_argument("--enabled", action=argparse.BooleanOptionalAction, default=True)
    add_drum.set_defaults(func=command_edit_add_drummer)
    add_cc_seq = edit_sub.add_parser("add-controller-sequencer", help="Add a controller sequencer curve.")
    add_cc_seq.add_argument("--cc", required=True, type=int, help="Controller number 0..127.")
    add_cc_seq.add_argument("--name", help="Track name.")
    add_cc_seq.add_argument("--length-beats", type=int, default=8, help="Curve length, 1..16 beats.")
    add_cc_seq.add_argument("--curve", default="slow_sweep", help="Curve preset or position:value pairs, for example 0:24,0.5:96,1:48.")
    add_cc_seq.add_argument("--enabled", action=argparse.BooleanOptionalAction, default=True)
    add_cc_seq.set_defaults(func=command_edit_add_controller_sequencer)
    add_cc = edit_sub.add_parser("add-midi-controller", help="Add a manual MIDI controller lane.")
    add_cc.add_argument("--cc", required=True, type=int, help="Controller number 0..127.")
    add_cc.add_argument("--name", help="Controller name.")
    add_cc.add_argument("--value", type=int, default=0, help="Initial value 0..127.")
    add_cc.add_argument("--enabled", action=argparse.BooleanOptionalAction, default=True)
    add_cc.set_defaults(func=command_edit_add_midi_controller)
    add_arp = edit_sub.add_parser("add-arpeggiator", help="Add a backend-run arpeggiator.")
    add_arp.add_argument("--input-channel", required=True, type=int, help="Arpeggiator input channel 1..16.")
    add_arp.add_argument("--target-channel", required=True, type=int, help="Target instrument channel 1..16.")
    add_arp.add_argument("--name", help="Arpeggiator name.")
    add_arp.add_argument("--pattern", default="up", choices=sorted(ARPEGGIATOR_PATTERNS))
    add_arp.add_argument("--rate", default="1/16", choices=sorted(ARPEGGIATOR_RATES))
    add_arp.add_argument("--octaves", type=int, default=1)
    add_arp.add_argument("--enabled", action=argparse.BooleanOptionalAction, default=True)
    add_arp.set_defaults(func=command_edit_add_arpeggiator)
    apply_score = edit_sub.add_parser("apply-score", help="Apply a YAML/JSON score spec to the staged performance.")
    apply_score.add_argument("score_spec", help="Path to YAML or JSON score spec.")
    apply_score.set_defaults(func=command_edit_apply_score)
    validate = edit_sub.add_parser("validate", help="Validate staged performance references before commit.")
    validate.set_defaults(func=command_edit_validate)
    commit = edit_sub.add_parser("commit", help="Commit staged performance to the backend and embed patch definitions.")
    commit.add_argument("--skip-validate", action="store_true", help="Skip reference validation before commit.")
    commit.set_defaults(func=command_edit_commit)
    abort = edit_sub.add_parser("abort", help="Abort the staged edit session and remove the local session file.")
    abort.set_defaults(func=command_edit_abort)
    push_runtime = edit_sub.add_parser("push-runtime", help="Push staged sequencer/arpeggiator config to a live runtime session.")
    push_runtime.add_argument("--session-id", help="Runtime session ID. Defaults to edit begin --attach-live value.")
    push_runtime.set_defaults(func=command_edit_push_runtime)

    sessions = sub.add_parser("sessions", help="Inspect and control live runtime sessions.")
    sessions_sub = sessions.add_subparsers(dest="sessions_command", required=True)
    sessions_list = sessions_sub.add_parser("list", help="List runtime sessions.")
    sessions_list.set_defaults(func=command_sessions_list)
    sessions_start = sessions_sub.add_parser("start", help="Start a runtime session.")
    sessions_start.add_argument("session_id")
    sessions_start.set_defaults(func=command_sessions_start)
    sessions_stop = sessions_sub.add_parser("stop", help="Stop a runtime session.")
    sessions_stop.add_argument("session_id")
    sessions_stop.set_defaults(func=command_sessions_stop)
    sessions_panic = sessions_sub.add_parser("panic", help="Send panic/all-notes-off to a runtime session.")
    sessions_panic.add_argument("session_id")
    sessions_panic.set_defaults(func=command_sessions_panic)
    midi = sessions_sub.add_parser("midi-event", help="Send a manual MIDI event to a running runtime session.")
    midi.add_argument("session_id")
    midi.add_argument("--type", choices=["note_on", "note_off", "all_notes_off", "control_change"], required=True)
    midi.add_argument("--channel", type=int, default=1)
    midi.add_argument("--note", help="MIDI note number or note name such as C3.")
    midi.add_argument("--velocity", type=int, default=100)
    midi.add_argument("--controller", type=int)
    midi.add_argument("--value", type=int)
    midi.set_defaults(func=command_sessions_midi_event)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    ctx = CliContext(
        api_url=args.api_url,
        json_output=args.json,
        debug=args.debug,
        timeout=args.timeout,
        session_file=Path(args.session_file),
    )
    try:
        args.func(args, ctx)
        return 0
    except OrchestronCliError as exc:
        if ctx.json_output:
            print(json.dumps(exc.to_json(debug=ctx.debug), ensure_ascii=True, indent=2), file=sys.stderr)
        else:
            print(f"Error [{exc.code}]: {exc.message}", file=sys.stderr)
            if exc.path:
                print(f"Path: {exc.path}", file=sys.stderr)
            if exc.retry:
                print("Retry:", file=sys.stderr)
                for item in exc.retry:
                    print(f"  - {item}", file=sys.stderr)
            if ctx.debug and exc.backend:
                print("Backend:", json.dumps(exc.backend, ensure_ascii=True, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
