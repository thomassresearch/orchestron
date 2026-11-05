from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile
import subprocess
import re

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


class RealPluginPackageTests(unittest.TestCase):
    def test_actual_sources_extract_and_run_portable_clip_commands(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            archive = build_archive(root)
            with ZipFile(archive) as bundle:
                bundle.extractall(work / "install")
                names = bundle.namelist()
            plugin = work / "install/orchestron"
            skills = plugin / "skills"
            self.assertEqual(len(list(skills.glob("*/SKILL.md"))), 4)
            for name in ("song_model", "song_structure", "song_history", "song_runtime", "song_export", "song_schema"):
                self.assertTrue((skills / "orchestron-performance-creator/src/orchestron" / (name + ".py")).is_file())
            self.assertFalse(any(part in ("tests", ".venv", "__pycache__", ".orchestron") for name in names for part in Path(name).parts))
            for markdown in skills.rglob("*.md"):
                for target in re.findall(r'\]\(([^)\s]+)\)', markdown.read_text()):
                    if "://" not in target and not target.startswith("#"):
                        local = target.split("#")[0]
                        if local and not (markdown.parent / local).exists():
                            # Existing older musical references sometimes point to
                            # optional repository examples; new song guides may not.
                            if markdown.name.startswith("song_") or markdown.name == "SKILL.md":
                                self.fail(f"Broken packaged reference: {markdown}: {target}")
            skill = skills / "orchestron-performance-creator"
            music = work / "music"
            music.mkdir()
            env = {**os.environ, "PYTHONPATH": str(skill / "src"), "PYTHONDONTWRITEBYTECODE": "1"}
            session = music / "draft.json"
            def run(*args):
                result = subprocess.run([sys.executable, str(skill / "scripts/orchestron_cli.py"), "--json",
                    "--session-file", str(session), *args], cwd=music, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)["result"]
            run("capabilities", "--offline")
            run("edit", "schema")
            run("edit", "begin", "--new", "--offline", "--arranger", "clips", "--name", "Packaged song")
            run("edit", "apply-song", "--file", str(skill / "assets/complete-song.json"), "--offline")
            summary = run("edit", "inspect")
            self.assertEqual(summary["counts"]["patterns"], 3)
            before = session.read_bytes()
            repeated = run("edit", "apply-song", "--file", str(skill / "assets/complete-song.json"), "--offline")
            self.assertFalse(repeated["state"]["changed"])
            self.assertEqual(session.read_bytes(), before)
            run("edit", "validate", "--offline")


if __name__ == "__main__":
    unittest.main()
