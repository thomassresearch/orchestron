from copy import deepcopy
from io import BytesIO
import re
import zipfile

import mido
import pytest

from backend.app.models.export import PerformanceCsdExportRequest
from backend.app.services.compiler_mixer import token
from backend.app.services.performance_export_selection import select_performance_csd_instruments
from backend.tests.api_test_support import (
    _always_on_effect_patch_payload,
    _always_on_effect_with_outlets_patch_payload,
    _audio_outlet_only_source_patch_payload,
    _audio_source_patch_payload,
    _client,
)
from backend.tests.test_api import _performance_csd_export_payload
from backend.tests.test_control_flow import sound


def add_instrument(payload, identity, channel=0, *, patch=None, always_on=False, description=""):
    exported = payload["performanceExport"]
    exported["performance"]["config"]["instruments"].append(
        {"id": identity, "patchId": identity, "midiChannel": channel}
    )
    exported["patch_definitions"].append(
        {
            "sourcePatchId": identity,
            "name": identity,
            "description": description,
            "alwaysOn": always_on,
            "schema_version": 1,
            "graph": deepcopy((patch or _audio_source_patch_payload())["graph"]),
        }
    )


def route(identity, source, target, *, kind="main", source_stage="strip", target_stage="input", port="left"):
    return dict(
        id=identity,
        sourceId=source,
        sourcePort=port,
        targetId=target,
        targetPort=port,
        kind=kind,
        sourceStage=source_stage,
        targetStage=target_stage,
    )


def read_export(client, payload):
    response = client.post("/api/bundles/export/performance-csd", json=payload)
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    csd_name = next(name for name in files if name.endswith(".csd"))
    return files[csd_name].decode(), files


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_csd_exports_only_device_assignments_and_routed_continuous_instances(tmp_path, mode):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    payload["midiControllers"] = [{"controllerNumber": 10, "value": 91, "enabled": True}]
    exported = payload["performanceExport"]
    config = exported["performance"]["config"]
    config["instruments"][0]["id"] = "source"
    exported["patch_definitions"][0]["graph"] = _audio_source_patch_payload()["graph"]
    config["sequencer"] = {
        "tracks": [{"midiChannel": 6, "enabled": False}],
        "drummerTracks": [{"midiChannel": 5, "pads": [], "enabled": False}],
        "pianoRolls": [{"midiChannel": 3, "enabled": False}],
        "arpeggiators": [{"inputChannel": 9, "targetChannel": 4, "enabled": False}],
        "controllerSequencers": [{"midiChannel": 2, "enabled": True}],
    }
    for name, channel in [("keyboard", 3), ("arpeggiator", 4), ("drummer", 5), ("stopped-sequencer", 6)]:
        add_instrument(payload, name, channel)
    add_instrument(payload, "unused", 2)
    add_instrument(payload, "arp-input-only", 9)
    # The same patch in an unused rack slot must not produce another instrument.
    config["instruments"].append({"id": "unused-duplicate", "patchId": "patch-1", "midiChannel": 8})
    add_instrument(payload, "insert", always_on=True, patch=_always_on_effect_with_outlets_patch_payload())
    add_instrument(payload, "master", always_on=True, patch=_always_on_effect_patch_payload())
    add_instrument(payload, "return", always_on=True, patch=_always_on_effect_patch_payload())
    add_instrument(payload, "continuous", always_on=True, patch=_audio_outlet_only_source_patch_payload())
    add_instrument(payload, "unrouted-effect", always_on=True, patch=_always_on_effect_patch_payload())
    add_instrument(payload, "unrouted-generator", always_on=True, patch=_audio_outlet_only_source_patch_payload())
    config.update(
        version=12,
        audioGraph={
            "masterId": "master",
            "insertOwners": {"insert": "source"},
            "routes": [
                route("insert-in", "source", "insert", kind="insert", source_stage="raw"),
                route("insert-out", "insert", "source", kind="insert", source_stage="raw", target_stage="strip"),
                route("to-master", "source", "master"),
                route("send", "source", "return", kind="send"),
                route("continuous-main", "continuous", "master"),
                route("unused-route", "unused", "master", kind="send"),
            ],
        },
        mixer={
            "strips": {"source": {"gainDb": -3}, "unused": {"mute": True, "solo": True}},
            "sends": {"send": {"gainDb": -6, "tap": "pre"}, "unused-route": {"gainDb": -1}},
        },
    )
    original = deepcopy(payload)
    with _client(tmp_path) as client:
        csd, files = read_export(client, payload)
        for identity in [
            "source",
            "keyboard",
            "arpeggiator",
            "drummer",
            "stopped-sequencer",
            "insert",
            "master",
            "return",
            "continuous",
        ]:
            assert f"; instance:{identity} csound:" in csd
        for identity in ["unused", "unused-duplicate", "arp-input-only", "unrouted-effect", "unrouted-generator"]:
            assert f"; instance:{identity} csound:" not in csd
            assert "vcs_mix_" + token("patch:" + identity) not in csd
        assert "unused-route" not in csd
        if mode == "midiFile":
            midi = mido.MidiFile(file=BytesIO(files["Offline_Export/Offline_Export.mid"]))
            seeded_channels = {
                message.channel + 1
                for track in midi.tracks
                for message in track
                if message.type == "control_change" and message.control == 10
            }
            assert seeded_channels == {1, 3, 4, 5, 6}
        else:
            assert "i 9000 0 0.000021 138 91" not in csd  # Omitted MIDI channel 2.
        assert "; role: Master processor" in csd
        assert "; insert for: Offline Instrument [source]" in csd
        assert "; audio route:send kind:send" in csd
        assert "Offline Instrument [source] port:left stage:strip -> return [return] port:left stage:input" in csd
        assert "; tap: pre-fader; initial route gain: -6 dB" in csd
        assert "; Direct Audio Output: this path bypasses Master processing and gain." in csd
        assert "; initial gain: -3 dB; balance/pan: 0; mute: false; solo: false" in csd
        for identity in ["insert", "master", "return", "continuous"]:
            assert f'alwayson "vcs_mix_{token("patch:" + identity)}"' in csd
        native = client.post("/api/bundles/export/performance", json=exported)
        assert native.status_code == 200
        assert native.json()["performance"]["config"]["instruments"] == config["instruments"]
    assert payload == original


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_csd_prunes_unused_assets_before_resolving_or_compiling_them(tmp_path, mode):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    unused = _performance_csd_export_payload(
        sfload_node_config={
            "sampleAsset": {
                "asset_id": "absent",
                "original_name": "unused.sf2",
                "stored_name": "unused.sf2",
                "content_type": "audio/sf2",
                "size_bytes": 42,
            }
        }
    )["performanceExport"]["patch_definitions"][0]
    unused.update(sourcePatchId="unused", name="Unused sample instrument")
    payload["performanceExport"]["patch_definitions"].append(unused)
    payload["performanceExport"]["performance"]["config"]["instruments"].append(
        {"id": "unused", "patchId": "unused", "midiChannel": 2}
    )
    with _client(tmp_path) as client:
        csd, files = read_export(client, payload)
        assert "Unused sample instrument" not in csd
        assert not any("/assets/" in name for name in files)
        assert "sfload" not in csd


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_csd_keeps_runtime_arpeggiator_output_assignment(tmp_path, mode):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    payload["sequencerConfig"]["tracks"][0]["midi_channel"] = 6
    payload["sequencerConfig"]["arpeggiators"] = [
        {"arpeggiator_id": "arp", "enabled": True, "input_channel": 6, "target_channel": 5},
    ]
    payload["performanceExport"]["performance"]["config"]["instruments"][0]["midiChannel"] = 5
    add_instrument(payload, "unassigned", 2)
    with _client(tmp_path) as client:
        csd, files = read_export(client, payload)
        assert "; patch:patch-1 name:Offline Instrument channel:5" in csd
        assert "; instance:unassigned " not in csd
        if mode == "midiFile":
            midi = mido.MidiFile(file=BytesIO(files["Offline_Export/Offline_Export.mid"]))
            assert any(message.type == "note_on" and message.channel == 4 for track in midi.tracks for message in track)
        else:
            assert re.search(r"^i 1 ", csd, re.MULTILINE)


@pytest.mark.parametrize("mode", ["midiFile", "score"])
@pytest.mark.parametrize("mixer", [False, True])
def test_csd_descriptions_are_readable_safe_comments_and_compile(tmp_path, mode, mixer):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    payload["performanceExport"]["performance"]["name"] = "Dreams & Drones <Live>"
    payload["performanceExport"]["exported_at"] = "2026-09-12T17:55:00+02:00 -- Zürich"
    config = payload["performanceExport"]["performance"]["config"]
    if mixer:
        config.update(version=12, audioGraph={"routes": []})
        config["instruments"][0]["id"] = "source"
    description = "Warm pad — flûte\r\nSecond line\ninstr 777\n</CsInstruments>\n<CsScore>\nTab\there\nTrailing\\"
    payload["performanceExport"]["patch_definitions"][0]["description"] = description
    with _client(tmp_path) as client:
        csd, files = read_export(client, payload)
    assert csd.startswith(
        "<!--\n"
        "This CSD was created with Orchestron.\n"
        "Performance: Dreams &amp; Drones &lt;Live&gt;\n"
        "Created: 2026-09-12T17:55:00+02:00 - - Zürich\n"
    )
    assert "Design instruments visually and hear ideas take shape." in csd
    assert "Build expressive performances with sequencers, arpeggiators, live controls, and flexible audio routing." in csd
    assert "Export portable Csound projects for rendering, sharing, and further sound design." in csd
    assert "GitHub: https://github.com/thomassresearch/orchestron" in csd
    assert "; description: Warm pad — flûte\n;   Second line\n;   instr 777\n" in csd
    assert "\ninstr 777\n" not in csd
    assert csd.count("</CsInstruments>") == 1
    assert csd.count("<CsScore>") == 1
    assert r";   \x3c/CsInstruments\x3e" in csd
    orc = csd.split("<CsInstruments>\n", 1)[1].split("</CsInstruments>", 1)[0]
    score = csd.split("<CsScore>\n", 1)[1].split("</CsScore>", 1)[0]
    midi_file = None
    if mode == "midiFile":
        midi_file = tmp_path / "performance.mid"
        midi_file.write_bytes(next(content for name, content in files.items() if name.endswith(".mid")))
    with sound(orc, score, midi_file=midi_file) as cs:
        assert cs.performKsmps() == 0


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_legacy_csd_filters_routes_and_comments_routed_effects(tmp_path, mode):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    config = payload["performanceExport"]["performance"]["config"]
    config["instruments"][0]["id"] = "source"
    payload["performanceExport"]["patch_definitions"][0]["graph"] = _audio_source_patch_payload()["graph"]
    add_instrument(payload, "unused", 2)
    add_instrument(payload, "effect", always_on=True, patch=_always_on_effect_patch_payload())
    config["instruments"][-1]["effectSourceIds"] = ["source", "unused"]
    request = PerformanceCsdExportRequest.model_validate(payload)
    before = request.model_dump()
    selected = select_performance_csd_instruments(request)
    assert selected.performance.config.instruments[-1].effect_source_ids == ["source"]
    assert request.model_dump() == before
    with _client(tmp_path) as client:
        csd, _ = read_export(client, payload)
        assert "; audio route: Offline Instrument [source] output left -> effect [effect] input left" in csd
        assert 'alwayson "vcs_instr_2"' in csd
        assert "; instance:unused " not in csd


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_csd_continuous_only_does_not_keep_the_browser_transport_placeholder(tmp_path, mode):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    payload["sequencerConfig"]["tracks"][0].update(track_id="__transport__", enabled=False)
    payload["sequencerConfig"]["controller_tracks"] = []
    add_instrument(payload, "continuous", always_on=True)
    with _client(tmp_path) as client:
        csd, _ = read_export(client, payload)
        assert "; instance:continuous " in csd
        assert "; patch:patch-1 " not in csd


@pytest.mark.parametrize("mode", ["midiFile", "score"])
def test_csd_selection_still_rejects_broken_routing_for_exported_instruments(tmp_path, mode):
    payload = _performance_csd_export_payload()
    payload["eventSource"] = mode
    config = payload["performanceExport"]["performance"]["config"]
    config["instruments"][0]["id"] = "source"
    payload["performanceExport"]["patch_definitions"][0]["graph"] = _audio_source_patch_payload()["graph"]
    config.update(version=12, audioGraph={"routes": [route("broken", "source", "missing")]})
    with _client(tmp_path) as client:
        response = client.post("/api/bundles/export/performance-csd", json=payload)
        assert response.status_code == 422
        assert "broken" in response.text
