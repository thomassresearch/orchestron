from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.app.services.compiler_common import PatchInstrumentTarget

_CONTROL_CHARACTER_PATTERN = re.compile(r"[\x00-\x1f\x7f]")


def format_orc_comment_value(value: str) -> str:
    if not _CONTROL_CHARACTER_PATTERN.search(value):
        return value
    return json.dumps(value, ensure_ascii=True)


def format_csd_comment_value(value: str) -> str:
    """Keep metadata on one comment line and outside CSD markup."""
    formatted = format_orc_comment_value(value)
    if formatted.endswith("\\"):
        formatted = json.dumps(formatted, ensure_ascii=False)
    return formatted.replace("<", "\\x3c").replace(">", "\\x3e")


def instrument_metadata_comments(target: PatchInstrumentTarget, instrument_ref: str) -> list[str]:
    text = format_csd_comment_value
    lines = [
        f"; patch:{text(target.patch.id)} name:{text(target.patch.name)} channel:{target.midi_channel} "
        f"always_on:{'true' if target.always_on else 'false'}",
        f"; instance:{text(target.assignment_id or target.patch.id)} csound:{text(instrument_ref)}",
    ]
    for index, line in enumerate(target.patch.description.splitlines()):
        lines.append(f"; {'description: ' if index == 0 else '  '}{text(line)}")
    return lines
