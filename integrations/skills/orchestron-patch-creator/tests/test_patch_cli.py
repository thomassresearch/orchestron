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

from orchestron_patch.cli.orchestron_patch_cli import PatchCliError, build_patch_payload


class PatchCliTests(unittest.TestCase):
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

    def test_fm_pad_graph_has_required_spine_and_final_outs(self) -> None:
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

        self.assertEqual(graph["nodes"][-1]["opcode"], "outs")
        self.assertIn("cpsmidi", opcodes)
        self.assertIn("ampmidi", opcodes)
        self.assertIn("madsr", opcodes)
        self.assertIn("pan2", opcodes)
        self.assertEqual(opcodes.count("outs"), 1)

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

        outs_id = graph["nodes"][-1]["id"]
        outs_ports = {conn["to_port_id"] for conn in graph["connections"] if conn["to_node_id"] == outs_id}
        self.assertEqual(outs_ports, {"left", "right"})
        self.assertFalse([conn for conn in graph["connections"] if conn["from_node_id"] == outs_id])

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
        self.assertEqual(payload["data"]["last_opcode"], "outs")
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
