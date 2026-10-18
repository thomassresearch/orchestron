#!/usr/bin/env python3
"""Start the original two-bar study, render its seed, and stop for the user's selection."""

import argparse
import json
from pathlib import Path

from orchestron_composition import session
from orchestron_composition.cli import asset_path, render_candidates
from orchestron_composition.trace import Recorder


def start(directory: Path, soundfont: str | None = None) -> dict:
    score = session.read_json(asset_path("motif-study/seed.json"))
    session.create(
        directory,
        {**{k: score[k] for k in ("title", "tempo", "key", "mode", "meter")}, "bars": 2, "low": 60, "high": 81},
        42,
    )
    recorder = Recorder()
    recorder.authored(
        "Load the original Looking forward teaching motif.",
        inputs=score,
        output=score,
        parameters={"source": "assets/motif-study/seed.json", "license": "repository MIT license"},
    )
    identity = session.import_candidate(directory, score, trace=recorder.finish(score))
    render_candidates(directory, [identity], soundfont)
    return {
        "session": str(directory),
        "candidate": identity,
        "next": "Serve this session and wait for the user's selection before comparing endings at 4 qn.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--soundfont")
    args = parser.parse_args()
    print(json.dumps(start(args.directory.resolve(), args.soundfont)))
