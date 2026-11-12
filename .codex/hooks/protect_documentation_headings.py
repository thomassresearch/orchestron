"""Preview documentation edits and reject prohibited headings before writing."""

import html
import json
from pathlib import Path
import re
import sys
import unicodedata

from protect_example_exports import (
    PATH_KEYS, DESTINATION_KEYS, absolute, shell_destinations, structured_destinations,
)

REPO = Path(__file__).resolve().parents[2]
HEADER = re.compile(r"^\*\*\* (Add File|Update File|Delete File): (.+)$", re.M)
LANGUAGE = re.compile(r"^(english|french|german|spanish|francais|deutsch|espanol)\b", re.I)


def plain_title(text):
    text = re.sub(r"!?\[([^]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\](?:\[[^]]*\])?", r"\1", text)
    text = html.unescape(re.sub(r"<[^>]*>", "", text))
    text = text.replace("\\", "").translate(str.maketrans("", "", "*_`"))
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " ".join(text.split()).strip()


def headings(content):
    """ATX, Setext and HTML headings, excluding fences and HTML comments."""
    content = re.sub(r"<!--.*?(?:-->|\Z)", lambda m: "\n" * m[0].count("\n"), content, flags=re.S)
    fence = None
    paragraph = []
    visible = []
    for number, raw in enumerate(content.splitlines(), 1):
        line = re.sub(r"^(?: {0,3}> ?)+", "", raw)
        visible.append(line)
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            visible[-1] = ''
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not marker[2].strip():
                fence = None
            continue
        if marker and (marker[1][0] == "~" or "`" not in marker[2]):
            visible[-1] = ''
            fence = marker[1]
            paragraph = []
            continue
        if line.startswith(('    ', '\t')) or not line.strip():
            visible[-1] = ''
            paragraph = []
            continue
        atx = re.match(r"^ {0,3}#{1,6}(?:[ \t]+(.*)|$)", line)
        if atx:
            yield number, re.sub(r"[ \t]+#+[ \t]*$", "", atx[1] or "")
            paragraph = []
        elif re.fullmatch(r" {0,3}(?:=+|-+)[ \t]*", line) and paragraph:
            yield paragraph[0][0], " ".join(text for _, text in paragraph)
            paragraph = []
        else:
            paragraph.append((number, line))
    visible_text = "\n".join(visible)
    for match in re.finditer(r"<h([1-6])(?:\s[^>]*)?>(.*?)</h\1\s*>", visible_text, re.I | re.S):
        yield visible_text[:match.start()].count("\n") + 1, match[2]


def violations(content):
    found = []
    for number, title in headings(content):
        normalized = plain_title(title)
        if LANGUAGE.match(normalized):
            found.append((number, title, "Headings must not start with a language name; use an English topic title."))
        elif normalized.casefold() == "screenshots":
            found.append((number, title, 'Do not use a standalone "Screenshots" heading; place each image beside the text it illustrates.'))
    return found


def documentation_path(value, cwd, repo):
    path = absolute(value, cwd).resolve()
    return path if path.suffix.lower() == '.md' and path.is_relative_to((repo / 'documentation').resolve()) else None


def check_content(path, content):
    errors = violations(content)
    if not errors:
        return None
    return "Cannot save documentation:\n" + '\n'.join(
        f'{path}:{line}: {title!r}. {reason}' for line, title, reason in errors
    )


def apply_update(original, body):
    """Apply context hunks in memory; uncertain previews fail closed."""
    lines = original.splitlines()
    cursor = 0
    hunks = []
    current = []
    for line in body:
        if line.startswith('@@'):
            if current:
                hunks.append(current)
                current = []
        elif line == '*** End of File':
            continue
        elif line[:1] in {' ', '+', '-'} or line == '':
            current.append(line or ' ')
        else:
            raise ValueError('unsupported patch line')
    if current:
        hunks.append(current)
    for hunk in hunks:
        before = [line[1:] for line in hunk if line[0] in ' -']
        after = [line[1:] for line in hunk if line[0] in ' +']
        positions = [i for i in range(cursor, len(lines) - len(before) + 1) if lines[i:i + len(before)] == before]
        if not before:
            position = len(lines)
        elif len(positions) == 1:
            position = positions[0]
        else:
            raise ValueError('patch context is missing or ambiguous; include more unchanged context')
        lines[position:position + len(before)] = after
        cursor = position + len(after)
    return '\n'.join(lines) + '\n'


def patch_previews(command, cwd, repo):
    headers = list(HEADER.finditer(command))
    for index, match in enumerate(headers):
        action, source = match.groups()
        if action == 'Delete File':
            continue
        end = headers[index + 1].start() if index + 1 < len(headers) else command.index('*** End Patch')
        body = command[match.end():end].strip('\n').splitlines()
        destination = source
        if body and body[0].startswith('*** Move to: '):
            destination = body.pop(0)[13:]
        path = documentation_path(destination, cwd, repo)
        if path is None:
            continue
        if action == 'Add File':
            if any(not line.startswith('+') for line in body):
                raise ValueError('unsupported added-file patch')
            content = '\n'.join(line[1:] for line in body) + '\n'
        else:
            content = apply_update(absolute(source, cwd).read_text(encoding='utf-8'), body)
        yield path, content


def blocking_reason(event, repo=REPO):
    name = event.get('tool_name', '')
    args = event.get('tool_input', {})
    directory = args.get('workdir') or args.get('cwd') if isinstance(args, dict) else None
    cwd = absolute(directory or event.get('cwd') or str(repo), Path(event.get('cwd') or repo)).resolve()
    command = args.get('command', args.get('cmd', args.get('patch', ''))) if isinstance(args, dict) else args
    try:
        if isinstance(command, str) and command.startswith('*** Begin Patch'):
            for path, content in patch_previews(command, cwd, repo):
                reason = check_content(path, content)
                if reason:
                    return reason
        elif re.search(r'(?:bash|shell|terminal|exec)', name, re.I):
            for value, directory in shell_destinations(command, cwd) if isinstance(command, str) else ():
                path = documentation_path(value, directory, repo)
                if path:
                    return f'Cannot save {path} through a shell command: the resulting Markdown cannot be checked before writing. Use apply_patch or a structured Write/Edit tool so documentation headings can be validated.'
        elif re.search(r'(?:read|list|delete|remove|directory)', name, re.I):
            return None
        elif re.search(r'(?:write|edit|patch|create|save|move|rename|copy)', name, re.I):
            for value in structured_destinations(args, PATH_KEYS | DESTINATION_KEYS):
                path = documentation_path(value, cwd, repo)
                if path is None:
                    continue
                if not isinstance(args, dict):
                    raise ValueError('unsupported write input')
                if 'content' in args:
                    content = args['content']
                elif 'text' in args and 'edits' not in args:
                    content = args['text']
                else:
                    content = path.read_text(encoding='utf-8')
                    edits = args.get('edits', [args])
                    for edit in edits:
                        old = edit.get('old_string', edit.get('oldText'))
                        new = edit.get('new_string', edit.get('newText'))
                        if not isinstance(old, str) or not isinstance(new, str) or not old:
                            raise ValueError('unsupported edit; use apply_patch or Write with full content')
                        if old not in content or (content.count(old) != 1 and not edit.get('replace_all')):
                            raise ValueError('edit text is missing or ambiguous')
                        content = content.replace(old, new, -1 if edit.get('replace_all') else 1)
                if not isinstance(content, str):
                    raise ValueError('content must be text')
                reason = check_content(path, content)
                if reason:
                    return reason
    except (OSError, ValueError) as error:
        return f'Cannot validate documentation before saving: {error}. Use a complete Write or an unambiguous apply_patch edit.'
    return None


def main():
    if sys.argv[1:] == ['--check']:
        errors = [reason for path in sorted((REPO / 'documentation').rglob('*.md'))
                  if (reason := check_content(path, path.read_text(encoding='utf-8')))]
        if errors:
            print('\n'.join(errors), file=sys.stderr)
            return 2
        print('Documentation headings: OK')
        return 0
    reason = blocking_reason(json.load(sys.stdin))
    if reason:
        print(reason, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
