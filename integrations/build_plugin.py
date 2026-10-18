#!/usr/bin/env python3
"""Build the skills-only Orchestron plugin with Python's standard library."""

from __future__ import annotations

import json
from pathlib import Path
import re
import stat
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
SKILL_FILES = ("SKILL.md", "pyproject.toml", "uv.lock")
SKILL_DIRS = ("agents", "src", "scripts", "references", "assets")
EXCLUDED_DIRS = {
    "__pycache__", "node_modules", "tests", "examples", "build", "dist", "plugin-dist",
}
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


class PackageError(ValueError):
    """The source tree cannot form a complete, portable plugin."""


def check_path(path: Path, *, directory: bool = False) -> None:
    if path.is_symlink():
        raise PackageError(f"Symlinks are not allowed in plugin content: {path}")
    if not (path.is_dir() if directory else path.is_file()):
        kind = "directory" if directory else "file"
        raise PackageError(f"Missing required {kind}: {path}")


def excluded(path: Path) -> bool:
    return (
        path.name.startswith(".")
        or path.name in EXCLUDED_DIRS
        or path.name.endswith((".egg-info", ".dist-info", ".pyc", ".pyo"))
    )


def runtime_files(directory: Path):
    check_path(directory, directory=True)
    for path in sorted(directory.iterdir()):
        if excluded(path):
            continue
        if path.is_symlink():
            raise PackageError(f"Symlinks are not allowed in plugin content: {path}")
        if path.is_dir():
            yield from runtime_files(path)
        else:
            check_path(path)
            yield path


def collect_files(root: Path) -> tuple[dict, dict[str, Path]]:
    manifest_path = root / "plugin.json"
    check_path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("$schema") != SCHEMA:
        raise PackageError("plugin.json must use the portable Agent Plugins 1.0 schema")
    name = manifest.get("name", "")
    version = manifest.get("version", "")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        raise PackageError("Plugin name must be lowercase kebab-case")
    if not isinstance(version, str) or not re.fullmatch(
        r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
        r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?",
        version,
    ):
        raise PackageError("Plugin version must be a semantic version")
    if not isinstance(manifest.get("description"), str) or not manifest["description"].strip():
        raise PackageError("Plugin description is required")

    license_path = root.parent / "LICENSE"
    check_path(license_path)
    files = {"plugin.json": manifest_path, "LICENSE": license_path}
    assets_root = root / "assets"
    if assets_root.exists() or assets_root.is_symlink():
        for path in runtime_files(assets_root):
            files[path.relative_to(root).as_posix()] = path
    skills_root = root / "skills"
    check_path(skills_root, directory=True)
    skills = [path for path in sorted(skills_root.iterdir()) if not excluded(path)]
    if not skills:
        raise PackageError("At least one skill is required")
    for skill in skills:
        check_path(skill, directory=True)
        for filename in SKILL_FILES:
            path = skill / filename
            check_path(path)
            files[path.relative_to(root).as_posix()] = path
        check_path(skill / "src", directory=True)
        for dirname in SKILL_DIRS:
            directory = skill / dirname
            if directory.exists() or directory.is_symlink():
                for path in runtime_files(directory):
                    files[path.relative_to(root).as_posix()] = path
    return manifest, files


def build_archive(root: Path) -> Path:
    manifest, files = collect_files(root)
    destination = root / "plugin-dist"
    if destination.is_symlink():
        raise PackageError(f"Distribution directory must not be a symlink: {destination}")
    destination.mkdir(exist_ok=True)
    archive = destination / f"{manifest['name']}-{manifest['version']}.zip"
    # Replace only after a successful build; never append to an earlier archive.
    with tempfile.NamedTemporaryFile(dir=destination, suffix=".zip", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with ZipFile(temporary_path, "w", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
            for relative, source in sorted(files.items()):
                info = ZipInfo(f"{manifest['name']}/{relative}", date_time=ZIP_TIMESTAMP)
                info.create_system = 3
                mode = 0o755 if source.stat().st_mode & 0o111 else 0o644
                info.external_attr = (stat.S_IFREG | mode) << 16
                bundle.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
        temporary_path.replace(archive)
    finally:
        temporary_path.unlink(missing_ok=True)
    return archive


def main() -> int:
    try:
        archive = build_archive(Path(__file__).resolve().parent)
    except (OSError, ValueError) as exc:
        print(f"Plugin packaging failed: {exc}", file=sys.stderr)
        return 1
    size = archive.stat().st_size
    print(f"Built {archive} ({size:,} bytes; {size / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
