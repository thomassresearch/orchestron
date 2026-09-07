from copy import deepcopy

import pytest

from backend.tests.api_test_support import _client, _audio_source_patch_payload, _always_on_effect_patch_payload


def session_payload(client):
    patch = client.post("/api/patches", json=_audio_source_patch_payload()).json()
    return {
        "instruments": [{"id": "source", "patch_id": patch["id"], "midi_channel": 1}],
        "audio_graph": {"routes": [], "insertOwners": {}, "masterId": None},
        "mixer": {"strips": {"source": {"gainDb": -6, "balance": 0.25, "mute": False, "solo": True}}, "sends": {}},
    }


def test_mixer_partial_updates_revisions_and_restart_initialization(tmp_path):
    with _client(tmp_path) as client:
        payload = session_payload(client)
        response = client.post("/api/sessions", json=payload)
        assert response.status_code == 201, response.text
        sid = response.json()["session_id"]
        url = f"/api/sessions/{sid}/mixer"
        assert client.get(url).json()["revision"] == 0
        result = client.put(url, json={"revision": 0, "strips": {"source": {"gainDb": None}}})
        assert result.status_code == 200, result.text
        assert result.json()["mixer"]["strips"]["source"] == {
            "gainDb": None,
            "balance": 0.25,
            "mute": False,
            "solo": True,
        }
        assert client.put(url, json={"revision": 0, "strips": {"source": {"mute": True}}}).status_code == 409
        assert client.get(url).json() == result.json()
        assert client.put(url, json={"strips": {"missing": {"gainDb": 0}}}).status_code == 422
        assert client.put(url, json={"strips": {"source": {"gainDb": 13}}}).status_code == 422
        compiled = client.post(f"/api/sessions/{sid}/compile")
        assert compiled.status_code == 200, compiled.text
        assert compiled.json()["manifest"]["instrumentReferences"]["source"]
        assert "chnset 0" in compiled.json()["orc"]
        assert client.post(f"/api/sessions/{sid}/start").status_code == 200
        assert client.post(f"/api/sessions/{sid}/stop").status_code == 200
        assert client.put(url, json={"strips": {"source": {"gainDb": -3}}}).status_code == 200
        assert client.post(f"/api/sessions/{sid}/start").status_code == 200
        assert client.get(url).json()["mixer"]["strips"]["source"]["gainDb"] == -3


def test_preview_uses_draft_without_mutating_library(tmp_path):
    with _client(tmp_path) as client:
        payload = session_payload(client)
        saved = client.get("/api/patches/" + payload["instruments"][0]["patch_id"]).json()
        draft = deepcopy(saved)
        draft["id"] = "temporary-draft"
        draft["name"] = "Preview only"
        payload["instruments"][0]["patch_id"] = draft["id"]
        response = client.post("/api/sessions/preview", json={"session": payload, "patches": [draft]})
        assert response.status_code == 201, response.text
        sid = response.json()["session_id"]
        assert client.post(f"/api/sessions/{sid}/compile").status_code == 200
        assert client.get("/api/patches/temporary-draft").status_code == 404
        assert client.get("/api/patches/" + saved["id"]).json() == saved
        assert client.delete(f"/api/sessions/{sid}").status_code == 204
        assert client.get(f"/api/sessions/{sid}/mixer").status_code == 404


@pytest.mark.parametrize("broken", ["source", "port", "cycle"])
def test_explicit_graph_rejects_broken_references_and_cycles(tmp_path, broken):
    with _client(tmp_path) as client:
        payload = session_payload(client)
        fx = client.post("/api/patches", json=_always_on_effect_patch_payload()).json()
        payload["instruments"].append({"id": "fx", "patch_id": fx["id"], "midi_channel": 0})
        route = {"id": "r", "sourceId": "source", "sourcePort": "$direct.left", "targetId": "fx", "targetPort": "left"}
        if broken == "source":
            route["sourceId"] = "missing"
        if broken == "port":
            route["targetPort"] = "missing"
        if broken == "cycle":
            route.update(sourceId="fx", sourcePort="$direct.left")
        payload["audio_graph"]["routes"] = [route]
        assert client.post("/api/sessions", json=payload).status_code == 422


def test_new_and_legacy_routing_cannot_conflict(tmp_path):
    with _client(tmp_path) as client:
        payload = session_payload(client)
        payload["instruments"][0]["effect_source_ids"] = ["source"]
        assert client.post("/api/sessions", json=payload).status_code == 422


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_performance_csd_modes_embed_mixer_and_preserve_velocities(tmp_path, mode):
    from io import BytesIO
    import zipfile
    from backend.tests.test_api import _performance_csd_export_payload
    from backend.app.services.compiler_mixer import channel

    payload = _performance_csd_export_payload()
    config = payload["performanceExport"]["performance"]["config"]
    config.update(
        version=11,
        audioGraph={"routes": [], "masterId": None, "insertOwners": {}},
        mixer={
            "strips": {"one": {"gainDb": -6.020599913279624, "solo": True, "mute": True, "balance": 0.5}},
            "sends": {},
        },
    )
    config["instruments"][0]["id"] = "one"
    payload["eventSource"] = mode
    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200, response.text
        with zipfile.ZipFile(BytesIO(response.content)) as archive:
            csd = archive.read("Offline_Export/Offline_Export.csd").decode()
            assert f'chnset 0.5, "{channel("strip", "one", "gain")}"' in csd
            assert f'chnset 0, "{channel("strip", "one", "mute")}"' in csd
            assert "sr = 48000" in csd and "ksmps = 1" in csd
            if mode == "midiFile":
                import mido

                midi = mido.MidiFile(file=BytesIO(archive.read("Offline_Export/Offline_Export.mid")))
                assert [m.velocity for t in midi.tracks for m in t if m.type == "note_on"] == [100]
        native = client.post("/api/bundles/export/performance", json=payload["performanceExport"])
        imported = client.post(
            "/api/bundles/import/expand", content=native.content, headers={"X-File-Name": "mix.orch.json"}
        )
        assert imported.json()["performance"]["config"] == config


def test_browser_controller_mixer_updates_require_ownership_and_acknowledge(tmp_path):
    with _client(tmp_path) as client:
        sid = client.post("/api/sessions", json=session_payload(client)).json()["session_id"]
        assert client.post(f"/api/sessions/{sid}/start").status_code == 200
        with client.websocket_connect(f"/ws/sessions/{sid}/browser-clock") as ws:
            ws.send_json(
                {"type": "mixer_update", "request_id": "before", "controls": {"strips": {"source": {"gainDb": -2}}}}
            )
            assert ws.receive_json()["type"] == "mixer_error"
            ws.send_json(
                {
                    "type": "claim_controller",
                    "audio_context_sample_rate": 48000,
                    "queue_low_water_frames": 1024,
                    "queue_high_water_frames": 2048,
                    "max_blocks_per_request": 8,
                }
            )
            assert ws.receive_json()["type"] == "stream_config"
            ws.send_json(
                {
                    "type": "mixer_update",
                    "request_id": "owned",
                    "controls": {"revision": 0, "strips": {"source": {"gainDb": -2}}},
                }
            )
            result = ws.receive_json()
            assert result["type"] == "mixer_ack" and result["request_id"] == "owned"
            assert result["mixer"]["strips"]["source"]["gainDb"] == -2
            ws.send_json({"type": "mixer_update", "request_id": "stale", "controls": {"revision": 0}})
            assert ws.receive_json()["type"] == "mixer_error"


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_continuous_source_exports_without_note_events(tmp_path, mode):
    from backend.tests.test_api import _performance_csd_export_payload

    payload = _performance_csd_export_payload()
    config = payload["performanceExport"]["performance"]["config"]
    config.update(
        version=11, audioGraph={"routes": [], "masterId": None, "insertOwners": {}}, mixer={"strips": {}, "sends": {}}
    )
    config["instruments"][0].update(id="continuous", midiChannel=0)
    payload["performanceExport"]["patch_definitions"][0]["alwaysOn"] = True
    payload["sequencerConfig"]["tracks"] = []
    payload["eventSource"] = mode
    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 200, response.text


def test_legacy_session_level_adapter_converts_to_audio_gain(tmp_path):
    with _client(tmp_path) as client:
        payload = session_payload(client)
        payload.pop("audio_graph")
        payload.pop("mixer")
        payload["instruments"][0]["level"] = 5
        response = client.post("/api/sessions", json=payload)
        assert response.status_code == 201, response.text
        sid = response.json()["session_id"]
        assert client.get(f"/api/sessions/{sid}/mixer").json()["mixer"]["strips"]["source"]["gainDb"] == pytest.approx(
            -6.020599913279624
        )
        assert "level" not in response.json()["instruments"][0]
