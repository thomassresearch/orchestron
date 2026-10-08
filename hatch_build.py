"""Build the optional playback extension for wheels and editable installs."""

from __future__ import annotations

import os
import sys
import hashlib
import json
from pathlib import Path
from importlib.machinery import EXTENSION_SUFFIXES

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class PlaybackBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        if self.target_name != "wheel":
            return
        mode = os.environ.get("VISUALCSOUND_BUILD_CYTHON", "auto").strip().lower()
        if mode not in {"auto", "required", "off"}:
            raise ValueError("VISUALCSOUND_BUILD_CYTHON must be auto, required or off.")
        relative_dir = Path("backend/app/services")
        root = Path(self.root)
        if version == "editable":
            for suffix in EXTENSION_SUFFIXES:
                (root / relative_dir / ("_sequencer_playback" + suffix)).unlink(missing_ok=True)
                (root / relative_dir / ("_sequencer_playback" + suffix + ".json")).unlink(missing_ok=True)
        # Ignore stale extension artifacts, including in explicit Python-only wheels.
        build_data["artifacts"].extend(["!**/_sequencer_playback*.so*", "!**/_sequencer_playback*.pyd*"])
        if mode == "off":
            return
        if sys.platform not in {"darwin", "linux"}:
            if mode == "required":
                raise RuntimeError("The Cython playback build currently supports macOS and Linux.")
            self.app.display_warning("Using Python sequencer playback on this platform.")
            return
        from Cython.Build import cythonize
        from setuptools import Distribution, Extension
        from setuptools.command.build_ext import build_ext
        from setuptools.errors import CCompilerError, ExecError, PlatformError

        temporary = root / "build" / "cython-playback"
        extensions = cythonize(
            [
                Extension(
                    "backend.app.services._sequencer_playback",
                    [str(root / relative_dir / "_sequencer_playback.py")],
                    extra_compile_args=["-O3", "-ffp-contract=off"],
                )
            ],
            build_dir=str(temporary / "generated"),
            compiler_directives={"language_level": 3, "annotation_typing": False, "binding": True, "profile": False},
        )
        distribution = Distribution({"name": "orchestron-playback", "ext_modules": extensions})
        command = build_ext(distribution)
        command.ensure_finalized()
        command.force = True
        command.build_lib = str(temporary / "lib")
        command.build_temp = str(temporary / "objects")
        try:
            command.run()
        except (CCompilerError, ExecError, PlatformError, OSError) as exc:
            if mode == "required":
                raise
            self.app.display_warning(f"Cython playback build unavailable; using Python: {exc}")
            return
        for extension in extensions:
            path = Path(command.get_ext_fullpath(extension.name))
            destination = relative_dir / path.name
            stamp = Path(str(path) + ".json")
            stamp.write_text(json.dumps({
                suffix: hashlib.sha256((root / relative_dir / ("_sequencer_playback" + suffix)).read_bytes()).hexdigest()
                for suffix in (".py", ".pxd")
            }))
            if version == "editable":
                # The repository package precedes site-packages when run from cwd.
                import shutil

                shutil.copy2(path, root / destination)
                shutil.copy2(stamp, root / (str(destination) + ".json"))
            build_data["force_include"][str(path)] = str(destination)
            build_data["force_include"][str(stamp)] = str(destination) + ".json"
        build_data["pure_python"] = False
        build_data["infer_tag"] = True
