"""Exercise the policy with synthetic tools; never modify developer examples."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "protect_example_exports.py"
SPEC = importlib.util.spec_from_file_location("protect_example_exports", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class ExportGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name).resolve()
        for folder in ("instruments", "performances"):
            (self.repo / "examples" / folder).mkdir(parents=True)

    def reason(self, tool, arguments, cwd=None):
        return guard.blocking_reason(
            {"tool_name": tool, "tool_input": arguments, "cwd": str(cwd or self.repo)}, self.repo
        )

    def shell(self, command, **arguments):
        return self.reason("Bash", {"command": command, **arguments})

    def test_export_suffixes(self):
        for kind, suffixes in guard.EXPORTS.items():
            for suffix in suffixes:
                with self.subTest(kind=kind, suffix=suffix):
                    self.assertIsNone(self.reason("Write", {"file_path": f"examples/{kind}/Piano{suffix}"}))

    def test_invalid_names_and_wrong_export_type(self):
        for kind in guard.EXPORTS:
            for filename in ("notes.md", "piano.score.json", "piano.wav", "piano.patch.json", ".hidden", "x.orch.json.bak"):
                with self.subTest(kind=kind, filename=filename):
                    self.assertIn("Additional information", self.reason("Write", {"path": f"examples/{kind}/{filename}"}))
        self.assertIsNotNone(self.reason("Write", {"path": "examples/instruments/a.orch.json"}))
        self.assertIsNotNone(self.reason("Write", {"path": "examples/performances/a.orch.instrument.json"}))
        self.assertIsNotNone(self.reason("Write", {"path": "examples/instruments/a.ORCH.INSTRUMENT.JSON"}))

    def test_nested_files_and_other_directories(self):
        for path in ("examples/instruments/piano/notes.md", "examples/performances/song/score.json", "examples/README.md",
                     "other/examples/instruments/notes.md", "examples/instruments-copy/notes.md"):
            with self.subTest(path=path):
                self.assertIsNone(self.reason("Write", {"path": path}))

    def test_patch_add_update_move_delete_and_mixed_destinations(self):
        def patch(body):
            return {"command": "*** Begin Patch\n" + body + "\n*** End Patch"}

        for action in ("Add File", "Update File"):
            self.assertIsNotNone(self.reason("apply_patch", patch(f"*** {action}: examples/instruments/notes.md\n+x")))
        self.assertIsNone(self.reason("apply_patch", patch("*** Delete File: examples/instruments/notes.md")))
        self.assertIsNone(self.reason("apply_patch", patch(
            "*** Update File: examples/instruments/notes.md\n*** Move to: examples/instruments/piano/notes.md\n@@\n-a\n+b"
        )))
        self.assertIsNotNone(self.reason("apply_patch", patch(
            "*** Update File: elsewhere.md\n*** Move to: examples/performances/notes.md\n@@\n-a\n+b"
        )))
        self.assertIsNotNone(self.reason("apply_patch", patch(
            "*** Add File: examples/instruments/piano.orch.instrument.json\n+{}\n"
            "*** Add File: examples/performances/notes.md\n+notes"
        )))
        # A path mentioned only in file content is not a destination.
        self.assertIsNone(self.reason("apply_patch", patch("*** Add File: other.md\n+examples/instruments/notes.md")))

    def test_structured_tools_and_move_sources(self):
        self.assertIsNotNone(self.reason("mcp__fs__write_file", {"path": "examples/instruments/notes.md", "content": "x"}))
        self.assertIsNotNone(self.reason("mcp__fs__edit_files", {"edits": [{"file_path": "examples/performances/x.md"}]}))
        self.assertIsNone(self.reason("mcp__fs__write_file", {"path": "other.md", "content": "examples/instruments/x.md"}))
        self.assertIsNone(self.reason("mcp__fs__move_file", {"source": "examples/instruments/x.md", "destination": "other.md"}))
        self.assertIsNotNone(self.reason("mcp__fs__copy_file", {"source": "x.md", "destination": "examples/instruments/"}))
        for tool in ("mcp__fs__read_file", "mcp__fs__delete_file", "mcp__fs__create_directory"):
            self.assertIsNone(self.reason(tool, {"path": "examples/instruments/notes.md"}))

    def test_shell_writes(self):
        commands = (
            "echo notes > examples/instruments/notes.md",
            "printf x >> examples/performances/notes.md",
            "echo x 2>examples/instruments/errors.log",
            "tee examples/instruments/notes.md < source.md",
            "touch examples/performances/notes.md",
            "cp source.md examples/instruments/notes.md",
            "mv source.md examples/performances/notes.md",
            "cp source.md examples/instruments/",
            "mv a.md b.md examples/performances",
            "cp -t examples/instruments source.md",
            "cp --target-directory=examples/instruments source.md",
            "install -m 644 source.md examples/performances/notes.md",
            "cat source.md | tee examples/performances/notes.md",
            "mkdir -p examples/instruments/piano && touch examples/instruments/notes.md",
            "true\ntouch examples/instruments/notes.md",
            "sh -c 'echo x > examples/instruments/notes.md'",
            "bash -lc 'touch examples/instruments/notes.md'",
            "touch examples/\"instruments\"/notes.md",
            "cat <<'EOF' > examples/instruments/notes.md\nnotes\nEOF",
            "cat > examples/instruments/notes.md <<'EOF'\nnotes\nEOF",
        )
        for command in commands:
            with self.subTest(command=command):
                self.assertIsNotNone(self.shell(command))

    def test_shell_reads_directories_and_moves_out(self):
        for command in (
            "cat examples/instruments/notes.md", "ls examples/performances", "rg notes examples/instruments",
            "mkdir -p examples/instruments/piano", "install -d examples/instruments/piano",
            "rm examples/instruments/notes.md", "mv examples/instruments/notes.md other.md",
            "cp examples/instruments/notes.md other.md", "touch examples/instruments/piano/notes.md",
            "echo x > examples/performances/song.orch.json", "echo examples/instruments/notes.md",
            "printf '%s' '>' examples/instruments/notes.md",
            "echo \\> examples/instruments/notes.md",
            "echo x # > examples/instruments/notes.md",
        ):
            with self.subTest(command=command):
                self.assertIsNone(self.shell(command))

    def test_paths_working_directories_and_cd(self):
        folder = self.repo / "examples" / "instruments"
        self.assertIsNotNone(self.reason("Write", {"path": str(folder / "notes with spaces.md")}))
        self.assertIsNotNone(self.reason("Edit", {"file_path": "./examples/instruments/../instruments/x.md"}))
        self.assertIsNotNone(self.reason("Write", {"path": "x.md"}, folder))
        self.assertIsNotNone(self.reason("exec_command", {"cmd": "touch x.md", "workdir": str(folder)}))
        self.assertIsNotNone(self.shell("touch 'examples/instruments/notes with spaces.md'"))
        self.assertIsNotNone(self.shell("cd examples/instruments && touch notes.md"))
        self.assertIsNotNone(self.shell("cd examples/instruments\ntouch notes.md"))
        self.assertIsNotNone(self.shell("touch notes.md", workdir="examples/instruments"))

    def test_symlink_aliases(self):
        folder = self.repo / "examples" / "instruments"
        (self.repo / "alias").symlink_to(folder, target_is_directory=True)
        self.assertIsNotNone(self.reason("Write", {"path": "alias/notes.md"}))
        (folder / "nested").mkdir()
        (folder / "nested" / "alias.md").symlink_to(folder / "notes.md")
        self.assertIsNotNone(self.reason("Write", {"path": "examples/instruments/nested/alias.md"}))
        (folder / "notes.md").symlink_to(self.repo / "other.md")
        self.assertIsNotNone(self.reason("Write", {"path": "examples/instruments/notes.md"}))

    def test_inline_python_writes(self):
        sources = (
            "open('examples/instruments/notes.md', 'w').write('x')",
            "open('examples/instruments/notes.md', mode='a')",
            "open(file='examples/instruments/notes.md', mode='w')",
            "from pathlib import Path; Path('examples/instruments/notes.md').write_text('x')",
            "from pathlib import Path; p = Path('examples/instruments') / 'notes.md'; p.write_bytes(b'x')",
            "from pathlib import Path; Path('examples/instruments/notes.md').open('w')",
            "import shutil; shutil.copy('notes.md', 'examples/instruments')",
            "import os; os.rename('notes.md', 'examples/instruments/notes.md')",
        )
        import shlex

        for source in sources:
            with self.subTest(source=source):
                self.assertIsNotNone(self.shell("python3 -c " + shlex.quote(source)))
                self.assertIsNotNone(self.shell("uv run python -c " + shlex.quote(source)))
                self.assertIsNotNone(self.shell("python3 - <<'PY'\n" + source + "\nPY"))
        self.assertIsNotNone(self.shell(
            "cd examples/instruments && python3 - <<'PY'\nopen('notes.md', 'w')\nPY"
        ))
        for source in ("open('examples/instruments/notes.md').read()",
                       "from pathlib import Path; Path('examples/instruments/piano').mkdir()"):
            self.assertIsNone(self.shell("python3 -c " + shlex.quote(source)))

    def test_subprocess_protocol(self):
        # Point at real checkout paths, but run only the hook, never the write.
        for path, status in (("examples/instruments/notes.md", 2),
                             ("examples/performances/notes.md", 2),
                             ("examples/performances/song.orch.json", 0),
                             ("examples/performances/song/notes.md", 0)):
            event = {"tool_name": "Write", "cwd": str(guard.REPO), "tool_input": {"path": path}}
            result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(event), text=True, capture_output=True)
            self.assertEqual(result.returncode, status, result.stderr)
            self.assertEqual(result.stdout, "")
            if status:
                self.assertIn(path, result.stderr)
                kind = path.split("/")[1]
                self.assertIn(f"subfolder instead of the top-level {kind} folder", result.stderr)


if __name__ == "__main__":
    unittest.main()
