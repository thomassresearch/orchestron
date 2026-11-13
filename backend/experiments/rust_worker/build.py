"""Build/package the retained, dependency-free Rust worker outside the source directory."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def library_name():
    return "orchestron_worker_experiment.dll" if sys.platform == "win32" else (
        "liborchestron_worker_experiment.dylib" if sys.platform == "darwin" else "liborchestron_worker_experiment.so")


def source_identity():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / "Cargo.toml", ROOT / "lib.rs")}


def validate_library(library):
    library = Path(library)
    try:
        stamp = json.loads(library.with_suffix(library.suffix + ".json").read_text())
        if (not isinstance(stamp, dict) or stamp.get("sources") != source_identity()
                or stamp.get("library_sha256") != hashlib.sha256(library.read_bytes()).hexdigest()):
            raise ValueError("source/binary stamp mismatch")
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Rust parallel worker unavailable or stale: {library}. "
                           "Rebuild with uv sync --reinstall-package visualcsound-backend "
                           "or python -m backend.experiments.rust_worker.build. "
                           "VISUALCSOUND_PARALLEL_WORKER=python selects the deprecated rollback.") from exc
    return library


def default_library():
    packaged = ROOT / "_native" / library_name()
    # Wheels contain _native; editable installs keep build products out of source.
    path = packaged if packaged.parent.exists() else ROOT.parents[2] / "build/rust-worker/target/release" / library_name()
    return validate_library(path)


def build(output):
    output = Path(output).resolve()
    try:
        subprocess.run(["cargo", "build", "--release", "--offline", "--manifest-path", str(ROOT / "Cargo.toml"),
                        "--target-dir", str(output)], check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("Building the Rust parallel worker requires Cargo (tested with Rust 1.90). "
                           "Install Rust, or explicitly build with VISUALCSOUND_BUILD_RUST_WORKER=off "
                           "and run with VISUALCSOUND_PARALLEL_WORKER=python (deprecated).") from exc
    library = output / "release" / library_name()
    stamp = {"library_sha256": hashlib.sha256(library.read_bytes()).hexdigest(),
        "sources": source_identity(),
        "rustc": subprocess.check_output(["rustc", "--version"], text=True).strip()}
    library.with_suffix(library.suffix + ".json").write_text(json.dumps(stamp, indent=2) + "\n")
    return library


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("build/rust-worker/target"))
    print(build(parser.parse_args().output))
