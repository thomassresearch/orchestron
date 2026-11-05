"""Run documented agent commands against an isolated backend and extracted skill.

The caller supplies a versioned test patch and a disposable backend. This script
never imports the client, backend, or repository implementation.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    for flag in ("cli", "skill", "work", "api", "patch"):
        parser.add_argument("--" + flag, required=True)
    args = parser.parse_args()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    skill = Path(args.skill).resolve()
    transcript = []
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "ORCHESTRON_API_URL")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"

    def call(*parts, expect=0):
        started = time.perf_counter()
        result = subprocess.run(
            [
                args.cli,
                "--json",
                "--timeout",
                "60",
                "--api-url",
                args.api,
                "--session-file",
                str(work / "draft.json"),
                *parts,
            ],
            cwd=work,
            env=env,
            capture_output=True,
            text=True,
        )
        transcript.append(
            {
                "args": parts,
                "seconds": time.perf_counter() - started,
                "returncode": result.returncode,
                "responseBytes": len(result.stdout) + len(result.stderr),
            }
        )
        (work / "transcript.json").write_text(json.dumps(transcript, indent=2) + "\n")
        assert result.returncode == expect, (parts, result.stdout, result.stderr)
        assert not (result.stderr if expect == 0 else result.stdout), (parts, result.stderr)
        parsed = json.loads(result.stdout if expect == 0 else result.stderr)
        return parsed["result"] if expect == 0 else parsed["error"]

    def operation(family, action, value, *extra, expect=0):
        path = work / f"operation-{len(transcript)}.json"
        path.write_text(json.dumps(value))
        return call("edit", family, action, "--file", str(path), *extra, expect=expect)

    # Fixture setup is outside the plugin and outside the musical authoring flow.
    patch = json.loads(Path(args.patch).read_text())
    patch.pop("id", None)
    with urlopen(
        Request(args.api + "/patches", data=json.dumps(patch).encode(), headers={"Content-Type": "application/json"}),
        timeout=60,
    ) as response:
        patch_id = json.load(response)["id"]
    call("capabilities")
    call("edit", "schema")
    call("patches", "list")
    call("edit", "begin", "--new", "--arranger", "clips", "--name", "Packaged acceptance")
    for binding, channel in [("synth", "2"), ("kit", "10")]:
        call("edit", "add-instrument", "--patch", patch_id, "--channel", channel, "--binding-id", binding)
    call("edit", "instruments", "list")
    source = str(skill / "assets/complete-song.json")
    call("edit", "apply-song", "--file", source, "--mode", "create")
    retry = call("edit", "apply-song", "--file", source, "--mode", "create")
    assert retry["state"]["changed"] is False
    summary = call("edit", "inspect")
    assert summary["counts"]["patterns"] == 3
    operation(
        "sections",
        "paste",
        {"lanes": ["bass", "drums"], "from": "0b", "length": "128b", "at": "128b", "mode": "overwrite"},
    )
    clips = call("edit", "inspect", "--view", "clips", "--lane", "bass")["items"]
    later = sorted(clips, key=lambda c: c["start"])[-1]
    target = call("edit", "inspect", "--view", "tree", "--lane", "bass", "--clip", later["id"])["items"][0]["target"]
    changed = operation(
        "transpose",
        "put",
        {"target": target, "scope": "placement", "offset": {"diatonicSteps": 0, "chromaticSemitones": 12}},
    )
    assert changed["patternsCreated"] == 0
    target = call("edit", "inspect", "--view", "tree", "--lane", "bass", "--clip", later["id"])["items"][0]["target"]
    (work / "target.json").write_text(json.dumps(target))
    variation = operation(
        "patterns",
        "edit",
        {"music": {"lengthBeats": 8, "steps": "s0=C3/2s s2=G3/2s"}},
        "--target",
        str(work / "target.json"),
        "--scope",
        "local",
    )
    assert variation["changes"]["patterns"] == 1
    controllers = call("edit", "automation", "list", "--instrument", "synth")["controllers"]
    node = controllers[0]["node_id"]
    operation("automation", "map", {"instrumentId": "synth", "mappings": {node: 10}})
    generated = operation(
        "automation", "generate", {"instrumentId": "synth", "id": "sweep", "start": 0, "length": "512b"}
    )
    owned = generated["targets"][0]
    operation(
        "automation",
        "curve",
        {
            "laneId": owned["laneId"],
            "definitionId": owned["definitionId"],
            "duration": "512b",
            "points": [{"position": 0, "value": 20}, {"position": 1, "value": 110}],
        },
    )
    rejected = operation(
        "clips",
        "put",
        {"id": "collision", "start": 0, "length": "1b", "children": ["bass-main"]},
        "--lane",
        "bass",
        expect=1,
    )
    assert rejected["code"] == "collision"
    operation(
        "clips",
        "put",
        {"id": "new-ending", "start": "512b", "length": "1b", "children": ["bass-main"]},
        "--lane",
        "bass",
    )
    call("edit", "undo")
    call("edit", "redo")
    call("edit", "validate")
    saved = call("edit", "commit")
    call("edit", "begin", "--performance", saved["performanceId"])
    bass = call("edit", "inspect", "--view", "clips", "--lane", "bass")["items"][0]
    target = call("edit", "inspect", "--view", "tree", "--lane", "bass", "--clip", bass["id"])["items"][0]["target"]
    grouped = operation(
        "structure",
        "edit",
        {
            "laneId": "bass",
            "clipId": bass["id"],
            "pass": 0,
            "command": {
                "kind": "group-repetitions",
                "range": {"first": {"pass": 0, "id": target["path"][0]}, "last": {"pass": 1, "id": target["path"][0]}},
            },
        },
    )
    assert grouped["materializedRepetitions"]
    call("edit", "validate")
    call("edit", "commit")
    runtime = call("edit", "create-runtime", "--start")
    call("edit", "push-runtime")
    target = call("edit", "inspect", "--view", "tree", "--lane", "bass", "--clip", bass["id"])["items"][0]["target"]
    (work / "target.json").write_text(json.dumps(target))
    call("edit", "audition", "start", "--target", str(work / "target.json"))
    call("edit", "audition", "status")
    call("edit", "audition", "stop")
    for mode in ("native", "midi", "score"):
        call("edit", "export", "--mode", mode, "--output", str(work / (mode + ".orch.zip")))
    summary = call("edit", "inspect")
    report = {
        "commands": len(transcript),
        "runtimeId": runtime["sessionId"],
        "summary": summary,
        "maxResponseBytes": max(t["responseBytes"] for t in transcript),
        "manualConfigRepairs": 0,
    }
    (work / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
