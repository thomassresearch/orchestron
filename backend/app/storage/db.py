from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


class PatchRecord(Base):
    __tablename__ = "patches"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=False, default="")
    is_template = Column(Boolean, nullable=False, default=False)
    always_on = Column(Boolean, nullable=False, default=False)
    schema_version = Column(Integer, nullable=False, default=1)
    graph_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class PerformanceRecord(Base):
    __tablename__ = "performances"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=False, default="")
    config_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class AppStateRecord(Base):
    __tablename__ = "app_state"

    id = Column(String(64), primary_key=True)
    state_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class Database:
    def __init__(self, database_url: str) -> None:
        self.engine = create_engine(database_url, future=True, connect_args={"check_same_thread": False})
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, class_=Session)

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)
        self._ensure_patch_template_column()
        self._ensure_patch_always_on_column()

    def _ensure_patch_template_column(self) -> None:
        self._ensure_patch_boolean_column("is_template")

    def _ensure_patch_always_on_column(self) -> None:
        self._ensure_patch_boolean_column("always_on")

    def _ensure_patch_boolean_column(self, column_name: str) -> None:
        inspector = inspect(self.engine)
        if "patches" not in inspector.get_table_names():
            return
        column_names = {column["name"] for column in inspector.get_columns("patches")}
        if column_name in column_names:
            return
        with self.engine.begin() as connection:
            connection.exec_driver_sql(f"ALTER TABLE patches ADD COLUMN {column_name} BOOLEAN NOT NULL DEFAULT 0")

    @contextmanager
    def session(self) -> Session:
        db = self.session_factory()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
