from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import datetime, timezone
from typing import Protocol

from sqlalchemy.orm import Session


class DbSessionFactory(Protocol):
    """Repository transaction boundary supplied by Database.session."""

    def __call__(self) -> AbstractContextManager[Session]: ...


def ensure_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
