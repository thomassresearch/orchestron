"""Check wheel selection outside the checkout, including stale-binary rollback."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def verify(wheel: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="orchestron-wheel-") as directory:
        root = Path(directory)
        with zipfile.ZipFile(wheel) as archive:
            archive.extractall(root)
        kernels = root / "backend/app/services"
        native = any(kernels.glob("_sequencer_playback*.so")) or any(kernels.glob("_sequencer_playback*.pyd"))
        expected = "cython" if native else "python"
        code = (
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "from backend.app.services import sequencer_playback as p; "
            "assert p.kernel.__file__.startswith(sys.argv[1]), p.kernel.__file__; "
            "assert p.implementation == sys.argv[2], (p.implementation, p.fallback_reason)"
        )

        def run(mode, selected, *, success=True):
            result = subprocess.run(
                [sys.executable, "-c", code, str(root), selected], cwd=root, capture_output=True, text=True,
                env={**os.environ, "VISUALCSOUND_SEQUENCER_IMPLEMENTATION": mode},
            )
            if success:
                assert result.returncode == 0, result.stderr
            else:
                assert result.returncode != 0 and "stale" in result.stderr, result.stderr

        run("auto", expected)
        run("python", "python")
        if native:
            run("cython", "cython")
            source = kernels / "_sequencer_playback.py"
            source.write_text(source.read_text() + "\n# Simulate an editable source change.\n")
            run("auto", "python")
            run("cython", "cython", success=False)
        print(f"Verified {wheel.name}: {expected}, forced Python" + (", stale-binary fallback" if native else ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel", type=Path)
    verify(parser.parse_args().wheel.resolve())


if __name__ == "__main__":
    main()
