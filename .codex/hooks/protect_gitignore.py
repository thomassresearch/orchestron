"""Reject explicit Codex tool edits to developer-maintained .gitignore files."""

import json
from pathlib import PurePosixPath
import re
import shlex
import sys


MESSAGE = "gitignore must be maintained by the developer"
GITIGNORE = re.compile(r"(?<![\w.-])\.gitignore(?![\w.-])")
PATCH_PATH = re.compile(r"^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$", re.MULTILINE)
READ_COMMANDS = {"cat", "head", "tail", "stat", "ls", "wc", "grep"}


def contains_gitignore(value):
    if isinstance(value, str):
        return bool(GITIGNORE.search(value))
    if isinstance(value, dict):
        return any(contains_gitignore(item) for item in value.values())
    if isinstance(value, list):
        return any(contains_gitignore(item) for item in value)
    return False


def simple_read(command):
    """Only exempt a single read command without shell expansion or operators."""
    if any(character in command for character in "\n;|&<>`$()"):
        return False
    try:
        words = shlex.split(command)
    except ValueError:
        return False
    return bool(words) and PurePosixPath(words[0]).name in READ_COMMANDS


def blocks(event):
    name = event.get("tool_name", "")
    arguments = event.get("tool_input", {})
    if name in {"apply_patch", "Edit", "Write"}:
        command = arguments.get("command", "") if isinstance(arguments, dict) else arguments
        if isinstance(command, str) and command.startswith("*** Begin Patch"):
            return any(contains_gitignore(path) for path in PATCH_PATH.findall(command))
        return contains_gitignore(arguments)
    if name in {"Bash", "exec_command"}:
        command = arguments.get("command", arguments.get("cmd", ""))
        return contains_gitignore(command) and not simple_read(command)
    # Cover file-writing MCP/local tools that supply paths in their arguments.
    if re.search(r"(?:write|edit|patch|delete|remove|move|rename|copy|exec|shell|terminal)", name, re.I):
        return contains_gitignore(arguments)
    return False


def main():
    if blocks(json.load(sys.stdin)):
        print(MESSAGE, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
