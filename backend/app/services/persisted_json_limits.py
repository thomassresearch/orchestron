from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


DEFAULT_APP_STATE_MAX_BYTES = 8 * 1024 * 1024
DEFAULT_PATCH_GRAPH_MAX_BYTES = 4 * 1024 * 1024
DEFAULT_PATCH_UI_LAYOUT_MAX_BYTES = 1 * 1024 * 1024
DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES = 8 * 1024 * 1024
DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES = 64 * 1024
PERSISTED_JSON_REQUEST_OVERHEAD_BYTES = 256 * 1024


@dataclass(frozen=True)
class PersistedJsonLimitViolation:
    field_name: str
    message: str
    size_bytes: int
    max_bytes: int


class PersistedJsonLimitError(ValueError):
    def __init__(self, violation: PersistedJsonLimitViolation) -> None:
        super().__init__(violation.message)
        self.violation = violation


def dump_compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def compact_json_size_bytes(value: Any) -> int:
    return len(dump_compact_json(value).encode("utf-8"))


def assert_json_document_size(*, value: Any, field_name: str, max_bytes: int) -> None:
    size_bytes = compact_json_size_bytes(value)
    if size_bytes > max_bytes:
        raise PersistedJsonLimitError(
            PersistedJsonLimitViolation(
                field_name=field_name,
                message=f"{field_name} exceeds maximum persisted JSON size ({max_bytes} bytes).",
                size_bytes=size_bytes,
                max_bytes=max_bytes,
            )
        )


def assert_json_string_sizes(*, value: Any, field_name: str, max_bytes: int) -> None:
    violation = _find_oversized_string(value=value, path=field_name, max_bytes=max_bytes)
    if violation:
        raise PersistedJsonLimitError(violation)


def assert_persisted_json_limits(
    *,
    value: Any,
    field_name: str,
    max_document_bytes: int,
    max_string_bytes: int,
) -> None:
    assert_json_string_sizes(value=value, field_name=field_name, max_bytes=max_string_bytes)
    assert_json_document_size(value=value, field_name=field_name, max_bytes=max_document_bytes)


def _find_oversized_string(*, value: Any, path: str, max_bytes: int) -> PersistedJsonLimitViolation | None:
    if isinstance(value, str):
        size_bytes = len(value.encode("utf-8"))
        if size_bytes > max_bytes:
            return PersistedJsonLimitViolation(
                field_name=path,
                message=f"{path} exceeds maximum persisted JSON string size ({max_bytes} bytes).",
                size_bytes=size_bytes,
                max_bytes=max_bytes,
            )
        return None

    if isinstance(value, Mapping):
        for key, child in value.items():
            child_path = f"{path}.{key}" if isinstance(key, str) and key.isidentifier() else f"{path}[{key!r}]"
            violation = _find_oversized_string(value=child, path=child_path, max_bytes=max_bytes)
            if violation:
                return violation
        return None

    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        for index, child in enumerate(value):
            violation = _find_oversized_string(value=child, path=f"{path}[{index}]", max_bytes=max_bytes)
            if violation:
                return violation

    return None
