from __future__ import annotations

import re

_CONTROL_CHARACTER_PATTERN = re.compile(r"[\x00-\x1f\x7f]")


def reject_control_characters(value: str, *, field_name: str) -> str:
    if _CONTROL_CHARACTER_PATTERN.search(value):
        raise ValueError(f"{field_name} cannot contain line breaks or control characters.")
    return value
