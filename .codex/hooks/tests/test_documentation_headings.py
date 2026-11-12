import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HOOKS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS))
import protect_documentation_headings as guard  # noqa: E402


class HeadingsTest(unittest.TestCase):
    def test_language_names_and_levels(self):
        for name in ('English', 'French', 'German', 'Spanish', 'Français', 'Francais', 'Deutsch', 'Español', 'Espanol'):
            for level in range(1, 7):
                with self.subTest(name=name, level=level):
                    self.assertTrue(guard.violations('#' * level + ' ' + name + ' — Help'))

    def test_formats(self):
        for text in ('## **Screenshots** ###', 'Screenshots\n----------', 'FRANÇAIS – aide\n===',
                     '> ## Deutsch: Hilfe', '## [English](help.md) guide', '<h2>Screenshots</h2>',
                     '<h3>\n<strong>Fran&ccedil;ais</strong> – aide\n</h3>'):
            with self.subTest(text=text):
                self.assertTrue(guard.violations(text))

    def test_non_headings_and_other_titles(self):
        for text in ('English body text', '## GUI Language', '## Taking screenshots', '## Screenshots in context',
                     '## Englishman', '    ## Screenshots', '\t## Deutsch', '<!--\n## Screenshots\n-->',
                     '```markdown\n## Screenshots\n```', '~~~~\nDeutsch\n---\n<h2>Screenshots</h2>\n~~~~'):
            with self.subTest(text=text):
                self.assertEqual([], guard.violations(text))

    def test_line_numbers_and_fence_lengths(self):
        text = '# Good\n\n````md\n```\n## English\n````\n\n## Screenshots\n'
        self.assertEqual(8, guard.violations(text)[0][0])


class HookTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.docs = self.repo / 'documentation'
        self.docs.mkdir()
        self.path = self.docs / 'guide.md'
        self.path.write_text('# Guide\n\nUseful text.\n')

    def reason(self, name, args, cwd=None):
        return guard.blocking_reason({'tool_name': name, 'tool_input': args, 'cwd': str(cwd or self.repo)}, self.repo)

    def patch(self, body):
        return self.reason('apply_patch', {'command': '*** Begin Patch\n' + body + '\n*** End Patch'})

    def test_write_blocked_without_mutation(self):
        reason = self.reason('Write', {'file_path': str(self.path), 'content': '# Guide\n\n## Screenshots'})
        self.assertIn('guide.md:3', reason)
        self.assertIn('beside the text', reason)
        self.assertEqual('# Guide\n\nUseful text.\n', self.path.read_text())

    def test_valid_write_and_outside_scope(self):
        self.assertIsNone(self.reason('Write', {'file_path': str(self.path), 'content': '# Guide'}))
        for path in ('README.md', 'documentation-other/guide.md', 'documentation/guide.txt'):
            self.assertIsNone(self.reason('Write', {'file_path': path, 'content': '# English'}))

    def test_patch_add_and_mixed_files(self):
        self.assertIn('Cannot save', self.patch('*** Add File: notes.md\n+# Fine\n*** Add File: documentation/new.md\n+## Deutsch'))
        self.assertIsNone(self.patch('*** Add File: documentation/new.md\n+# Guide\n+\n+```\n+## English\n+```'))

    def test_update_result_not_just_added_lines(self):
        self.path.write_text('English guide\n\nBody\n')
        self.assertIn('language name', self.patch('*** Update File: documentation/guide.md\n@@\n English guide\n-\n+-------------\n Body'))

    def test_patch_removing_bad_heading_and_multiple_hunks(self):
        self.path.write_text('# Guide\n\n## Screenshots\n\nPicture\n\nEnd\n')
        self.assertIsNone(self.patch('*** Update File: documentation/guide.md\n@@\n-## Screenshots\n+## Graph editor\n@@\n-End\n+Done'))

    def test_patch_fence_context(self):
        self.path.write_text('# Guide\n\n```md\nexample\n```\n')
        self.assertIsNone(self.patch('*** Update File: documentation/guide.md\n@@\n-example\n+## Screenshots'))

    def test_move_into_docs(self):
        (self.repo / 'notes.md').write_text('# English\n')
        self.assertIn('language name', self.patch('*** Update File: notes.md\n*** Move to: documentation/new.md\n@@\n-# English\n+# German'))

    def test_delete_and_move_out(self):
        self.path.write_text('# English\n')
        self.assertIsNone(self.patch('*** Delete File: documentation/guide.md'))
        self.assertIsNone(self.patch('*** Update File: documentation/guide.md\n*** Move to: notes.md\n@@\n-# English\n+# German'))

    def test_edit_and_multiedit(self):
        self.assertIn('language name', self.reason('Edit', {'file_path': str(self.path), 'old_string': '# Guide', 'new_string': '# Español'}))
        self.assertIn('Screenshots', self.reason('MultiEdit', {'file_path': str(self.path), 'edits': [
            {'old_string': '# Guide', 'new_string': '# Overview'},
            {'old_string': 'Useful text.', 'new_string': 'Screenshots\n---'}]}))

    def test_mcp_edit(self):
        self.assertIn('language name', self.reason('mcp__fs__edit_file', {'path': str(self.path), 'edits': [
            {'oldText': '# Guide', 'newText': '# Français'}]}))

    def test_ambiguous_preview_fails_closed(self):
        self.assertIn('Cannot validate', self.patch('*** Update File: documentation/guide.md\n@@\n-missing\n+# Guide'))
        self.assertIn('Cannot validate', self.reason('save_file', {'path': str(self.path)}))

    def test_relative_absolute_and_symlink_paths(self):
        (self.repo / 'alias').symlink_to(self.docs, target_is_directory=True)
        for name in ('guide.md', '../alias/guide.md', str(self.path)):
            self.assertIn('Cannot save', self.reason('Write', {'path': name, 'content': '# English'}, self.docs))

    def test_shell_writes_require_preview(self):
        for cmd in ("echo bad > documentation/guide.md", "cp notes.md documentation/guide.md",
                    "python3 -c 'from pathlib import Path; Path(\"documentation/guide.md\").write_text(\"# English\")'",
                    'cd documentation && cat > guide.md', 'tee documentation/guide.md'):
            with self.subTest(cmd=cmd):
                self.assertIn('Use apply_patch', self.reason('Bash', {'command': cmd}))
        self.assertIsNone(self.reason('exec_command', {'cmd': 'cat documentation/guide.md'}))
        self.assertIsNone(self.reason('read_file', {'path': str(self.path)}))

    def test_cli_exit_code_and_message(self):
        event = {'tool_name': 'Write', 'tool_input': {
            'path': str(guard.REPO / 'documentation' / 'never-created.md'), 'content': '# English'}}
        result = subprocess.run([sys.executable, str(HOOKS / 'protect_documentation_headings.py')],
                                input=json.dumps(event), text=True, capture_output=True)
        self.assertEqual(2, result.returncode)
        self.assertIn('language name', result.stderr)
        self.assertEqual('', result.stdout)


if __name__ == '__main__':
    unittest.main()
