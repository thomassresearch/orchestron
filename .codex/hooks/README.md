# Repository Codex hooks

`protect_gitignore.py` runs before tool calls and rejects explicit edits to
`.gitignore` files with `gitignore must be maintained by the developer`.
It checks patch target paths (including moves), shell commands, and arguments
to file-writing tools. Simple shell reads such as `cat .gitignore` are allowed;
compound commands referencing `.gitignore` are conservatively blocked.
Developer edits outside Codex remain available.

This is a guard against explicit tool edits, not a filesystem access policy:
indirect scripts or commands that do not name `.gitignore` can bypass it.
Project hooks must be enabled and trusted in Codex; review the updated hook
definition in `/hooks` if Codex requests it. See the
[official hook documentation](https://developers.openai.com/codex/hooks).

`conditional_checks.py` records frontend/backend source state on prompt submission
and runs the relevant repository checks when Codex stops.

`protect_example_exports.py` rejects writes of supporting files directly inside
the example export folders. Only these case-sensitive suffixes are allowed:

| Folder | File suffixes |
| --- | --- |
| `examples/instruments/` | `.orch.instrument.zip`, `.orch.instrument.json` |
| `examples/performances/` | `.orch.zip`, `.orch.json` |

Create a subfolder for guides, scores, raw patches, audio, scripts, and other
supporting files. Subfolders may contain any file type. The rule applies to new
files and overwrites, checks filenames rather than export contents, and leaves
existing examples untouched. Reads, directory creation, deletion, and moving
files out of these folders are allowed.

The synchronous `PreToolUse` guard checks patch additions, updates and move
destinations; path fields on structured file-writing tools; shell output
redirection, `tee`, `touch`, `cp`, `mv`, and `install`; and literal Python writes
through `open`, `Path`, and common `shutil` operations in `python -c` commands or
heredocs. Shell `cd`, tool working directories, absolute and relative paths,
and existing symlink aliases are handled. A rejected tool call exits with code
2 and explains which export suffixes are allowed and that additional information
must be saved in a subfolder. A mixed call is rejected if any destination fails.

This is an explicit-destination guard, not a shell interpreter or filesystem
sandbox. It does not inspect arbitrary external scripts, dynamically generated
paths, shell expansion, or every programming language/tool convention. Such
indirect writes can bypass inspection. Project hooks must be enabled and trusted;
review the changed definition in `/hooks` if Codex requests it. No user-global
hook configuration is required.

Run the focused regression tests from the repository root:

```sh
python3 -m unittest discover -s .codex/hooks/tests -v
```
