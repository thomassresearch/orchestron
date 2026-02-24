from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.main import create_app


def test_startup_initializes_missing_sqlite_db_file_and_parent_dir(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "backend" / "data" / "visualcsound.db"
    static_dir = tmp_path / "static"
    frontend_dist = tmp_path / "frontend_dist"
    gen_audio_assets_dir = tmp_path / "gen_audio_assets"

    assert not db_path.parent.exists()
    assert not db_path.exists()

    frontend_dist.mkdir(parents=True, exist_ok=True)
    (frontend_dist / "index.html").write_text("<!doctype html><html><body>client-ok</body></html>")

    monkeypatch.setenv("VISUALCSOUND_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("VISUALCSOUND_STATIC_DIR", str(static_dir))
    monkeypatch.setenv("VISUALCSOUND_FRONTEND_DIST_DIR", str(frontend_dist))
    monkeypatch.setenv("VISUALCSOUND_GEN_AUDIO_ASSETS_DIR", str(gen_audio_assets_dir))
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    get_settings.cache_clear()

    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200

    assert db_path.exists()
    assert db_path.parent.exists()

    with sqlite3.connect(db_path) as connection:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }

    assert {"patches", "performances", "app_state"} <= table_names

    get_settings.cache_clear()
