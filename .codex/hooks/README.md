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
