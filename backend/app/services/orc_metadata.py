from __future__ import annotations

import json
import re

_CONTROL_CHARACTER_PATTERN = re.compile(r"[\x00-\x1f\x7f]")


def format_orc_comment_value(value: str) -> str:
    if not _CONTROL_CHARACTER_PATTERN.search(value):
        return value
    return json.dumps(value, ensure_ascii=True)
