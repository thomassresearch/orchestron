"""Check installed sequencer/worker selection and stale native builds outside the checkout."""
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
        root = Path(directory).resolve()
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
        worker = root / "backend/experiments/rust_worker"
        rust = (worker / "_native").is_dir()
        worker_code = """
import ctypes
import sys
sys.path.insert(0, sys.argv[1])
from backend.experiments.rust_worker import bridge, build
assert str(build.ROOT).startswith(sys.argv[1]), build.ROOT
if bridge.worker_implementation() == 'python':
    assert bridge.default_batch_factory() is None
else:
    library = build.default_library()
    assert str(library).startswith(sys.argv[1]), library
    assert ctypes.CDLL(str(library)).worker_abi() == 1
"""

        def run_worker(mode, *, success):
            result = subprocess.run([sys.executable, "-c", worker_code, str(root)], cwd=root,
                capture_output=True, text=True, env={**os.environ, "VISUALCSOUND_PARALLEL_WORKER": mode})
            if success:
                assert result.returncode == 0, result.stderr
            else:
                assert result.returncode != 0 and "Rust parallel worker unavailable or stale" in result.stderr, result.stderr

        run_worker("rust", success=rust)
        run_worker("python", success=True)
        if rust:
            source = worker / "lib.rs"
            source.write_text(source.read_text() + "\n// Simulate a stale installed Rust binary.\n")
            run_worker("rust", success=False)
            run_worker("python", success=True)
        print(f"Verified {wheel.name}: {expected}, forced Python" + (", stale-binary fallback" if native else ""))
        print(f"Rust worker {'packaged' if rust else 'omitted'}: default validation and deprecated Python rollback verified")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel", type=Path)
    verify(parser.parse_args().wheel.resolve())


if __name__ == "__main__":
    main()
