from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
SCRIPT = ROOT / "scripts" / "orchestron_patch_cli.py"
sys.path.insert(0, str(SRC))

from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    PatchCliError, SUPPORTED_FAMILIES, apply_input_formulas, build_patch_payload, validate_graph_invariants,
)


class PatchCliTests(unittest.TestCase):
    def test_formula_edit_preserves_branch_ownership_and_layout(self) -> None:
        # Keep the skill tests portable when deployed outside the repository.
        graph = {
            "nodes": [{"id": "kick", "opcode": "oscili"}, {"id": "kick_result", "opcode": "CaseResult"}],
            "connections": [{"from_node_id": "kick", "from_port_id": "asig", "to_node_id": "kick_result", "to_port_id": "left"}],
            "control_flow": {"blocks": [{"id": "drums", "cases": [{"id": "kick_case", "node_ids": ["kick", "kick_result"]}]}]},
            "ui_layout": {"control_flow_blocks": {"drums": {"collapsed": True}}},
        }
        edited = apply_input_formulas(graph, [{"target":"kick_result.left", "expression":"in1 * 0.5"}])
        self.assertEqual(edited["control_flow"], graph["control_flow"])
        self.assertEqual(edited["nodes"], graph["nodes"])
        self.assertEqual(edited["ui_layout"]["control_flow_blocks"], graph["ui_layout"]["control_flow_blocks"])

    def test_help_mentions_core_workflow(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "-h"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertIn("Create Orchestron Instrument Design patches", result.stdout)
        self.assertIn("cpsmidi", result.stdout)
        self.assertIn("input formulas", result.stdout)
        self.assertIn("patch create", result.stdout)

    def test_fm_pad_graph_has_required_spine_and_stereo_output(self) -> None:
        payload = build_patch_payload(
            {
                "name": "Unit FM Pad",
                "family": "fm_pad",
                "envelope": {"attack": 1.0, "decay": 1.5, "sustain": 0.8, "release": 3.0},
                "effects": [
                    {"opcode": "moogladder2", "cutoff": 4200, "resonance": 0.2},
                    {"opcode": "reverb2", "time": 2.5, "damping": 5000},
                ],
            }
        )
        graph = payload["graph"]
        opcodes = [node["opcode"] for node in graph["nodes"]]

        self.assertIn("cpsmidi", opcodes)
        self.assertIn("ampmidi", opcodes)
        self.assertIn("madsr", opcodes)
        self.assertIn("pan2", opcodes)
        self.assertNotIn("outs", opcodes)
        self.assertNotIn("__stereo_output", opcodes)
        self.assertEqual(opcodes.count("outleta"), 2)

        nodes_by_id = {node["id"]: node for node in graph["nodes"]}
        self.assertEqual(nodes_by_id["velocity_ampmidi"]["params"], {})
        self.assertEqual(nodes_by_id["amp_madsr"]["params"], {})

        const_to_amp = [
            conn
            for conn in graph["connections"]
            if conn["to_node_id"] == "velocity_ampmidi" and conn["to_port_id"] == "iscal"
        ]
        self.assertEqual(len(const_to_amp), 1)
        self.assertEqual(const_to_amp[0]["from_node_id"], "velocity_scale_const")
        self.assertEqual(nodes_by_id["velocity_scale_const"]["opcode"], "const_i")
        self.assertEqual(nodes_by_id["velocity_scale_const"]["params"]["value"], 1.0)

        envelope_ports = {
            conn["to_port_id"]: conn["from_node_id"]
            for conn in graph["connections"]
            if conn["to_node_id"] == "amp_madsr"
        }
        self.assertEqual(
            {key: nodes_by_id[value]["opcode"] for key, value in envelope_ports.items()},
            {"iatt": "const_i", "idec": "const_i", "islev": "const_i", "irel": "const_i"},
        )

        self.assert_stereo_output(graph)

    def assert_stereo_output(self, graph: dict) -> None:
        interface = graph["audio_interface"]
        self.assertEqual(interface["role"], "instrument")
        self.assertEqual(len(interface["groups"]), 1)
        group = interface["groups"][0]
        self.assertEqual(group["id"], interface["mainOutput"])
        self.assertEqual(group["direction"], "output")
        self.assertEqual(group["layout"], "stereo")
        self.assertEqual(group["ports"], ["left", "right"])
        self.assertTrue(graph["ui_layout"]["audio_blocks"][group["id"]])
        outlets = [node for node in graph["nodes"] if node["opcode"] == "outleta"]
        self.assertEqual(len(outlets), 2)
        self.assertEqual(graph["nodes"][-2:], outlets)
        for outlet, side in zip(outlets, group["ports"]):
            self.assertEqual(outlet["params"], {"sname": side})
            inbound = [conn for conn in graph["connections"] if conn["to_node_id"] == outlet["id"]]
            self.assertEqual(inbound, [{
                "from_node_id": "output_pan2", "from_port_id": f"a{side}",
                "to_node_id": outlet["id"], "to_port_id": "asignal",
            }])
            self.assertFalse([conn for conn in graph["connections"] if conn["from_node_id"] == outlet["id"]])

    def test_all_template_families_generate_mapped_stereo_output(self) -> None:
        for family in sorted(SUPPORTED_FAMILIES):
            with self.subTest(family=family):
                graph = build_patch_payload({"family": family})["graph"]
                self.assert_stereo_output(graph)
                self.assertNotIn("outs", [node["opcode"] for node in graph["nodes"]])

    def test_stereo_output_rejects_incomplete_or_legacy_graphs(self) -> None:
        mutations = {
            "direct outs": lambda g: g["nodes"].append({"id": "legacy", "opcode": "outs"}),
            "catalog command": lambda g: g["nodes"].append({"id": "synthetic", "opcode": "__stereo_output"}),
            "ungrouped outlets": lambda g: g.pop("audio_interface"),
            "missing main mapping": lambda g: g["audio_interface"].pop("mainOutput"),
            "reversed mapping": lambda g: g["audio_interface"]["groups"][0]["ports"].reverse(),
            "missing outlet": lambda g: g["nodes"].pop(),
            "missing audio": lambda g: g["connections"].pop(),
            "mismatched name": lambda g: g["nodes"][-1]["params"].update(sname="left"),
            "connected name": lambda g: g["connections"].append({"from_node_id": "name", "from_port_id": "sout", "to_node_id": "output_left", "to_port_id": "sname"}),
            "downstream node": lambda g: g["connections"].append({"from_node_id": "output_left", "from_port_id": "asignal", "to_node_id": "output_pan2", "to_port_id": "asig"}),
        }
        for label, mutate in mutations.items():
            with self.subTest(case=label):
                graph = build_patch_payload({"family": "simple_osc"})["graph"]
                mutate(graph)
                with self.assertRaises(PatchCliError) as error:
                    validate_graph_invariants(graph)
                self.assertEqual(error.exception.code, "invalid_graph")

    def test_output_formulas_preserve_stereo_mapping(self) -> None:
        graph = build_patch_payload({
            "family": "simple_osc",
            "formulas": [{"target": f"output_{side}.asignal", "expression": "0.5 * in1"} for side in ("left", "right")],
        })["graph"]
        self.assert_stereo_output(graph)
        for side in ("left", "right"):
            formula = graph["ui_layout"]["input_formulas"][f"output_{side}::asignal"]
            self.assertEqual(formula["expression"], "0.5 * in1")
            self.assertEqual(formula["inputs"], [{"token": "in1", "from_node_id": "output_pan2", "from_port_id": f"a{side}"}])

    def test_output_channel_name_formulas_are_rejected(self) -> None:
        with self.assertRaises(PatchCliError) as error:
            build_patch_payload({"family": "simple_osc", "formulas": [{"target": "output_left.sname", "expression": "1", "inputs": []}]})
        self.assertEqual(error.exception.code, "invalid_graph")

    def test_json_spec_validate_command(self) -> None:
        spec = {
            "name": "Unit Subtractive",
            "family": "subtractive",
            "envelope": {"attack": 0.01, "decay": 0.2, "sustain": 0.6, "release": 0.15},
            "effects": [{"opcode": "moogladder2", "cutoff": 2400, "resonance": 0.2}],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            spec_path = Path(tmpdir) / "patch.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--json", "spec", "validate", str(spec_path)],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )

        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data"]["family"], "subtractive")
        self.assertEqual(payload["data"]["last_opcode"], "outleta")
        self.assertGreater(payload["data"]["node_count"], 0)

    def test_patch_spec_formulas_are_written_to_ui_layout(self) -> None:
        payload = build_patch_payload(
            {
                "name": "Scaled Subtractive",
                "family": "subtractive",
                "layers": [{"id": "osc", "opcode": "vco2", "gain": 0.45}],
                "formulas": [
                    {
                        "target": "osc_vco2.kamp",
                        "expression": "0.1 * in1",
                    }
                ],
            }
        )

        formulas = payload["graph"]["ui_layout"]["input_formulas"]
        self.assertEqual(
            formulas["osc_vco2::kamp"],
            {
                "expression": "0.1 * in1",
                "inputs": [{"token": "in1", "from_node_id": "osc_amp", "from_port_id": "kout"}],
            },
        )

    def test_patch_spec_formulas_accept_explicit_bindings(self) -> None:
        payload = build_patch_payload(
            {
                "name": "Named Formula Binding",
                "family": "subtractive",
                "layers": [{"id": "osc", "opcode": "vco2", "gain": 0.45}],
                "formulas": {
                    "osc_vco2.kamp": {
                        "expression": "amp * 0.25",
                        "inputs": [{"token": "amp", "source": "osc_amp.kout"}],
                    }
                },
            }
        )

        formula = payload["graph"]["ui_layout"]["input_formulas"]["osc_vco2::kamp"]
        self.assertEqual(formula["expression"], "amp * 0.25")
        self.assertEqual(formula["inputs"], [{"token": "amp", "from_node_id": "osc_amp", "from_port_id": "kout"}])

    def test_patch_spec_formulas_reject_unknown_tokens(self) -> None:
        with self.assertRaises(PatchCliError) as context:
            build_patch_payload(
                {
                    "name": "Broken Formula",
                    "family": "subtractive",
                    "layers": [{"id": "osc", "opcode": "vco2", "gain": 0.45}],
                    "formulas": [{"target": "osc_vco2.kamp", "expression": "in1 + in9"}],
                }
            )

        self.assertEqual(context.exception.code, "invalid_formula")
        self.assertIn("in9", context.exception.message)

    def test_patch_spec_formulas_reject_unknown_target_ports(self) -> None:
        with self.assertRaises(PatchCliError) as context:
            build_patch_payload(
                {
                    "name": "Broken Formula Target",
                    "family": "subtractive",
                    "layers": [{"id": "osc", "opcode": "vco2", "gain": 0.45}],
                    "formulas": [{"target": "osc_vco2.nope", "inputs": [], "expression": "0.1"}],
                }
            )

        self.assertEqual(context.exception.code, "formula_target_input_not_found")
        self.assertIn("osc_vco2.nope", context.exception.message)


if __name__ == "__main__":
    unittest.main()
