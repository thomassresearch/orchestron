"""In-memory migration of saved arpeggiators; never writes developer examples."""
from copy import deepcopy
import re

from backend.app.models.session import ArpeggiatorPadConfig, SessionArpeggiatorConfig


def snake_keys(value):
    if isinstance(value, list):
        return [snake_keys(item) for item in value]
    if isinstance(value, dict):
        return {re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): snake_keys(item) for key, item in value.items()}
    return value


def camel_keys(value):
    if isinstance(value, list):
        return [camel_keys(item) for item in value]
    if isinstance(value, dict):
        return {re.sub(r"_([a-z])", lambda m: m[1].upper(), key): camel_keys(item) for key, item in value.items()}
    return value


def migrate_arpeggiators(config: dict) -> dict:
    sequencer = config.get("sequencer")
    if not isinstance(sequencer, dict):
        return config
    arps = sequencer.get("arpeggiators", [])
    presets = sequencer.get("arpeggiatorPresets", [])
    if not arps and not presets:
        return config
    result = deepcopy(config)
    target = result["sequencer"]
    if not isinstance(arps, list) or len(arps) > 16:
        raise ValueError("A maximum of 16 arpeggiators is supported")
    for index, arp in enumerate(target.get("arpeggiators", [])):
        raw = snake_keys(arp)
        raw["arpeggiator_id"] = arp.get("id", f"arp-{index + 1}")
        raw.setdefault("input_channel", min(16, index + 2))
        raw.setdefault("target_channel", 1)
        legacy = not raw.get("pads")
        if legacy:
            raw.update(playback_mode="arranger", hold_mode="off", latch=False, restart_mode="free", octave_traversal="range")
        model = SessionArpeggiatorConfig.model_validate(raw)
        arp["pads"] = camel_keys([pad.model_dump(mode="json") for pad in model.pads])
        for key in ("playback_mode", "hold_mode", "processing_mode", "restart_mode", "launch_quantize",
                    "active_pad", "pad_loop_enabled", "pad_loop_repeat"):
            arp.update(camel_keys({key: getattr(model, key)}))
        arp.setdefault("padLoopPattern", {"rootSequence": [{"type": "pad", "padIndex": 0}], "groups": [], "superGroups": []})
        arp.setdefault("padPresetIds", [arp.get("presetId")] + [None] * 7)
        for key in ("heldNotes", "activeNote", "stepIndex", "lastVelocity", "runtimeStatus"):
            arp.pop(key, None)
    for preset in target.get("arpeggiatorPresets", []):
        if isinstance(preset, dict):
            preset["settings"] = camel_keys(ArpeggiatorPadConfig.model_validate(snake_keys(preset.get("settings", {}))).model_dump(mode="json"))
    if isinstance(result.get("version"), int) and result["version"] >= 11:
        result["version"] = 15
    return result
