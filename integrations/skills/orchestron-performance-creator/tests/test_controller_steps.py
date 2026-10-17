from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orchestron.cli import orchestron_cli as cli  # noqa: E402


def test_step_controller_survives_normalization_and_runtime_conversion():
    config = cli.empty_performance_config()
    track = cli.add_controller_sequencer_to_config(config, controller_number=74, name="Steps",
        length_beats=2, curve="flat", enabled=True)
    track.update(controllerMode="step", resetValue=12, targetChannels=[2, 5])
    track["pads"][0]["steps"] = [None, 0, 64, 64, None, 127, None, None] + [None] * 119 + [80]
    restored = cli.normalize_performance_config(config, [])
    assert restored["version"] == 20
    assert restored["sequencer"]["controllerSequencers"][0]["pads"][0]["steps"][-1] == 80
    wire = cli.build_runtime_config(restored)["controller_tracks"][0]
    assert (wire["controller_mode"], wire["reset_value"], wire["target_channels"]) == ("step", 12, [2, 5])
    assert wire["pads"][0]["steps"][:8] == [None, 0, 64, 64, None, 127, None, None]
    assert len(wire["pads"][0]["steps"]) == 128


def test_legacy_curve_defaults_and_invalid_step_values():
    config = cli.empty_performance_config()
    config["version"] = 19
    track = cli.add_controller_sequencer_to_config(config, controller_number=74, name="Curve",
        length_beats=2, curve="flat", enabled=True)
    track.pop("controllerMode")
    track.pop("resetValue")
    track["pads"][0].pop("steps")
    restored = cli.normalize_performance_config(config, [])
    wire = cli.build_runtime_config(restored)["controller_tracks"][0]
    assert wire["controller_mode"] == "curve" and wire["reset_value"] == 0
    assert wire["pads"][0]["steps"] == [None] * 128
    assert cli.normalize_controller_steps([0, 127, -1, 128, 1.5, True, "4"])[:7] == [0, 127, None, None, None, None, None]
