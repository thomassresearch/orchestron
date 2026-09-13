import json
import sqlite3
from io import BytesIO
from pathlib import Path
import zipfile

import pytest
from pydantic import ValidationError

from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.instrument_type import infer_instrument_type
from backend.app.models.patch import PatchCreateRequest
from backend.app.storage.db import Database
from backend.tests.api_test_support import _client

CASES = json.loads((Path(__file__).parent / "fixtures/instrument_types.json").read_text())
TYPES = ["percussion", "melody", "bass", "effects_noise", "continuous"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"] or "empty")
def test_inference_matches_shared_cases(case):
    assert infer_instrument_type(case["name"], case["description"], case["always_on"]) == case["expected"]
    patch = PatchCreateRequest(name=case["name"] or "Untitled", description=case["description"],
                               always_on=case["always_on"], graph={})
    assert patch.instrument_type == case["expected"]
    assert patch.always_on == case["always_on"]


@pytest.mark.parametrize("instrument_type", TYPES)
def test_type_api_round_trip_and_activation(tmp_path, instrument_type):
    with _client(tmp_path) as client:
        payload = {"name": "Bass Drum", "graph": {}, "instrument_type": instrument_type,
                   "always_on": instrument_type != "continuous"}
        created = client.post("/api/patches", json=payload)
        assert created.status_code == 201
        patch_id = created.json()["id"]
        expected = instrument_type == "continuous"
        assert created.json()["instrument_type"] == instrument_type
        assert created.json()["always_on"] is expected
        # Renaming must not reclassify an explicit category.
        updated = client.put(f"/api/patches/{patch_id}", json={"name": "Noise", "description": "A bass"})
        assert updated.json()["instrument_type"] == instrument_type
        assert client.get("/api/patches").json()[0]["instrument_type"] == instrument_type
    with _client(tmp_path) as client:
        loaded = client.get(f"/api/patches/{patch_id}").json()
        assert loaded["instrument_type"] == instrument_type
        assert loaded["always_on"] is expected
        changed = client.put(f"/api/patches/{patch_id}", json={"instrument_type": "bass", "always_on": True})
        assert changed.json()["instrument_type"] == "bass"
        assert changed.json()["always_on"] is False


def test_legacy_activation_updates_and_invalid_types(tmp_path):
    with _client(tmp_path) as client:
        patch = client.post("/api/patches", json={"name": "Kick", "graph": {}}).json()
        url = f"/api/patches/{patch['id']}"
        assert patch["instrument_type"] == "percussion"
        assert client.put(url, json={"always_on": True}).json()["instrument_type"] == "continuous"
        assert client.put(url, json={"always_on": False}).json()["instrument_type"] == "percussion"
        client.put(url, json={"instrument_type": "bass"})
        assert client.put(url, json={"always_on": False}).json()["instrument_type"] == "bass"
        assert client.put(url, json={"instrument_type": "invalid"}).status_code == 422
        assert client.post("/api/patches", json={"name": "Bad", "graph": {}, "instrument_type": "invalid"}).status_code == 422


def test_legacy_database_migration_preserves_rows_and_is_idempotent(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE patches (id TEXT PRIMARY KEY, name TEXT, description TEXT, "
                   "always_on BOOLEAN, is_template BOOLEAN, schema_version INTEGER, graph_json TEXT, "
                   "created_at TEXT, updated_at TEXT)")
        for index, case in enumerate(CASES):
            db.execute("INSERT INTO patches VALUES (?, ?, ?, ?, ?, 1, '{}', '2020-01-01', '2020-01-02')",
                       (str(index), case["name"], case["description"], case["always_on"], index % 2))
        before = db.execute("SELECT * FROM patches ORDER BY id").fetchall()
    database = Database(f"sqlite:///{path}")
    database.create_all()
    database.create_all()
    with sqlite3.connect(path) as db:
        after = db.execute("SELECT * FROM patches ORDER BY id").fetchall()
        assert [row[:-1] for row in after] == before
        for row in after:
            assert row[-1] == CASES[int(row[0])]["expected"]
        db.execute("UPDATE patches SET instrument_type = 'bass' WHERE id = '0'")
    database.create_all()
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT instrument_type FROM patches WHERE id = '0'").fetchone()[0] == "bass"
    database.engine.dispose()


@pytest.mark.parametrize("key", ["instrumentType", "instrument_type"])
@pytest.mark.parametrize("instrument_type", TYPES)
def test_export_model_preserves_type_and_derives_activation(key, instrument_type):
    payload = {"sourcePatchId": "p", "name": "Bass Drum", "graph": {}, key: instrument_type,
               "alwaysOn": instrument_type != "continuous"}
    definition = ExportedPatchDefinition.model_validate(payload)
    assert definition.model_dump(by_alias=True)["instrumentType"] == instrument_type
    assert definition.always_on is (instrument_type == "continuous")
    with pytest.raises(ValidationError):
        ExportedPatchDefinition.model_validate({**payload, key: "invalid"})


@pytest.mark.parametrize("zip_bundle", [False, True])
@pytest.mark.parametrize("performance", [False, True])
def test_bundle_transport_preserves_type(tmp_path, zip_bundle, performance):
    definition = {"sourcePatchId": "p", "name": "Sample", "description": "", "instrumentType": "percussion",
                  "alwaysOn": False, "schema_version": 1, "graph": {"nodes": [], "connections": [], "ui_layout": {}}}
    if zip_bundle:
        asset_dir = tmp_path / "gen_audio_assets"
        asset_dir.mkdir()
        (asset_dir / "sample.aiff").write_bytes(b"FORMfake")
        definition["graph"]["nodes"] = [{"id": "g1", "opcode": "GEN", "params": {}}]
        definition["graph"]["ui_layout"] = {"gen_nodes": {"g1": {
            "routineNumber": 1, "tableSize": 0, "sampleAsset": {"stored_name": "sample.aiff"}
        }}}
    payload = {"format": "orchestron.performance", "version": 1, "performance": {"name": "Set", "config": {}},
               "patch_definitions": [definition]} if performance else definition
    with _client(tmp_path) as client:
        response = client.post(f"/api/bundles/export/{'performance' if performance else 'patch'}", json=payload)
        assert response.status_code == 200
        assert response.headers["x-orchestron-export-format"] == ("zip" if zip_bundle else "json")
        if zip_bundle:
            with zipfile.ZipFile(BytesIO(response.content)) as archive:
                assert archive.read("audio/sample.aiff") == b"FORMfake"
        expanded = client.post("/api/bundles/import/expand", content=response.content,
                               headers={"X-File-Name": "test.zip" if zip_bundle else "test.json"})
        assert expanded.status_code == 200
        imported = expanded.json()["patch_definitions"][0] if performance else expanded.json()
        assert imported["instrumentType"] == "percussion"
        assert imported["alwaysOn"] is False
