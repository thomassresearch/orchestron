from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from orchestron.cli import orchestron_cli  # noqa: E402
from orchestron.cli.orchestron_cli import (  # noqa: E402
    CliContext,
    OrchestronCliError,
    graph_with_input_formula,
    graph_without_input_formula,
    input_formula_rows,
    print_table,
)


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


def _formula_graph() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "c1", "opcode": "const_k", "params": {"value": 0.8}, "position": {"x": 40, "y": 40}},
            {"id": "c2", "opcode": "const_k", "params": {"value": 0.4}, "position": {"x": 40, "y": 140}},
            {"id": "m1", "opcode": "k_mul", "params": {}, "position": {"x": 240, "y": 90}},
        ],
        "connections": [
            {"from_node_id": "c1", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
            {"from_node_id": "c2", "from_port_id": "kout", "to_node_id": "m1", "to_port_id": "a"},
        ],
        "ui_layout": {},
        "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
    }


def _k_mul_spec() -> dict[str, object]:
    return {
        "name": "k_mul",
        "inputs": [
            {"id": "a", "name": "A"},
            {"id": "b", "name": "B"},
        ],
    }


def test_graph_input_formula_auto_binds_inbound_connections_for_scaling() -> None:
    graph, formula = graph_with_input_formula(
        _formula_graph(),
        target_node_id="m1",
        target_port_id="a",
        expression="0.1 * in1",
        assignments=[],
        target_opcode_spec=_k_mul_spec(),
    )

    assert formula == {
        "expression": "0.1 * in1",
        "inputs": [
            {"token": "in1", "from_node_id": "c1", "from_port_id": "kout"},
            {"token": "in2", "from_node_id": "c2", "from_port_id": "kout"},
        ],
    }
    assert graph["ui_layout"]["input_formulas"]["m1::a"] == formula


def test_graph_input_formula_accepts_explicit_connection_bindings() -> None:
    graph, formula = graph_with_input_formula(
        _formula_graph(),
        target_node_id="m1",
        target_port_id="a",
        expression="dry + (wet * 0.5)",
        assignments=["dry=c1.kout", "wet=c2.kout"],
        target_opcode_spec=_k_mul_spec(),
    )

    assert formula["inputs"] == [
        {"token": "dry", "from_node_id": "c1", "from_port_id": "kout"},
        {"token": "wet", "from_node_id": "c2", "from_port_id": "kout"},
    ]
    rows = input_formula_rows(graph)
    assert rows == [
        {
            "target": "m1.a",
            "target_key": "m1::a",
            "expression": "dry + (wet * 0.5)",
            "input_count": 2,
            "inputs": "dry=c1.kout, wet=c2.kout",
        }
    ]


def test_graph_input_formula_rejects_unknown_formula_token() -> None:
    with pytest.raises(OrchestronCliError) as exc_info:
        graph_with_input_formula(
            _formula_graph(),
            target_node_id="m1",
            target_port_id="a",
            expression="in1 + in9",
            assignments=[],
            target_opcode_spec=_k_mul_spec(),
        )

    assert exc_info.value.code == "invalid_formula"
    assert "in9" in exc_info.value.message
    assert exc_info.value.retry


def test_graph_input_formula_clear_removes_empty_formula_layout() -> None:
    graph, _formula = graph_with_input_formula(
        _formula_graph(),
        target_node_id="m1",
        target_port_id="a",
        expression="0.1 * in1",
        assignments=[],
        target_opcode_spec=_k_mul_spec(),
    )

    cleared, existed = graph_without_input_formula(graph, target_node_id="m1", target_port_id="a")

    assert existed is True
    assert "input_formulas" not in cleared["ui_layout"]


def test_command_patches_formula_set_updates_patch_graph(monkeypatch, capsys) -> None:
    patch = {
        "id": "patch-1",
        "name": "Lead Patch",
        "description": "",
        "schema_version": 1,
        "graph": _formula_graph(),
    }
    put_call: dict[str, object] = {}

    class FakeApiClient:
        def __init__(self, api_url: str, *, timeout: float = 20.0) -> None:
            self.api_url = api_url
            self.timeout = timeout

        def get(self, path: str) -> object:
            if path == "/patches":
                return [{"id": "patch-1", "name": "Lead Patch"}]
            if path == "/patches/patch-1":
                return patch
            if path == "/opcodes/k_mul":
                return _k_mul_spec()
            raise AssertionError(f"Unexpected GET {path}")

        def put(self, path: str, payload: object) -> object:
            put_call["path"] = path
            put_call["payload"] = payload
            assert isinstance(payload, dict)
            return {"id": "patch-1", "name": payload["name"], "graph": payload["graph"]}

    monkeypatch.setattr(orchestron_cli, "ApiClient", FakeApiClient)

    orchestron_cli.command_patches_formula_set(
        argparse.Namespace(patch="Lead Patch", target="m1.a", expression="0.1 * in1", input=[]),
        _ctx(json_output=True),
    )

    result = json.loads(capsys.readouterr().out)["result"]
    saved_payload = put_call["payload"]
    assert put_call["path"] == "/patches/patch-1"
    assert saved_payload["graph"]["ui_layout"]["input_formulas"]["m1::a"]["expression"] == "0.1 * in1"
    assert result["targetKey"] == "m1::a"
    assert result["inputs"][0] == {"token": "in1", "from_node_id": "c1", "from_port_id": "kout"}
