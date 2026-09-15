from copy import deepcopy
import json
from pathlib import Path
import sqlite3

import numpy as np
import pytest

from backend.app.models.audio import AudioGraph, MixerState
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_mixer import CompilationError, ResolvedMixerGraph, channel
from backend.app.services.master_migration import is_neutral_master, normalize_master_config, normalize_master_bundle
from backend.app.storage.db import Database
from backend.app.storage.repositories.patch_repository import PatchRepository
from backend.app.storage.repositories.performance_repository import PerformanceRepository
from backend.app.models.performance import PerformanceDocument
from backend.tests.test_mixer_audio import compile_audio, source, effect, engine, render
from backend.tools.migrate_internal_master import migrate_database

FIXTURES = Path(__file__).parent / "fixtures"


def legacy_patch():
    return json.loads((FIXTURES / "patches/legacy_master.patch.json").read_text())


def legacy_config():
    return json.loads((FIXTURES / "performances/legacy_master.json").read_text())


def test_neutral_migration_keeps_controls_references_and_insert_ownership():
    config = legacy_config()
    config["audioGraph"]["insertOwners"] = {"effect": "old-master"}
    original = deepcopy(config)
    normalized = normalize_master_config(config, lambda _: legacy_patch())
    assert config == original
    assert normalized["instruments"] == config["instruments"][:1]
    assert normalized["mixer"]["strips"]["$master"] == config["mixer"]["strips"]["old-master"]
    assert normalized["audioGraph"]["insertOwners"] == {"effect": "$master"}
    assert {r["targetId"] for r in normalized["audioGraph"]["routes"]} == {"$master"}
    assert normalized["version"] == 14
    assert normalize_master_config(normalized, lambda _: None) == normalized


def test_custom_master_retains_patch_controls_and_routes_into_internal_output():
    patch = legacy_patch()
    patch["graph"]["nodes"].append({"id": "custom", "opcode": "const_a", "params": {"value": 0.1}})
    assert not is_neutral_master(patch)
    config = legacy_config()
    normalized = normalize_master_config(config, lambda _: patch)
    assert normalized["instruments"] == config["instruments"]
    assert normalized["mixer"] == config["mixer"]
    assert len(normalized["audioGraph"]["routes"]) == 4
    assert all(r["targetId"] == "$master" for r in normalized["audioGraph"]["routes"][2:])


def test_name_cannot_disguise_processing_and_missing_references_are_preserved():
    patch = legacy_patch()
    patch["graph"]["ui_layout"] = {"input_formulas": {"output::left": "in1 * 0.5"}}
    assert not is_neutral_master(patch)
    config = legacy_config()
    assert normalize_master_config(config, lambda _: None) == config


def test_bundle_conversion_omits_only_obsolete_master_definition():
    patch = legacy_patch()
    patch["sourcePatchId"] = patch.pop("id")
    payload = {"performance": {"config": legacy_config()}, "patch_definitions": [patch]}
    converted = normalize_master_bundle(payload)
    assert converted["patch_definitions"] == []
    assert converted["performance"]["config"]["audioGraph"]["masterId"] == "$master"


@pytest.mark.parametrize("ksmps", [1, 32])
def test_internal_master_matches_legacy_audio_and_live_gain(ksmps):
    config = legacy_config()
    config["audioGraph"]["routes"] = config["audioGraph"]["routes"][:1]
    patch = PatchDocument.model_validate(legacy_patch())
    patch.graph.engine_config.ksmps = ksmps
    patch.graph.engine_config.sr = 48000
    old = compile_audio([source(direct=False, ksmps=ksmps), PatchInstrumentTarget(
        patch=patch, midi_channel=0, always_on=True, assignment_id="old-master",
    )], AudioGraph.model_validate(config["audioGraph"]), MixerState.model_validate(config["mixer"]))
    converted = normalize_master_config(config, lambda _: legacy_patch())
    new = compile_audio([source(direct=False, ksmps=ksmps)], AudioGraph.model_validate(converted["audioGraph"]), MixerState.model_validate(converted["mixer"]))
    assert "$master" in new.manifest["meters"]
    with engine(old) as cs:
        before = render(cs)
    with engine(new) as cs:
        np.testing.assert_allclose(render(cs), before, atol=1e-12)
        cs.setControlChannel(channel("strip", "$master", "gain"), 0)
        np.testing.assert_allclose(render(cs, 1200 // ksmps)[-ksmps:], 0, atol=1e-12)


def test_internal_master_does_not_consume_rack_limit_and_rejects_reserved_assignments():
    targets = [source(str(index)) for index in range(64)]
    graph = ResolvedMixerGraph(targets, AudioGraph(masterId="$master"))
    assert len(graph.manifest()["instanceIds"]) == 65
    with pytest.raises(CompilationError):
        ResolvedMixerGraph(targets + [source("extra")], AudioGraph(masterId="$master"))
    with pytest.raises(CompilationError):
        ResolvedMixerGraph([source("$master")], AudioGraph(masterId="$master"))


@pytest.mark.parametrize("solo", [False, True])
def test_master_insert_and_solo_preserve_direct_output_bypass(solo):
    graph = AudioGraph.model_validate({"masterId": "$master", "insertOwners": {"insert": "$master"}, "routes": [
        {"id": "feed", "sourceId": "source", "sourcePort": "left", "targetId": "$master", "targetPort": "left"},
        {"id": "insert-in", "sourceId": "$master", "sourcePort": "$direct.left", "sourceStage": "raw", "targetId": "insert", "targetPort": "left", "kind": "insert"},
        {"id": "insert-out", "sourceId": "insert", "sourcePort": "left", "targetId": "$master", "targetPort": "$direct.left", "targetStage": "strip", "kind": "insert"},
    ]})
    mixer = MixerState.model_validate({"strips": {"$master": {"gainDb": -6.020599913279624}, "source": {"solo": solo}}})
    artifact = compile_audio([source(direct=False), effect("insert", factor=2), source("direct")], graph, mixer)
    with engine(artifact) as cs:
        samples = render(cs)
        np.testing.assert_allclose(samples[:, 0], 0.2 if solo else 0.4, atol=1e-9)
        np.testing.assert_allclose(samples[:, 1], 0 if solo else 0.2, atol=1e-9)
        cs.setControlChannel(channel("strip", "$master", "gain"), 0)
        samples = render(cs)
        np.testing.assert_allclose(samples[-32:], 0 if solo else 0.2, atol=1e-9)


def test_database_migration_is_backed_up_and_repeatable(tmp_path):
    path = tmp_path / "migration.db"
    db = Database("sqlite:///" + str(path))
    db.create_all()
    patches = PatchRepository(db.session)
    patches.create(PatchDocument.model_validate(legacy_patch()))
    PerformanceRepository(db.session).create(PerformanceDocument(name="Saved", config=legacy_config()))
    preview = migrate_database(path)
    assert preview["updated_documents"] == 1
    assert patches.get("legacy-master-patch") is not None
    result = migrate_database(path, apply=True)
    assert result["removed_patch_ids"] == ["legacy-master-patch"]
    with sqlite3.connect(result["backup"]) as backup:
        assert backup.execute("SELECT count(*) FROM patches").fetchone()[0] == 1
        assert json.loads(backup.execute("SELECT config_json FROM performances").fetchone()[0])["version"] == 13
    assert patches.get("legacy-master-patch") is None
    again = migrate_database(path, apply=True)
    assert again["updated_documents"] == 0 and again["removed_patch_ids"] == [] and again["backup"] is None


def test_cleanup_preserves_edited_drafts_and_shared_output_patches(tmp_path):
    from backend.app.models.app_state import AppStateDocument
    from backend.app.storage.repositories.app_state_repository import AppStateRepository

    path = tmp_path / "drafts.db"
    db = Database("sqlite:///" + str(path))
    db.create_all()
    patches = PatchRepository(db.session)
    patches.create(PatchDocument.model_validate(legacy_patch()))
    draft = legacy_patch()
    draft["description"] = "Unsaved user edit"
    state = {"version": 2, "sequencerInstruments": legacy_config()["instruments"],
             "audioGraph": legacy_config()["audioGraph"], "mixer": legacy_config()["mixer"],
             "instrumentTabs": [{"id": "draft", "patch": draft}], "activeInstrumentTabId": "draft"}
    repository = AppStateRepository(db.session)
    repository.upsert(AppStateDocument(state=state))
    result = migrate_database(path, apply=True)
    assert result["removed_patch_ids"] == []
    restored = repository.get("last").state
    assert restored["instrumentTabs"] == state["instrumentTabs"]
    assert restored["audioGraph"]["masterId"] == "$master"
    assert patches.get("legacy-master-patch") is not None


def test_embedded_master_definitions_are_removed_before_frontend_hydration():
    config = legacy_config()
    patch = legacy_patch()
    patch["sourcePatchId"] = patch.pop("id")
    config["patchDefinitions"] = [patch]
    migrated = normalize_master_config(config, lambda _: None)
    assert migrated["patchDefinitions"] == []
    assert migrated["instruments"] == config["instruments"][:1]


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_offline_modes_generate_internal_master_without_a_patch_definition(tmp_path, mode):
    from io import BytesIO
    import zipfile
    from backend.tests.api_test_support import _client
    from backend.tests.test_api import _performance_csd_export_payload

    payload = _performance_csd_export_payload()
    exported = payload["performanceExport"]
    config = exported["performance"]["config"]
    old = legacy_config()
    config.update(audioGraph=old["audioGraph"], mixer=old["mixer"], version=13)
    config["instruments"][0]["id"] = "source"
    config["instruments"].append(old["instruments"][1])
    for route in config["audioGraph"]["routes"]:
        route["sourcePort"] = "$direct." + route["sourcePort"]
    patch = legacy_patch()
    patch["sourcePatchId"] = patch.pop("id")
    exported["patch_definitions"].append(patch)
    payload["eventSource"] = mode
    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200, response.text
        with zipfile.ZipFile(BytesIO(response.content)) as archive:
            csd = archive.read("Offline_Export/Offline_Export.csd").decode()
        assert "Master [$master]" in csd
        assert channel("strip", "$master", "gain") in csd
        assert "old-master" not in csd
        native = client.post("/api/bundles/export/performance", json=exported)
        assert native.status_code == 200, native.text
        assert len(native.json()["patch_definitions"]) == 1
