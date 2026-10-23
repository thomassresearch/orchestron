"""Reject explicit writes of supporting files to the two example export roots.

This inspects tool inputs, not arbitrary program execution. Keep the supported
shell and inline-Python forms in sync with README.md and the regression tests.
"""

import ast
import json
import os
from pathlib import Path
import re
import shlex
import sys


REPO = Path(__file__).resolve().parents[2]
EXPORTS = {
    "instruments": (".orch.instrument.zip", ".orch.instrument.json"),
    "performances": (".orch.zip", ".orch.json"),
}
PATCH_HEADER = re.compile(r"^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$", re.MULTILINE)
PATH_KEYS = {"path", "file_path", "filepath", "filename", "file_name", "target", "target_path"}
DESTINATION_KEYS = {"destination", "destination_path", "dest", "dst", "new_path", "to", "target_path", "target"}
SEPARATORS = {";", "&&", "||", "|", "&", "\n", "(", ")"}
REDIRECTS = {">", ">>", ">|", "&>", "&>>"}
SHELL_TOKEN = re.compile(
    r'''[ \t\r]+|\#[^\n]*|\n|[;&|<>()]+|(?:\\.|"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|<>()"'\\])+'''
)


def absolute(path, cwd):
    return Path(path) if Path(path).is_absolute() else cwd / path


def error_for(path, cwd, repo=REPO):
    """Check both the written name and its resolved symlink destination."""
    if not isinstance(path, str) or not path:
        return None
    candidate = absolute(path, cwd)
    # abspath normalizes '..' without discarding the name of a symlink itself.
    for target in (Path(os.path.abspath(candidate)), candidate.resolve()):
        for kind, suffixes in EXPORTS.items():
            folder = repo / "examples" / kind
            if target.parent == folder.resolve() and not target.name.endswith(suffixes):
                allowed = " and ".join(f"`*{suffix}`" for suffix in suffixes)
                return (
                    f"Cannot write `{path}`. Only {allowed} exports may be stored directly in "
                    f"`examples/{kind}/`. Additional information for {kind} must be stored in a "
                    f"subfolder instead of the top-level {kind} folder."
                )
    return None


def copy_destination(source, destination, cwd):
    """cp/mv/shutil interpret an existing directory as a container."""
    if absolute(destination, cwd).is_dir() or destination.endswith("/"):
        return str(Path(destination) / Path(source).name)
    return destination


def patch_destinations(patch):
    headers = PATCH_HEADER.findall(patch)
    for index, (action, path) in enumerate(headers):
        if action == "Delete File":
            continue
        if action == "Update File" and index + 1 < len(headers) and headers[index + 1][0] == "Move to":
            continue
        yield path


def python_destinations(source, cwd):
    """Recognize literal Python file writes without executing the script."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return
    bindings = {}

    def literal(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return bindings.get(node.id)
        if isinstance(node, ast.Call) and name_of(node.func) in {"Path", "pathlib.Path"} and node.args:
            return literal(node.args[0])
        if isinstance(node, ast.BinOp):
            left, right = literal(node.left), literal(node.right)
            if left is not None and right is not None:
                if isinstance(node.op, ast.Div):
                    return str(Path(left) / right)
                if isinstance(node.op, ast.Add):
                    return left + right
        return None

    # Walk in source order so simple assignments can supply literal paths.
    for node in sorted(ast.walk(tree), key=lambda item: (getattr(item, "lineno", 0), getattr(item, "col_offset", 0))):
        if isinstance(node, ast.Assign):
            value = literal(node.value)
            for target in node.targets:
                if isinstance(target, ast.Name):
                    bindings[target.id] = value
        if not isinstance(node, ast.Call):
            continue
        name = name_of(node.func)
        args = node.args
        keywords = {keyword.arg: keyword.value for keyword in node.keywords}
        if name in {"open", "io.open"} or (isinstance(node.func, ast.Attribute) and node.func.attr == "open"):
            path_open = isinstance(node.func, ast.Attribute) and name not in {"io.open", "builtins.open"}
            path = literal(node.func.value) if path_open else literal(args[0]) if args else literal(keywords.get("file"))
            mode_index = 0 if path_open else 1
            mode_node = keywords.get("mode", args[mode_index] if len(args) > mode_index else None)
            mode = literal(mode_node) if mode_node is not None else "r"
            if path and mode and any(flag in mode for flag in "wax+"):
                yield path
        elif isinstance(node.func, ast.Attribute) and node.func.attr in {"write_text", "write_bytes", "touch"}:
            path = literal(node.func.value)
            if path:
                yield path
        elif name in {"shutil.copy", "shutil.copy2", "shutil.copyfile", "shutil.move", "os.rename", "os.replace"}:
            src = literal(args[0]) if args else literal(keywords.get("src"))
            dst = literal(args[1]) if len(args) > 1 else literal(keywords.get("dst"))
            if src and dst:
                yield copy_destination(src, dst, cwd) if name.startswith("shutil.") else dst
        elif isinstance(node.func, ast.Attribute) and node.func.attr in {"rename", "replace"} and args:
            path = literal(args[0])
            if path:
                yield path


def name_of(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return name_of(node.value) + "." + node.attr
    return ""


def shell_tokens(command):
    """Keep shell operators distinct from quoted/escaped punctuation arguments."""
    position = 0
    while position < len(command):
        match = SHELL_TOKEN.match(command, position)
        if not match:
            raise ValueError("Unsupported shell quoting")
        raw = match[0]
        position = match.end()
        if raw.startswith("#") or (raw.isspace() and raw != "\n"):
            continue
        syntax = raw == "\n" or all(character in ";&|<>()" for character in raw)
        yield (raw if syntax else shlex.split(raw)[0]), syntax


def shell_destinations(command, cwd):
    """Inspect shell destinations; never execute or expand shell input."""
    # Extract Python heredocs before shell lexing (their contents are not shell).
    heredoc = re.compile(r"(?m)^([^\n]*?)<<-?\s*(['\"]?)(\w+)\2([^\n]*)\n(.*?)^\3[ \t]*$", re.DOTALL)
    python_bodies = []

    def extract(match):
        if re.search(r"\bpython(?:3(?:\.\d+)?)?\b", match[1]):
            python_bodies.append(match[5])
        return match[1] + match[4] + "\n" * (match[0].count("\n"))

    shell = heredoc.sub(extract, command)
    try:
        tokens = list(shell_tokens(shell))
    except ValueError:
        return
    segments, segment = [], []
    for token, syntax in tokens:
        if syntax and token in SEPARATORS:
            segments.append(segment)
            segment = []
        else:
            segment.append((token, syntax))
    segments.append(segment)
    body_index = 0
    for segment in segments:
        words = []
        index = 0
        while index < len(segment):
            token, syntax = segment[index]
            if syntax and token in REDIRECTS and index + 1 < len(segment):
                yield segment[index + 1][0], cwd
                index += 2
            elif syntax and token in {"<", "<<", "<<<", ">&", "<&"} and index + 1 < len(segment):
                index += 2
            else:
                words.append(token)
                index += 1
        while words and (re.match(r"^\w+=", words[0]) or words[0] in {"command", "env"}):
            words.pop(0)
        if words[:2] == ["uv", "run"]:
            words = words[2:]
        if not words:
            continue
        executable = Path(words[0]).name
        operands = [word for word in words[1:] if not word.startswith("-")]
        if executable == "cd" and operands:
            cwd = absolute(operands[0], cwd).resolve()
        elif executable in {"bash", "sh", "zsh"} and any(re.fullmatch(r"-[a-zA-Z]*c", word) for word in words[1:]):
            position = next(index + 1 for index, word in enumerate(words) if re.fullmatch(r"-[a-zA-Z]*c", word))
            if position < len(words):
                yield from shell_destinations(words[position], cwd)
        elif executable in {"touch", "tee"}:
            for path in operands:
                yield path, cwd
        elif executable in {"cp", "mv", "install"} and "-d" not in words:
            target = None
            for flag in ("-t", "--target-directory"):
                if flag in words and words.index(flag) + 1 < len(words):
                    position = words.index(flag) + 1
                    target = words[position]
                    operands = [word for i, word in enumerate(words[1:], 1) if i != position and not word.startswith("-")]
            target = next((word.split("=", 1)[1] for word in words if word.startswith("--target-directory=")), target)
            if target is not None:
                for source in operands:
                    yield str(Path(target) / Path(source).name), cwd
            elif len(operands) >= 2:
                for source in operands[:-1]:
                    yield copy_destination(source, operands[-1], cwd), cwd
        elif re.fullmatch(r"python(?:3(?:\.\d+)?)?", executable):
            if "-c" in words and words.index("-c") + 1 < len(words):
                for path in python_destinations(words[words.index("-c") + 1], cwd):
                    yield path, cwd
            elif body_index < len(python_bodies):
                for path in python_destinations(python_bodies[body_index], cwd):
                    yield path, cwd
                body_index += 1


def structured_destinations(arguments, keys):
    if isinstance(arguments, dict):
        for key, value in arguments.items():
            if key in keys and isinstance(value, str):
                yield value
            elif isinstance(value, (dict, list)):
                yield from structured_destinations(value, keys)
    elif isinstance(arguments, list):
        for item in arguments:
            yield from structured_destinations(item, keys)


def blocking_reason(event, repo=REPO):
    name = event.get("tool_name", "")
    arguments = event.get("tool_input", {})
    directory = event.get("cwd") or str(repo)
    if isinstance(arguments, dict):
        directory = arguments.get("workdir") or arguments.get("cwd") or directory
    cwd = absolute(directory, Path(event.get("cwd") or repo)).resolve()
    command = arguments.get("command", arguments.get("cmd", "")) if isinstance(arguments, dict) else arguments
    if name == "apply_patch" or (name in {"Write", "Edit"} and isinstance(command, str) and command.startswith("*** Begin Patch")):
        destinations = ((path, cwd) for path in patch_destinations(command or ""))
    elif name in {"Bash", "exec_command"} or re.search(r"(?:shell|terminal|exec)", name, re.I):
        destinations = shell_destinations(command, cwd) if isinstance(command, str) else ()
    elif re.search(r"(?:mkdir|directory|delete|remove|read|list)", name, re.I):
        destinations = ()
    elif re.search(r"(?:write|edit|patch|create|save|move|rename|copy)", name, re.I):
        keys = DESTINATION_KEYS if re.search(r"move|rename|copy", name, re.I) else PATH_KEYS | DESTINATION_KEYS
        paths = structured_destinations(arguments, keys)
        source = arguments.get("source", arguments.get("src", "")) if isinstance(arguments, dict) else ""
        destinations = (
            (copy_destination(source, path, cwd) if source and re.search(r"move|copy", name, re.I) else path, cwd)
            for path in paths
        )
    else:
        destinations = ()
    for path, directory in destinations:
        reason = error_for(path, directory, repo)
        if reason:
            return reason
    return None


def main():
    reason = blocking_reason(json.load(sys.stdin))
    if reason:
        print(reason, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
