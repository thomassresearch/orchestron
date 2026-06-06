#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys


SKILL_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = SKILL_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from orchestron.cli.orchestron_cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())

