"""Select the playback implementation once, before any session processes audio."""

from __future__ import annotations

import importlib
import importlib.util
import hashlib
import json
import logging
import os
import sys
from functools import lru_cache
from importlib.machinery import EXTENSION_SUFFIXES
from pathlib import Path
from types import ModuleType

_MODULE = "backend.app.services._sequencer_playback"
_SETTING = "VISUALCSOUND_SEQUENCER_IMPLEMENTATION"


def is_compiled(module: ModuleType) -> bool:
    return any(str(module.__file__).endswith(suffix) for suffix in EXTENSION_SUFFIXES)


def source_matches(module: ModuleType) -> bool:
    try:
        stamp = json.loads(Path(str(module.__file__) + ".json").read_text())
        return all(stamp.get(suffix) == hashlib.sha256(
            Path(__file__).with_name("_sequencer_playback" + suffix).read_bytes(),
        ).hexdigest() for suffix in (".py", ".pxd"))
    except (OSError, ValueError, AttributeError):
        return False


@lru_cache(maxsize=1)
def python_kernel() -> ModuleType:
    # Import the source explicitly: an installed extension shadows the .py file.
    spec = importlib.util.spec_from_file_location(
        _MODULE + "_python",
        Path(__file__).with_name("_sequencer_playback.py"),
    )
    if spec is None or spec.loader is None:
        raise ImportError("The Python sequencer playback source is missing.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    return module


def load_kernel(mode: str) -> tuple[ModuleType, str | None]:
    if mode not in {"auto", "python", "cython"}:
        raise ValueError(f"{_SETTING} must be auto, python or cython; got {mode!r}.")
    if mode == "python":
        return python_kernel(), None
    try:
        module = importlib.import_module(_MODULE)
        if is_compiled(module):
            if source_matches(module):
                return module, None
            reason = "compiled extension is stale or its source stamp is missing; rebuild the package"
        else:
            reason = "compiled extension is not installed"
    except (ImportError, OSError) as exc:
        reason = f"compiled extension could not be loaded: {exc}"
    if mode == "cython":
        raise RuntimeError(f"Cython sequencer requested, but {reason}.")
    return python_kernel(), reason


requested_implementation = os.environ.get(_SETTING, "auto").strip().lower()
kernel, fallback_reason = load_kernel(requested_implementation)
implementation = "cython" if is_compiled(kernel) else "python"


def log_implementation() -> None:
    logging.getLogger(__name__).info(
        "Sequencer playback: %s (requested=%s%s)",
        implementation,
        requested_implementation,
        f"; {fallback_reason}" if fallback_reason else "",
    )
