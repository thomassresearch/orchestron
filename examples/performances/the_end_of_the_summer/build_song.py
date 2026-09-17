#!/usr/bin/env python3
"""Reproduce this song through the performance skill CLI and the running API.

The score is ordinary CLI JSON. The builder also applies per-event velocities
and custom drum cells to the CLI draft, using the existing persisted pad schema.
No patch, application state, or other performance is modified.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
from urllib import request
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-performance-creator/src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402

TITLE = "The End of the Summer"
SESSION = HERE / "work/edit-session.json"
MANIFEST = HERE / "library_manifest.json"
DESCRIPTION = (
    "112 BPM | E minor | 168 bars | 6:00 including decay. Dark wave: a cold industrial "
    "pulse interrupted by warm strings and brass. 0:00 Clouds; 0:34 Machinery; "
    "1:43 First sunlight; 2:00 Clouds return; 3:09 Open sky; 3:43 Warmth within "
    "the machine; 4:51 Unwinding; 5:26 A little warmth survives. "
    "Finite Pad Looper arrangement, Repeat off. Final four bars reserved for tails."
)
SECTIONS = [
    ("Clouds", 8), ("Machinery", 16), ("First sunlight", 4),
    ("Clouds return", 16), ("Open sky", 8), ("Warmth within the machine", 16),
    ("Unwinding", 8), ("A little warmth survives", 8),
]
RACK = [
    ("drums", "Analog Drumkit", 10, -11, 0, {}),
    ("bass", "EBM DW — Sequencer Bass", 1, -8, 0,
     {"tone": 600, "decay": .09, "release": .045, "drive": 1.7, "resonance": .28}),
    ("strikes", "EBM DW — Industrial Stab", 2, -14, -.12,
     {"clang": 2.6, "noise": .2, "decay": .16, "drive": 2.2, "space": .08}),
    ("clouds", "EBM DW — Dark PWM Pad", 3, -8, 0,
     {"tone": 750, "attack": 1.4, "release": 2.4, "motion_depth": .25, "space": .28}),
    ("theme", "EBM DW — Dark Saw Lead", 4, 0, -.08,
     {"tone": 1800, "vibrato": 4, "echo": .15, "chorus": .2, "release": .22}),
    ("sunlight", "EBM DW — String Ensemble", 5, -1, 0,
     {"tone": 2300, "attack": .9, "release": 3, "chorus": .6, "reverb": .22}),
    ("sunrays", "EBM DW — Analog Brass", 6, 0, .13,
     {"tone": 950, "attack": .09, "release": .8, "filter_envelope": 1400,
      "filter_decay": .65, "space": .18}),
    ("glints", "EBM DW — Glass Bell", 7, -12, .15,
     {"ratio": 2, "fm_depth": .7, "tone": 4200, "space": .3, "decay": 2}),
    ("weather", "EBM DW — Noise Metal FX", 8, -16, 0,
     {"color": 1000, "metal_blend": .3, "space": .35, "release": 2.5}),
]


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def sound_digest(native, runtime):
    config = native["performance"]["config"]
    content = {"runtime": runtime, "instruments": config["instruments"],
               "routing": config["audioGraph"], "mixer": config["mixer"],
               "patches": native["patch_definitions"]}
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def command(*args):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        status = cli.main(["--json", "--timeout", "120", "--session-file", str(SESSION), *map(str, args)])
    value = json.loads(output.getvalue())
    if status or not value.get("ok"):
        raise RuntimeError(value)
    return value["result"]


def event(at, note, duration=1, velocity=80, chord="none"):
    return {"at_step": at, "root": note, "duration_steps": duration,
            "velocity": velocity, "chord": chord}


def pad(*events, velocity=80):
    return {"length_beats": 8, "velocity": velocity, "events": list(events)}


def line(notes):
    return pad(*(event(*note) for note in notes))


def harmony(root, quality, velocity, duration=30):
    return pad(event(0, root, duration, velocity, quality), velocity=velocity)


def motor(root, variant=False, sparse=False):
    midi = cli.note_name_to_midi(root)
    positions = [2, 10, 18, 26] if sparse else [2, 3, 6, 10, 11, 14, 18, 19, 22, 26, 27, 30]
    if variant:
        positions += [7, 15, 29]
    return pad(*(event(p, cli.midi_to_note_name(midi + (12 if p in (14, 30) else 0)),
                      2 if sparse else 1,
                      (62 if sparse else 99) if p % 8 == 2 else 72 + (p * 7) % 16)
                 for p in sorted(positions)))


def make_score():
    # One slot is two bars. None becomes an eight-beat pause, not a silent note.
    identity = [1, 2, 3, 4]
    scores = []

    def track(name, channel, pads, sections):
        assert [len(s) for s in sections] == [n for _, n in SECTIONS], name
        groups, supers, root = {}, {}, []
        for si, cells in enumerate(sections):
            group_ids = []
            for offset in range(0, len(cells), 4):
                gid = chr(65 + len(groups))
                groups[gid] = ["P8" if p is None else p for p in cells[offset:offset + 4]]
                group_ids.append(gid)
            sid = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][si]
            supers[sid] = group_ids
            root.append("super:" + sid)
        scores.append({"type": "melodic", "name": name, "channel": channel,
                       "length_beats": 8, "key": "E", "mode": "aeolian",
                       "pads": [{**p, "pad": i + 1} for i, p in enumerate(pads)],
                       "pad_loop": {"repeat": False, "groups": groups,
                                    "super_groups": supers, "root": root}})

    track("01 · Iron pulse", 1,
          [motor("E2"), motor("C2"), motor("A1"), motor("B1"), motor("E2", variant=True),
           motor("E2", sparse=True), motor("C2", sparse=True), motor("G1", sparse=True)],
          [[None] * 4 + [6, 6, 1, 1], identity * 4, [7, 8, 7, 8],
           identity * 2 + [5, 2, 3, 4] * 2, [7, 8, None, 8, 7, 8, 6, None],
           [5, 2, 3, 4] * 3 + identity, [1, 2, 3, 4, 6, 7, 6, None], [None] * 8])

    def hits(root, positions, vel):
        return pad(*(event(s, root, 1, vel - (i % 3) * 9) for i, s in enumerate(positions)))
    track("02 · Steel punctuation", 2,
          [hits("E3", [7, 18, 27], 78), hits("E3", [11, 27], 60),
           hits("B3", [3, 11, 19, 27], 76), hits("E3", [7, 23, 26, 30], 85),
           hits("C3", [7, 18, 27], 76), hits("A2", [7, 18, 27], 78),
           hits("B2", [7, 18, 27], 77), hits("E3", [0], 44)],
          [[None] * 7 + [8], [2, None, None, 7, 1, 5, 6, 4] * 2,
           [None] * 4, [1, 5, 6, 7, 1, 5, 6, 4] * 2, [None] * 8,
           [1, 5, 6, 4, 1, None, 6, 7] * 2, [2, None, 6, 7, None, None, 8, None], [None] * 8])

    track("03 · Cloud cover", 3,
          [harmony("E3", "min", 51), harmony("C3", "maj", 47), harmony("A2", "min", 49),
           harmony("B2", "sus4", 49), harmony("E3", "min7", 37),
           harmony("C3", "maj7", 39), harmony("G2", "maj7", 38), harmony("E3", "sus2", 32)],
          [[5, None, 8, None, 1, None, 4, None], identity * 4, [None] * 4,
           identity * 4, [None] * 8,
           [1, None, 3, 4, 1, None, 3, None] * 2,
           [1, None, 3, 4, 5, None, 8, None], [5, None, None, None, None, None, None, None]])

    lead = [
        line([(2, "E4", 2, 86), (8, "G4", 3, 76), (14, "F#4", 2, 81), (20, "B4", 8, 84)]),
        line([(0, "A4", 4, 82), (6, "G4", 4, 78), (12, "F#4", 3, 85), (22, "E4", 6, 75)]),
        line([(2, "G4", 4, 79), (8, "B4", 4, 83), (16, "A4", 3, 78), (24, "G4", 6, 72)]),
        line([(2, "E4", 4, 77), (8, "A4", 4, 82), (16, "G4", 3, 75), (24, "E4", 6, 72)]),
        line([(0, "F#4", 4, 82), (8, "E4", 3, 76), (14, "B3", 4, 78), (22, "F#4", 8, 83)]),
        line([(2, "E5", 2, 85), (8, "G5", 3, 78), (14, "F#5", 2, 82), (20, "B4", 8, 81)]),
        line([(8, "E4", 8, 54), (24, "B4", 6, 48)]),
        line([(4, "G4", 8, 54), (16, "F#4", 4, 49), (24, "E4", 6, 46)]),
    ]
    track("04 · Summer remembered", 4, lead,
          [[None, None, 7, None, None, None, 8, None],
           [1, 3, 4, 5, 2, None, 4, 5, 1, 3, 4, 5, 2, 3, None, 5],
           [None] * 4,
           [1, 3, 4, 5, 2, 3, 4, 5, 6, 3, 4, 5, 2, None, 4, 5],
           [None, None, 7, None, None, None, 8, None],
           [6, 3, 4, 5, 2, 3, 4, None, 1, 3, 4, 5, 2, None, 8, None],
           [1, None, 4, 5, 8, None, 7, None], [8, None, None, None, None, None, None, None]])

    track("05 · Sun through the clouds", 5,
          [harmony("C3", "maj7", 71), harmony("G3", "maj7", 68), harmony("E3", "min7", 63),
           harmony("B2", "sus4", 62), harmony("C3", "maj7", 54), harmony("G3", "maj7", 51),
           harmony("E3", "min7", 48), harmony("E3", "min7", 37, 31)],
          [[None] * 8, [None] * 16, [1, 2, 1, 2], [None] * 16,
           [1, 2, 1, 2, 1, 2, 3, 4],
           [None, 5, None, None, None, 5, None, None, 3, 5, None, 4, 3, 5, None, None],
           [None, 5, None, None, 7, 5, 6, 7], [5, 6, 7, None, 7, 8, None, None]])

    track("06 · Warm answers", 6,
          [line([(8, "E4", 6, 70), (20, "G4", 8, 65)]),
           line([(8, "D4", 6, 67), (20, "B3", 8, 64)]),
           pad(event(8, "C4", 10, 58, "maj")), pad(event(12, "G3", 10, 59, "maj")),
           line([(0, "E4", 6, 65), (8, "G4", 6, 62), (16, "F#4", 6, 60), (24, "B4", 6, 63)]),
           line([(0, "D4", 6, 64), (8, "B3", 6, 61), (16, "A3", 6, 58), (24, "G3", 6, 57)]),
           line([(12, "E4", 16, 42)]), pad(event(8, "G3", 16, 38, "maj"))],
          [[None] * 8, [None] * 16, [1, 2, 3, 4], [None] * 16,
           [1, 2, 5, 6, 3, 4, 7, None],
           [None] * 4 + [None, 1, None, None] + [None, 3, None, None] + [None, 1, None, None],
           [None, 1, None, None, 7, None, 8, None], [7, 8, 7, None, None, None, None, None]])

    track("07 · Remaining light", 7,
          [line([(6, "E5", 8, 53), (22, "B4", 8, 44)]),
           line([(10, "D5", 8, 50), (26, "F#5", 5, 42)]),
           line([(12, "B4", 12, 46)]), line([(20, "F#5", 8, 42)]),
           line([(4, "G5", 10, 48), (22, "E5", 8, 43)]),
           line([(12, "D5", 12, 39)]), line([(8, "F#5", 16, 34)]),
           line([(20, "F#5", 10, 29)])],
          [[None] * 8, [None] * 16, [1, 2, None, 2], [None] * 16,
           [1, 2, 5, 2, 1, 2, 3, 4],
           [None] * 8 + [None, 1, None, 4, None, 1, None, None],
           [None] * 4 + [3, None, 6, None], [1, 6, 3, None, 7, 8, None, None]])

    track("08 · Weather fronts", 8,
          [line([(0, "E3", 30, 28)]), line([(0, "B3", 30, 34)]),
           line([(16, "E4", 14, 38)]), line([(0, "E3", 30, 20)])],
          [[1, 4, None, 1, None, None, None, 2],
           [None] * 7 + [3] + [None] * 7 + [2], [None] * 4,
           [None] * 7 + [3] + [None] * 7 + [2], [None] * 7 + [4],
           [None] * 7 + [3] + [None] * 8, [None, None, None, 4, None, None, None, None], [None] * 8])

    drum_sections = [[None, None, 1, 1, 2, 2, 3, 5],
                     [3, 3, 3, 5, 3, 3, 4, 5] * 2,
                     [6, 7, 6, 7], [3, 3, 4, 5, 4, 4, 4, 5] * 2,
                     [6, 7, 7, 7, 6, 7, 6, 2],
                     [4, 4, 4, 5, 3, 4, 4, 5] * 2,
                     [3, 3, 3, 5, 6, 6, 7, 8], [None] * 8]
    # Reuse the same phrase hierarchy for drums, then install the custom cells.
    track("09 · Analog machinery", 10, [pad(event(0, "C2"))], drum_sections)
    scores[-1].update(type="drummer", pads=[{"pad": i + 1, "groove": "sparse", "length_beats": 8}
                                           for i in range(8)])
    return {"version": 1, "title": TITLE, "tempo": 112, "key": "E", "mode": "aeolian", "tracks": scores}


def drum_patterns():
    def hats(positions, level):
        return [[s, level + (8 if s % 4 == 2 else -5)] for s in positions]
    base = {36: [[0, 108], [8, 99], [16, 106], [24, 101]],
            38: [[4, 102], [12, 105], [20, 101], [28, 108]],
            42: hats([s for s in range(0, 32, 2) if s not in (14, 30)], 64),
            46: [[14, 52], [30, 57]]}
    drive = copy.deepcopy(base)
    drive[36] += [[23, 69]]
    drive[42] += [[7, 40], [15, 43], [27, 44], [31, 40]]
    drive[38] += [[19, 43]]
    fill = copy.deepcopy(base)
    fill[38] += [[26, 65], [30, 80], [31, 49]]
    return [
        {42: hats(range(0, 32, 4), 47)},
        {36: [[0, 85], [16, 88]], 38: [[12, 77], [28, 81]], 42: hats(range(2, 32, 4), 52)},
        base, drive, fill,
        {35: [[0, 83], [16, 77]], 38: [[12, 54], [28, 57]], 42: hats([4, 12, 20, 28], 39)},
        {35: [[0, 66]], 42: hats([6, 14, 22, 30], 29)},
        {35: [[0, 52]], 42: [[4, 30], [12, 25]]},
    ]


def stage():
    client = cli.ApiClient(cli.DEFAULT_API_URL, timeout=120)
    patches = client.get("/patches")
    performances = client.get("/performances")
    if not (HERE / "work/library_before.json").exists():
        dump(HERE / "work/library_before.json", {"patches": patches, "performances": performances})
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    if any(p["name"] == TITLE and p["id"] != manifest.get("performanceId") for p in performances):
        raise RuntimeError("An unowned performance already has this title; refusing to overwrite it.")
    command("edit", "begin", "--new", "--name", TITLE, "--tempo", 112, "--description", DESCRIPTION)
    for binding, name, channel, gain, balance, controls in RACK:
        command("edit", "add-instrument", "--patch", name, "--channel", channel, "--binding-id", binding)
    dump(HERE / "validation/instrument_discovery.json", command("edit", "instruments", "list"))
    for binding, name, channel, gain, balance, controls in RACK:
        command("edit", "mixer", "strip", "set", "--binding", binding, "--gain-db", gain, "--balance", balance)
        for key, value in controls.items():
            command("edit", "performance-controllers", "set", "--binding", binding, "--node", "ctl_" + key, "--value", value)
    command("edit", "mixer", "strip", "set", "--binding", "$master", "--gain-db", -4)
    score = make_score()
    dump(HERE / "score.json", score)
    command("edit", "apply-score", HERE / "score.json")
    session = cli.load_edit_session(SESSION)
    config = session["config"]
    session["performanceId"] = manifest.get("performanceId")
    by_id = {p["id"]: p for p in patches}
    for binding in config["instruments"]:
        for port in ("left", "right"):
            route = cli.add_effect_route_to_config(config, by_id, source_id=binding["id"], channel=port,
                                                   target_id="$master", target_port=port, kind="main")
            route["id"] = binding["id"] + "-to-master-" + port
    # The current score parser ignores per-event velocity: apply it explicitly.
    for source, target in zip(score["tracks"][:-1], config["sequencer"]["tracks"]):
        for index, source_pad in enumerate(source["pads"]):
            for note in source_pad["events"]:
                target["pads"][index]["steps"][note["at_step"]]["velocity"] = note["velocity"]
    drums = config["sequencer"]["drummerTracks"][0]
    drums["rows"] = [{"id": f"key-{key}", "key": key} for key in (35, 36, 38, 42, 46)]
    drums["pads"] = []
    for pattern in drum_patterns():
        drum_pad = cli.default_drummer_pad(drums["rows"], length_beats=8, timing=drums["timing"])
        for row in drum_pad["rows"]:
            for at, velocity in pattern.get(int(row["rowId"][4:]), []):
                row["steps"][at] = {"active": True, "velocity": velocity}
        drums["pads"].append(drum_pad)
    dump(HERE / "drum_patterns.json", drum_patterns())
    cli.save_edit_session(SESSION, session)
    result = command("edit", "validate")
    dump(HERE / "validation/routing.json", result)
    print(json.dumps({"staged": TITLE, "instruments": len(config["instruments"]), "tracks": 9, "bars": 168}))


def bundle(session, client):
    config = copy.deepcopy(session["config"])
    definitions = []
    for binding in config["instruments"]:
        p = client.get("/patches/" + binding["patchId"])
        definitions.append({"sourcePatchId": p["id"], "name": p["name"], "description": p["description"],
                            "isTemplate": p["is_template"], "alwaysOn": p["always_on"],
                            "instrumentType": p["instrument_type"], "schema_version": p["schema_version"], "graph": p["graph"]})
    config["patchDefinitions"] = definitions
    return {"format": "orchestron.performance", "version": 1, "exported_at": cli.now_iso(),
            "performance": {"name": TITLE, "description": DESCRIPTION, "config": config}, "patch_definitions": definitions}


def export(publish=False):
    client = cli.ApiClient(cli.DEFAULT_API_URL, timeout=120)
    session = cli.load_edit_session(SESSION)
    native = bundle(session, client)
    session["config"] = native["performance"]["config"]
    runtime = cli.build_runtime_config(session["config"])
    durations = []
    for track in runtime["tracks"]:
        lengths = {p["pad_index"]: p["length_beats"] for p in track["pads"]}
        duration = sum(lengths[p] if p >= 0 else -p for p in track["pad_loop_sequence"])
        assert duration == 672, (track["track_id"], duration)
        assert not track["pad_loop_repeat"] and track["enabled"]
        durations.append({"track": track["track_id"], "beats": duration})
    assert runtime["playback_end_step"] == 5376 and not runtime["playback_loop"]
    dump(HERE / "validation/structure.json", {"duration_seconds": 360, "bars": 168, "tracks": durations})
    dump(HERE / "work/runtime.json", runtime)
    render_digest = sound_digest(native, runtime)
    cli.save_edit_session(SESSION, session)
    command("edit", "validate")
    if publish:
        checks = json.loads((HERE / "validation/audio.json").read_text())
        assert checks["render_digest"] == render_digest, "Render and validate the current draft before publishing"
        assert checks["midiFile"]["clipped_samples"] == checks["score"]["clipped_samples"] == 0
        result = command("edit", "commit")
        session = cli.load_edit_session(SESSION)
        # Preserve explicit instrument types in the embedded native definitions.
        session["config"]["patchDefinitions"] = native["patch_definitions"]
        saved = client.put("/performances/" + session["performanceId"],
                           {"config": session["config"]})
        session["config"] = saved["config"]
        cli.save_edit_session(SESSION, session)
        native["performance"]["config"] = saved["config"]
        dump(MANIFEST, {"performanceId": saved["id"], "name": TITLE,
                        "patchIds": {b["id"]: b["patchId"] for b in saved["config"]["instruments"]}})
        print(json.dumps(result), flush=True)
    exported = client.post("/bundles/export/performance", native)
    path = HERE / "The_End_of_the_Summer.orch.json"
    dump(path, exported)
    expanded = client.upload_bundle(path)
    # The expand endpoint wraps its decoded result in `payload`.
    expanded = expanded.get("payload", expanded)
    assert expanded == exported, "Native round trip changed the bundle"
    dump(HERE / "validation/roundtrip.json", {"equal": True,
          "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "instrument_types_preserved": True})
    for mode in ("midiFile", "score"):
        payload = {"performanceExport": native, "sequencerConfig": runtime, "eventSource": mode}
        req = request.Request(cli.DEFAULT_API_URL + "/bundles/export/performance-csd",
                              data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with request.urlopen(req, timeout=180) as response:
            archive = response.read()
        target = HERE / "exports" / ("midi.zip" if mode == "midiFile" else "score.zip")
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(archive)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            destination = HERE / "work" / mode
            destination.mkdir(parents=True, exist_ok=True)
            for info in z.infolist():
                resolved = (destination / info.filename).resolve()
                assert resolved.is_relative_to(destination.resolve())
            z.extractall(destination)
        print(json.dumps({"exported": mode, "bytes": len(archive)}), flush=True)
    dump(HERE / "work/render_context.json", {"render_digest": render_digest})
    before = json.loads((HERE / "work/library_before.json").read_text())
    patches = {p["id"]: p for p in client.get("/patches")}
    performances = {p["id"]: p for p in client.get("/performances")}
    assert all(patches[p["id"]] == p for p in before["patches"])
    assert all(performances[p["id"]] == p for p in before["performances"]
               if p["id"] != session.get("performanceId"))
    dump(HERE / "validation/preservation.json", {"existing_patches_unchanged": len(before["patches"]),
          "existing_performances_unchanged": len(before["performances"])})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("stage", "export", "publish"))
    args = parser.parse_args()
    if args.action == "stage":
        stage()
    else:
        export(publish=args.action == "publish")
