"""Run every backend test module in a fresh process to isolate native Csound state.

Native libraries retain process-global state beyond cleanup/reset. In particular,
the Altamax then Ambient Techno DSP modules can crash Csound 6 when run together.
Keep all assertions, report every failed/crashed module, and never retry failures.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


def run_modules(paths):
    failed = []
    for path in paths:
        print(f"\n=== Playback tests: {path} ===", flush=True)
        result = subprocess.run([sys.executable, "-X", "faulthandler", "-m", "pytest",
                                 str(path), "-vv", "--durations=10"], check=False)
        if result.returncode:
            failed.append((str(path), result.returncode))
    for path, code in failed:
        print(f"FAILED module {path}: process exit {code}", flush=True)
    return int(bool(failed))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path)
    args = parser.parse_args()
    paths = args.paths or sorted(Path("backend/tests").rglob("test_*.py"))
    if not paths:
        parser.error("No test modules found")
    return run_modules(paths)


if __name__ == "__main__":
    raise SystemExit(main())
