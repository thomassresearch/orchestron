from __future__ import annotations

import json
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from orchestron.cli import orchestron_cli  # noqa: E402
from orchestron.cli.orchestron_cli import CliContext, print_table  # noqa: E402


def _ctx(*, json_output: bool = False) -> CliContext:
    return CliContext(
        api_url="http://localhost:8000/api",
        json_output=json_output,
        debug=False,
        timeout=20.0,
        session_file=Path("edit-session.json"),
    )


def test_print_table_wraps_patch_description_detail(capsys, monkeypatch) -> None:
    monkeypatch.setattr(
        orchestron_cli.shutil,
        "get_terminal_size",
        lambda fallback=(100, 24): orchestron_cli.os.terminal_size((60, 24)),
    )
    description = " ".join(f"word{i}" for i in range(30))

    print_table(
        [
            {
                "id": "patch-1",
                "name": "Lead",
                "schema_version": 1,
                "updated_at": "2026-06-07T12:00:00Z",
                "description": description,
            }
        ],
        [("id", "ID"), ("name", "Name"), ("schema_version", "Schema"), ("updated_at", "Updated")],
        _ctx(),
        detail_columns=[("description", "Description")],
    )

    output = capsys.readouterr().out
    assert "Description:" in output
    assert description not in output
    assert output.replace("\n", " ").count("word") == 30
    for line in output.splitlines():
        if "Description:" in line or line.startswith(" " * len("  Description: ")):
            assert len(line) <= 60


def test_print_table_json_output_keeps_full_patch_description(capsys) -> None:
    description = "x" * 2048
    rows = [
        {
            "id": "patch-1",
            "name": "Lead",
            "schema_version": 1,
            "updated_at": "2026-06-07T12:00:00Z",
            "description": description,
        }
    ]

    print_table(
        rows,
        [("id", "ID"), ("name", "Name")],
        _ctx(json_output=True),
        detail_columns=[("description", "Description")],
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload == {"ok": True, "result": rows}
