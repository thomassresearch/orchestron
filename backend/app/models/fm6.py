"""Version-one FM6 voice bank. Preset IDs and authored voices are append-only."""

import json
import math
from pathlib import Path

FM6_DATA = json.loads((Path(__file__).resolve().parents[1] / "data/fm6.json").read_text())
FM6_FIELDS = FM6_DATA["fields"]
FM6_DEFAULT = FM6_DATA["default"]
FM6_PRESETS = FM6_DATA["presets"]
FM6_KEYS = ["algorithm", "feedback", *[f"op{i}_{key}" for i in range(1, 7) for key in FM6_FIELDS]]
FM6_INPUT_RANGES = {"ipreset": (0, len(FM6_PRESETS), 0), **FM6_DATA["globals"]}


def validate_fm6_value(key: str, value: float) -> None:
    if key in FM6_INPUT_RANGES:
        low, high, _ = FM6_INPUT_RANGES[key]
    elif key in ("algorithm", "feedback"):
        low, high = (1, 8) if key == "algorithm" else (0, 100)
    else:
        low, high, _ = FM6_FIELDS[key.split("_", 1)[1]]
    integer = key in ("algorithm", "ipreset") or key.endswith("_enabled")
    if (isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value)
            or not low <= value <= high or integer and int(value) != value):
        raise ValueError(f"FM6 {key} must be a number in {low}..{high}" + (" (whole number)." if integer else "."))


def fm6_voice(params: dict) -> dict[str, float]:
    # Scalar expressions and wired inputs are resolved by the graph compiler and
    # bounded by the UDO. Reject invalid literal preset IDs at the API boundary.
    preset = params.get("ipreset", 0)
    if isinstance(preset, int | float) and (not math.isfinite(preset)
            or not 0 <= preset <= len(FM6_PRESETS) or int(preset) != preset):
        raise ValueError(f"FM6 ipreset must be a whole number in 0..{len(FM6_PRESETS)}.")
    voice = FM6_DEFAULT | {key: value for key, value in params.items() if key in FM6_DEFAULT}
    for key, value in voice.items():
        validate_fm6_value(key, value)
    return voice


def packed_voice(voice: dict) -> str:
    return ", ".join(format(float(voice[key]), ".12g") for key in FM6_KEYS)
