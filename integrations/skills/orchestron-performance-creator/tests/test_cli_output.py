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
    DIRECT_OUT_SEND_GAIN_EXPRESSION,
    OrchestronCliError,
    add_effect_route_to_config,
    canonical_runtime_assignments,
    clear_effect_routes_for_target,
    command_edit_rebuild_runtime,
    ensure_standard_effect_matrix,
    graph_audio_port_names,
    graph_with_input_formula,
    graph_with_direct_outs_replaced_by_outletas,
    graph_without_input_formula,
    input_formula_rows,
    normalize_performance_config,
    read_input_formula_map,
    remove_effect_route_from_config,
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


def _direct_outs_graph() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "left_src", "opcode": "oscili", "params": {}, "position": {"x": 10, "y": 10}},
            {"id": "right_src", "opcode": "oscili", "params": {}, "position": {"x": 10, "y": 80}},
            {"id": "outs_1", "opcode": "outs", "params": {}, "position": {"x": 220, "y": 40}},
        ],
        "connections": [
            {"from_node_id": "left_src", "from_port_id": "aout", "to_node_id": "outs_1", "to_port_id": "left"},
            {"from_node_id": "right_src", "from_port_id": "aout", "to_node_id": "outs_1", "to_port_id": "right"},
        ],
        "ui_layout": {},
        "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
    }


def _routing_graph(*, inlets: tuple[str, ...] = (), outlets: tuple[str, ...] = ()) -> dict[str, object]:
    nodes = []
    for index, label in enumerate(inlets):
        nodes.append({"id": f"in_{label}", "opcode": "inleta", "params": {"sname": label}, "position": {"x": 0, "y": index * 80}})
    for index, label in enumerate(outlets):
        nodes.append({"id": f"out_{label}", "opcode": "outleta", "params": {"sname": label}, "position": {"x": 260, "y": index * 80}})
    return {
        "nodes": nodes,
        "connections": [],
        "ui_layout": {},
        "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
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


def test_direct_outs_graph_is_replaced_by_dry_and_send_outletas() -> None:
    graph, converted = graph_with_direct_outs_replaced_by_outletas(_direct_outs_graph())

    assert converted is True
    assert "outs" not in {node["opcode"] for node in graph["nodes"]}
    assert graph_audio_port_names(graph, opcode="outleta") == ["dryl", "dryr", "sendl", "sendr"]

    outleta_by_label = {node["params"]["sname"]: node["id"] for node in graph["nodes"] if node["opcode"] == "outleta"}
    formulas = read_input_formula_map(graph["ui_layout"])
    for label in ("sendl", "sendr"):
        formula = formulas[f"{outleta_by_label[label]}::asignal"]
        assert formula["expression"] == DIRECT_OUT_SEND_GAIN_EXPRESSION
        assert formula["inputs"][0]["token"] == "in1"
    assert formulas[f"{outleta_by_label['sendl']}::asignal"]["inputs"][0]["from_node_id"] == "left_src"
    assert formulas[f"{outleta_by_label['sendr']}::asignal"]["inputs"][0]["from_node_id"] == "right_src"


def test_standard_effect_matrix_converts_direct_outputs_and_routes_chain() -> None:
    patches = {
        "lead": {
            "id": "lead",
            "name": "Lead",
            "description": "",
            "schema_version": 1,
            "graph": _direct_outs_graph(),
            "always_on": False,
        },
        "reverb": {
            "id": "reverb",
            "name": "reverb effect",
            "description": "",
            "schema_version": 1,
            "graph": _routing_graph(inlets=("left", "right"), outlets=("left", "right")),
            "always_on": True,
        },
        "compressor": {
            "id": "compressor",
            "name": "compressor effect",
            "description": "",
            "schema_version": 1,
            "graph": _routing_graph(inlets=("left", "right"), outlets=("left", "right")),
            "always_on": True,
        },
        "speaker": {
            "id": "speaker",
            "name": "speaker output",
            "description": "",
            "schema_version": 1,
            "graph": _routing_graph(inlets=("left", "right")),
            "always_on": True,
        },
    }

    class FakeApiClient:
        def get(self, path: str) -> object:
            if path == "/patches":
                return [
                    {"id": patch["id"], "name": patch["name"], "always_on": patch["always_on"]}
                    for patch in patches.values()
                ]
            if path.startswith("/patches/"):
                return patches[path.removeprefix("/patches/")]
            raise AssertionError(f"Unexpected GET {path}")

        def post(self, path: str, payload: object) -> object:
            assert path == "/patches"
            assert isinstance(payload, dict)
            patch_id = "lead-new"
            patches[patch_id] = {"id": patch_id, **payload}
            return patches[patch_id]

    config = {
        "version": 8,
        "instruments": [{"patchId": "lead", "patchName": "Lead", "midiChannel": 1, "level": 10}],
        "sequencer": {},
    }

    result = ensure_standard_effect_matrix(config, FakeApiClient())

    assert result["convertedSources"] == [{"fromPatchId": "lead", "toPatchId": "lead-new", "name": "Lead_new"}]
    source, reverb, compressor, speaker = config["instruments"]
    assert source["id"] == "instrument-1"
    assert source["patchId"] == "lead-new"
    assert reverb["patchId"] == "reverb"
    assert reverb["midiChannel"] == 0
    assert reverb["effectRoutes"] == [
        {"sourceId": "instrument-1", "channel": "sendl"},
        {"sourceId": "instrument-1", "channel": "sendr"},
    ]
    assert compressor["effectRoutes"] == [
        {"sourceId": "instrument-1", "channel": "dryl"},
        {"sourceId": "instrument-1", "channel": "dryr"},
        {"sourceId": "standard-reverb-effect", "channel": "left"},
        {"sourceId": "standard-reverb-effect", "channel": "right"},
    ]
    assert speaker["effectRoutes"] == [
        {"sourceId": "standard-compressor-effect", "channel": "left"},
        {"sourceId": "standard-compressor-effect", "channel": "right"},
    ]

    second_result = ensure_standard_effect_matrix(config, FakeApiClient())
    assert second_result["convertedSources"] == []
    assert config["instruments"][1]["effectRoutes"] == reverb["effectRoutes"]
    assert config["instruments"][2]["effectRoutes"] == compressor["effectRoutes"]
    assert config["instruments"][3]["effectRoutes"] == speaker["effectRoutes"]


def test_version_ten_normalization_expands_legacy_effect_sources() -> None:
    patches = [
        {
            "id": "lead",
            "name": "Lead",
            "always_on": False,
            "audio_inlet_names": [],
            "audio_outlet_names": ["left", "right"],
        },
        {
            "id": "effect",
            "name": "Effect",
            "always_on": True,
            "audio_inlet_names": ["left", "right"],
            "audio_outlet_names": ["left", "right"],
        },
    ]
    config = {
        "version": 8,
        "instruments": [
            {"patchId": "lead", "midiChannel": 1},
            {"id": "effect-a", "patchId": "effect", "midiChannel": 9, "effectSourceIds": ["instrument-1"]},
        ],
        "sequencer": {},
    }

    normalize_performance_config(config, patches)

    assert config["version"] == 10
    assert config["instruments"][0]["id"] == "instrument-1"
    assert config["instruments"][1]["midiChannel"] == 0
    assert config["instruments"][1]["effectRoutes"] == [
        {"sourceId": "instrument-1", "channel": "left"},
        {"sourceId": "instrument-1", "channel": "right"},
    ]


def test_general_effect_routes_support_chains_and_reject_cycles() -> None:
    patches = {
        "source": {
            "id": "source",
            "name": "Source",
            "always_on": False,
            "graph": _routing_graph(outlets=("left", "right")),
        },
        "effect-a": {
            "id": "effect-a",
            "name": "Effect A",
            "always_on": True,
            "graph": _routing_graph(inlets=("left", "right"), outlets=("left", "right")),
        },
        "effect-b": {
            "id": "effect-b",
            "name": "Effect B",
            "always_on": True,
            "graph": _routing_graph(inlets=("left", "right"), outlets=("left", "right")),
        },
    }
    config = {
        "version": 10,
        "instruments": [
            {"id": "source", "patchId": "source", "midiChannel": 1, "effectRoutes": []},
            {"id": "fx-a", "patchId": "effect-a", "midiChannel": 0, "effectRoutes": []},
            {"id": "fx-b", "patchId": "effect-b", "midiChannel": 0, "effectRoutes": []},
        ],
        "sequencer": {},
    }

    add_effect_route_to_config(
        config,
        patches,
        source_id="source",
        channel="left",
        target_id="fx-a",
    )
    add_effect_route_to_config(
        config,
        patches,
        source_id="fx-a",
        channel="right",
        target_id="fx-b",
    )

    assert config["instruments"][1]["effectSourceIds"] == ["source"]
    assert config["instruments"][2]["effectRoutes"] == [{"sourceId": "fx-a", "channel": "right"}]
    with pytest.raises(OrchestronCliError) as exc_info:
        add_effect_route_to_config(
            config,
            patches,
            source_id="fx-b",
            channel="left",
            target_id="fx-a",
        )
    assert exc_info.value.code == "effect_route_loop"

    assert remove_effect_route_from_config(
        config,
        source_id="fx-a",
        channel="right",
        target_id="fx-b",
    )
    assert clear_effect_routes_for_target(config, target_id="fx-a") == 1


def test_runtime_assignment_comparison_ignores_route_order() -> None:
    left = [
        {
            "id": "fx",
            "patch_id": "effect",
            "midi_channel": 0,
            "effect_routes": [
                {"source_id": "lead", "channel": "right"},
                {"source_id": "lead", "channel": "left"},
            ],
        }
    ]
    right = [
        {
            "id": "fx",
            "patchId": "effect",
            "midiChannel": 0,
            "effectRoutes": [
                {"sourceId": "lead", "channel": "left"},
                {"sourceId": "lead", "channel": "right"},
            ],
        }
    ]

    assert canonical_runtime_assignments(left) == canonical_runtime_assignments(right)


def test_rebuild_runtime_compiles_replacement_before_switching(tmp_path: Path, monkeypatch, capsys) -> None:
    session_file = tmp_path / "edit-session.json"
    session_file.write_text(
        json.dumps(
            {
                "name": "Runtime Test",
                "config": {
                    "version": 10,
                    "instruments": [
                        {
                            "id": "lead",
                            "patchId": "patch-1",
                            "patchName": "Lead",
                            "midiChannel": 1,
                            "level": 10,
                            "effectSourceIds": [],
                            "effectRoutes": [],
                        }
                    ],
                    "sequencer": {},
                },
                "attachedSessionId": "old-session",
                "runtimeOwnedByCli": True,
            }
        ),
        encoding="utf-8",
    )
    calls: list[tuple[str, str]] = []

    class FakeApiClient:
        def __init__(self, api_url: str, *, timeout: float = 20.0) -> None:
            self.api_url = api_url
            self.timeout = timeout

        def get(self, path: str) -> object:
            calls.append(("GET", path))
            if path == "/sessions/old-session":
                return {"session_id": "old-session", "state": "running", "instruments": []}
            if path == "/patches":
                return [{"id": "patch-1", "name": "Lead", "always_on": False}]
            raise AssertionError(f"Unexpected GET {path}")

        def post(self, path: str, payload: object | None = None) -> object:
            calls.append(("POST", path))
            if path == "/sessions/validate-instruments":
                return {"valid": True, "instruments": payload["instruments"], "resolved_routes": []}
            if path == "/sessions":
                return {"session_id": "new-session", "state": "idle"}
            if path == "/sessions/new-session/compile":
                return {"session_id": "new-session", "state": "compiled"}
            if path == "/sessions/old-session/stop":
                return {"session_id": "old-session", "state": "idle"}
            if path == "/sessions/new-session/start":
                return {"session_id": "new-session", "state": "running"}
            raise AssertionError(f"Unexpected POST {path}")

        def put(self, path: str, payload: object) -> object:
            raise AssertionError(f"Unexpected PUT {path}")

        def delete(self, path: str) -> object:
            calls.append(("DELETE", path))
            assert path == "/sessions/old-session"
            return None

    monkeypatch.setattr(orchestron_cli, "ApiClient", FakeApiClient)

    command_edit_rebuild_runtime(
        argparse.Namespace(start=None, replace_external=False),
        CliContext(
            api_url="http://localhost:8000/api",
            json_output=True,
            debug=False,
            timeout=20.0,
            session_file=session_file,
        ),
    )

    assert calls.index(("POST", "/sessions/new-session/compile")) < calls.index(
        ("POST", "/sessions/old-session/stop")
    )
    assert calls.index(("POST", "/sessions/old-session/stop")) < calls.index(
        ("POST", "/sessions/new-session/start")
    )
    assert calls[-1] == ("DELETE", "/sessions/old-session")
    saved = json.loads(session_file.read_text(encoding="utf-8"))
    assert saved["attachedSessionId"] == "new-session"
    assert saved["runtimeOwnedByCli"] is True
    assert json.loads(capsys.readouterr().out)["result"]["state"] == "running"


def test_rebuild_runtime_restores_old_session_when_replacement_start_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    session_file = tmp_path / "edit-session.json"
    original = {
        "name": "Runtime Rollback",
        "config": {
            "version": 10,
            "instruments": [
                {
                    "id": "lead",
                    "patchId": "patch-1",
                    "patchName": "Lead",
                    "midiChannel": 1,
                    "level": 10,
                    "effectSourceIds": [],
                    "effectRoutes": [],
                }
            ],
            "sequencer": {},
        },
        "attachedSessionId": "old-session",
        "runtimeOwnedByCli": True,
    }
    session_file.write_text(json.dumps(original), encoding="utf-8")
    calls: list[tuple[str, str]] = []

    class FakeApiClient:
        def __init__(self, api_url: str, *, timeout: float = 20.0) -> None:
            self.api_url = api_url
            self.timeout = timeout

        def get(self, path: str) -> object:
            if path == "/sessions/old-session":
                return {"session_id": "old-session", "state": "running", "instruments": []}
            if path == "/patches":
                return [{"id": "patch-1", "name": "Lead", "always_on": False}]
            raise AssertionError(f"Unexpected GET {path}")

        def post(self, path: str, payload: object | None = None) -> object:
            calls.append(("POST", path))
            if path == "/sessions/validate-instruments":
                return {"valid": True, "instruments": payload["instruments"], "resolved_routes": []}
            if path == "/sessions":
                return {"session_id": "new-session", "state": "idle"}
            if path == "/sessions/new-session/compile":
                return {"session_id": "new-session", "state": "compiled"}
            if path == "/sessions/old-session/stop":
                return {"session_id": "old-session", "state": "idle"}
            if path == "/sessions/new-session/start":
                raise OrchestronCliError("runtime_start_failed", "replacement failed")
            if path == "/sessions/old-session/start":
                return {"session_id": "old-session", "state": "running"}
            raise AssertionError(f"Unexpected POST {path}")

        def put(self, path: str, payload: object) -> object:
            raise AssertionError(f"Unexpected PUT {path}")

        def delete(self, path: str) -> object:
            calls.append(("DELETE", path))
            assert path == "/sessions/new-session"
            return None

    monkeypatch.setattr(orchestron_cli, "ApiClient", FakeApiClient)

    with pytest.raises(OrchestronCliError) as exc_info:
        command_edit_rebuild_runtime(
            argparse.Namespace(start=None, replace_external=False),
            CliContext(
                api_url="http://localhost:8000/api",
                json_output=True,
                debug=False,
                timeout=20.0,
                session_file=session_file,
            ),
        )

    assert exc_info.value.code == "runtime_start_failed"
    assert ("POST", "/sessions/old-session/start") in calls
    assert calls[-1] == ("DELETE", "/sessions/new-session")
    saved = json.loads(session_file.read_text(encoding="utf-8"))
    assert saved["attachedSessionId"] == "old-session"


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
