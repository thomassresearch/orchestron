from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build_plugin import PackageError, SCHEMA, build_archive  # noqa: E402


class PluginPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "integrations"
        self.skill = self.root / "skills" / "demo"
        self.write(self.root.parent / "LICENSE", "Project license")
        self.write(self.root / "plugin.json", json.dumps({
            "$schema": SCHEMA, "name": "orchestron", "version": "0.1.0", "description": "Test plugin",
        }))
        self.write(self.skill / "SKILL.md", "---\nname: demo\ndescription: Test skill\n---\n")
        self.write(self.skill / "pyproject.toml", '[project]\nname = "demo"\nversion = "0.1.0"\n')
        self.write(self.skill / "uv.lock", "version = 1\n")
        self.write(self.skill / "src" / "demo.py", "print('demo')\n")

    def write(self, path, content="excluded"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_runtime_payload_and_exclusions(self):
        self.write(self.root / "assets" / "icon.png", "plugin icon")
        self.write(self.root / "assets" / ".DS_Store")
        included = ["agents/openai.yaml", "references/usage.md", "assets/player.js", "scripts/run.py",
                    "src/vendor/LICENSE", "src/vendor/NOTICE.md"]
        for relative in included:
            self.write(self.skill / relative, relative)
        for relative in ["tests/test_demo.py", ".venv/large-file", "src/__pycache__/demo.pyc",
                         "src/demo.pyc", "src/demo.egg-info/PKG-INFO", "assets/.DS_Store",
                         "assets/node_modules/package/index.js", "assets/dist/generated.js",
                         "references/.env", "references/examples/example.json"]:
            self.write(self.skill / relative)
        self.write(self.root / "examples" / "large.zip")
        self.write(self.root / "plugin-dist" / "previous.zip")
        self.write(self.root / "build_plugin.py")
        with ZipFile(build_archive(self.root)) as bundle:
            self.assertIsNone(bundle.testzip())
            names = set(bundle.namelist())
            expected = {"orchestron/plugin.json", "orchestron/LICENSE", "orchestron/assets/icon.png"}
            expected.update(f"orchestron/skills/demo/{relative}" for relative in
                            ["SKILL.md", "pyproject.toml", "uv.lock", "src/demo.py", *included])
            self.assertEqual(names, expected)
            self.assertEqual(bundle.read("orchestron/assets/icon.png"), b"plugin icon")
            self.assertEqual(bundle.read("orchestron/skills/demo/src/vendor/LICENSE"), b"src/vendor/LICENSE")

    def test_missing_required_files(self):
        for path in [self.root / "plugin.json", self.root.parent / "LICENSE",
                     self.skill / "SKILL.md", self.skill / "pyproject.toml", self.skill / "uv.lock"]:
            with self.subTest(path=path):
                content = path.read_bytes()
                path.unlink()
                with self.assertRaisesRegex(PackageError, "Missing required file"):
                    build_archive(self.root)
                path.write_bytes(content)

    def test_rejects_symlinks_in_included_content(self):
        for path, target in [(self.skill / "src" / "linked.py", self.skill / "src" / "demo.py"),
                             (self.skill / "assets", self.skill / "src"),
                             (self.skill / "references", self.root / "missing")]:
            with self.subTest(path=path):
                path.symlink_to(target)
                with self.assertRaisesRegex(PackageError, "Symlinks are not allowed"):
                    build_archive(self.root)
                path.unlink()

    def test_reproducible_and_rebuild_removes_deleted_files(self):
        obsolete = self.skill / "references" / "old.md"
        self.write(obsolete, "old")
        first = build_archive(self.root).read_bytes()
        os.utime(obsolete, (1700000000, 1700000000))
        self.assertEqual(build_archive(self.root).read_bytes(), first)
        obsolete.unlink()
        with ZipFile(build_archive(self.root)) as bundle:
            self.assertNotIn("orchestron/skills/demo/references/old.md", bundle.namelist())

    def test_version_controls_archive_name(self):
        manifest_path = self.root / "plugin.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["version"] = "0.2.0"
        manifest_path.write_text(json.dumps(manifest))
        self.assertEqual(build_archive(self.root).name, "orchestron-0.2.0.zip")


if __name__ == "__main__":
    unittest.main()
