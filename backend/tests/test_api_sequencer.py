from __future__ import annotations

import time
from pathlib import Path


from backend.tests.api_test_support import (
    _BrowserClockRenderDriver,
    _client,
    _create_running_session,
    _runtime_midi_router,
    _sequencer_config,
    _sequencer_timing,
)

def test_session_midi_event_endpoint(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "MIDI Event Patch",
            "description": "session midi event test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        start_response = client.post(f"/api/sessions/{session_id}/start")
        assert start_response.status_code == 200

        note_on = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "note_on", "channel": 1, "note": 60, "velocity": 100},
        )
        if note_on.status_code == 404:
            assert "midi output" in note_on.text.lower()
            return
        assert note_on.status_code == 200

        note_off = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "note_off", "channel": 1, "note": 60},
        )
        assert note_off.status_code == 200

        control_change = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "control_change", "channel": 1, "controller": 10, "value": 64},
        )
        assert control_change.status_code == 200

        all_notes_off = client.post(
            f"/api/sessions/{session_id}/midi-event",
            json={"type": "all_notes_off", "channel": 1},
        )
        assert all_notes_off.status_code == 200


def test_session_backend_sequencer_flow_with_pad_queue(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Runtime Patch",
            "description": "backend sequencer runtime test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "velocity": 100,
                                "gate_ratio": 0.8,
                                "active_pad": 0,
                                "pads": [
                                    {"pad_index": 0, "steps": [60, None, 67, None] + [None] * 12},
                                    {"pad_index": 1, "steps": [72, None, 74, None] + [None] * 12},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True
            assert start_sequencer.json()["tracks"][0]["active_pad"] == 0

            queue_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/voice-1/queue-pad",
                json={"pad_index": 1},
            )
            assert queue_pad.status_code == 200
            assert queue_pad.json()["tracks"][0]["queued_pad"] == 1

            switched = False
            for _ in range(25):
                driver.pump_for(0.1)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                if data["tracks"][0]["active_pad"] == 1 and data["tracks"][0]["queued_pad"] is None:
                    switched = True
                    break

            assert switched, "Queued pad did not switch on loop boundary in expected time."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_active_pad_uses_pad_specific_step_count(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Per-Pad Step Count Patch",
            "description": "backend sequencer per-pad step count test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "active_pad": 1,
                                "pads": [
                                    {"pad_index": 0, "length_beats": 4, "steps": [60, None] + [None] * 14},
                                    {"pad_index": 1, "length_beats": 2, "steps": [72, None] + [None] * 6},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            started = start_sequencer.json()
            assert started["running"] is True
            assert started["tracks"][0]["active_pad"] == 1
            assert started["tracks"][0]["step_count"] == 8

            queue_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/voice-1/queue-pad",
                json={"pad_index": 0},
            )
            assert queue_pad.status_code == 200
            assert queue_pad.json()["tracks"][0]["queued_pad"] == 0

            switched = False
            for _ in range(20):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                body = status.json()
                if body["tracks"][0]["active_pad"] == 0 and body["tracks"][0]["step_count"] == 16:
                    switched = True
                    break

            assert switched, "Expected queued pad switch to update active pad step_count in runtime status."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_pad_looper_sequence_stops_when_repeat_disabled(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Pad Looper Patch",
            "description": "pad looper sequence runtime test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "enabled": True,
                                "active_pad": 7,
                                "pad_loop_enabled": True,
                                "pad_loop_repeat": False,
                                "pad_loop_sequence": [0, 1],
                                "pads": [
                                    {"pad_index": 0, "steps": [60, None] + [None] * 14},
                                    {"pad_index": 1, "steps": [72, None] + [None] * 14},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True
            track = next(item for item in start_sequencer.json()["tracks"] if item["track_id"] == "voice-1")
            assert track["active_pad"] == 0

            saw_second_pad = False
            stopped_after_sequence = False
            for _ in range(50):
                driver.pump_for(0.1)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")

                if track["enabled"] and track["active_pad"] == 1:
                    saw_second_pad = True

                if saw_second_pad and track["enabled"] is False and track["queued_enabled"] is None:
                    stopped_after_sequence = True
                    break

            assert saw_second_pad, "Pad looper did not advance to the second pad in the configured sequence."
            assert stopped_after_sequence, "Pad looper did not stop the track when repeat was disabled."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_disabled_pad_looper_track_preserves_selected_pad_while_transport_runs(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Disabled Pad Selection Patch",
            "description": "stopped pad-looper track selection test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "enabled": True,
                            "active_pad": 0,
                            "pads": [
                                {"pad_index": 0, "steps": [60, None] + [None] * 14},
                            ],
                        },
                        {
                            "track_id": "voice-2",
                            "midi_channel": 2,
                            "enabled": False,
                            "active_pad": 1,
                            "pad_loop_enabled": True,
                            "pad_loop_repeat": True,
                            "pad_loop_sequence": [0, 1],
                            "pads": [
                                {"pad_index": 0, "steps": [36, None] + [None] * 14},
                                {"pad_index": 1, "steps": [48, None] + [None] * 14},
                            ],
                        },
                    ],
                    tempo_bpm=300,
                )
            },
        )
        assert start_sequencer.status_code == 200
        started_tracks = {track["track_id"]: track for track in start_sequencer.json()["tracks"]}
        assert started_tracks["voice-2"]["enabled"] is False
        assert started_tracks["voice-2"]["active_pad"] == 1
        assert started_tracks["voice-2"]["pad_loop_position"] is None

        status = client.get(f"/api/sessions/{session_id}/sequencer/status")
        assert status.status_code == 200
        tracks = {track["track_id"]: track for track in status.json()["tracks"]}
        assert tracks["voice-2"]["enabled"] is False
        assert tracks["voice-2"]["active_pad"] == 1
        assert tracks["voice-2"]["pad_loop_position"] is None

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200


def test_session_backend_sequencer_pad_looper_repeats_across_multiple_pause_tokens(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Multi Pause Loop Patch",
            "description": "pad looper multi-pause repeat test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "enabled": True,
                                "active_pad": 0,
                                "pad_loop_enabled": True,
                                "pad_loop_repeat": True,
                                "pad_loop_sequence": [0, -4, -8],
                                "pads": [
                                    {"pad_index": 0, "steps": [60, None] + [None] * 14},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                        playback_end_step=256,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True

            saw_first_pause = False
            saw_second_pause = False
            wrapped_to_start = False

            for _ in range(80):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")

                if track["pad_loop_position"] == 1:
                    saw_first_pause = True
                if track["pad_loop_position"] == 2:
                    saw_second_pause = True
                if saw_second_pause and track["pad_loop_position"] == 0 and data["running"] is True:
                    wrapped_to_start = True
                    break

            assert saw_first_pause, "Pad looper never entered the first pause token."
            assert saw_second_pause, "Pad looper never entered the second pause token."
            assert wrapped_to_start, "Pad looper did not wrap back to the first token after the second pause."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_stop_preserves_playhead_and_position_start(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Transport Resume Patch",
            "description": "transport resume test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "pads": [{"pad_index": 0, "steps": [60, None, 67, None] + [None] * 12}],
                            }
                        ],
                        tempo_bpm=300,
                        playback_end_step=32,
                    )
                },
            )
            assert start_response.status_code == 200

            preserved_absolute_step: int | None = None
            for _ in range(20):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                body = status.json()
                absolute_step = body["cycle"] * body["step_count"] + body["current_step"]
                if absolute_step >= 4:
                    preserved_absolute_step = absolute_step
                    break

            assert preserved_absolute_step is not None

            stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_response.status_code == 200
            stopped_absolute_step = stop_response.json()["cycle"] * stop_response.json()["step_count"] + stop_response.json()["current_step"]
            assert stopped_absolute_step == preserved_absolute_step

            resume_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={"position_step": preserved_absolute_step},
            )
            assert resume_response.status_code == 200
            resumed_absolute_step = resume_response.json()["cycle"] * resume_response.json()["step_count"] + resume_response.json()["current_step"]
            assert resumed_absolute_step == preserved_absolute_step

            client.post(f"/api/sessions/{session_id}/sequencer/stop")


def test_session_backend_sequencer_transport_seek_moves_in_four_step_blocks(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Transport Seek Patch",
            "description": "transport seek test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "pads": [{"pad_index": 0, "steps": [60] + [None] * 15}],
                        }
                    ],
                    tempo_bpm=120,
                    playback_end_step=32,
                )
            },
        )
        assert start_response.status_code == 200

        stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_response.status_code == 200

        forward_response = client.post(f"/api/sessions/{session_id}/sequencer/forward")
        assert forward_response.status_code == 200
        forward_absolute_step = forward_response.json()["cycle"] * forward_response.json()["step_count"] + forward_response.json()["current_step"]
        assert forward_absolute_step == 8

        rewind_response = client.post(f"/api/sessions/{session_id}/sequencer/rewind")
        assert rewind_response.status_code == 200
        rewind_absolute_step = rewind_response.json()["cycle"] * rewind_response.json()["step_count"] + rewind_response.json()["current_step"]
        assert rewind_absolute_step == 0


def test_session_backend_sequencer_three_four_timing_updates_transport_status(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Three Four Patch",
            "description": "3/4 timing status test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "pads": [{"pad_index": 0, "steps": [60] + [None] * 11}],
                        }
                    ],
                    tempo_bpm=180,
                    meter_numerator=3,
                    meter_denominator=4,
                    steps_per_beat=4,
                )
            },
        )
        assert start_response.status_code == 200
        started = start_response.json()
        assert started["timing"] == _sequencer_timing(
            tempo_bpm=180,
            meter_numerator=4,
            meter_denominator=4,
            steps_per_beat=8,
        )
        assert started["step_count"] == 8
        assert started["tracks"][0]["timing"] == _sequencer_timing(
            tempo_bpm=180,
            meter_numerator=3,
            meter_denominator=4,
            steps_per_beat=4,
        )

        client.post(f"/api/sessions/{session_id}/sequencer/stop")
        forward_response = client.post(f"/api/sessions/{session_id}/sequencer/forward")
        assert forward_response.status_code == 200
        forward_absolute_step = forward_response.json()["cycle"] * forward_response.json()["step_count"] + forward_response.json()["current_step"]
        assert forward_absolute_step == 8


def test_session_backend_sequencer_polyrhythm_beat_rate_advances_local_step_between_transport_steps(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Polyrhythm Patch",
            "description": "beat-rate ratio timing test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "timing": _sequencer_timing(
                                    tempo_bpm=120,
                                    meter_numerator=4,
                                    meter_denominator=4,
                                    steps_per_beat=4,
                                    beat_rate_numerator=3,
                                    beat_rate_denominator=2,
                                ),
                                "length_beats": 1,
                                "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]}],
                            }
                        ],
                        tempo_bpm=120,
                    )
                },
            )
            assert start_response.status_code == 200
            started = start_response.json()
            assert started["transport_subunit"] == 0
            assert started["tracks"][0]["timing"] == _sequencer_timing(
                tempo_bpm=120,
                meter_numerator=4,
                meter_denominator=4,
                steps_per_beat=4,
                beat_rate_numerator=3,
                beat_rate_denominator=2,
            )

            target_status: dict[str, object] | None = None
            deadline = time.time() + 0.75
            while time.time() < deadline:
                driver.pump_for(0.005)
                status_response = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status_response.status_code == 200
                status = status_response.json()
                transport_subunit = int(status["transport_subunit"])
                if 560 <= transport_subunit < 840:
                    target_status = status
                    break

            assert target_status is not None, "Expected to observe the 3:2 local-step window before transport step 2."
            assert target_status["current_step"] == 1
            assert target_status["tracks"][0]["local_step"] == 1
            assert target_status["transport_subunit"] < 840

            stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_response.status_code == 200


def test_session_backend_sequencer_accepts_meter_aligned_three_beat_pad_lengths(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Odd Beat Length Patch",
            "description": "3/4 odd beat length test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "length_beats": 3,
                            "pads": [{"pad_index": 0, "length_beats": 3, "steps": [60, None] + [None] * 10}],
                        }
                    ],
                    tempo_bpm=210,
                    meter_numerator=3,
                    meter_denominator=4,
                    steps_per_beat=4,
                )
            },
        )
        assert start_response.status_code == 200
        started = start_response.json()
        assert started["tracks"][0]["timing"] == _sequencer_timing(
            tempo_bpm=210,
            meter_numerator=3,
            meter_denominator=4,
            steps_per_beat=4,
        )
        assert started["tracks"][0]["length_beats"] == 3
        assert started["tracks"][0]["step_count"] == 12

        stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_response.status_code == 200


def test_session_backend_sequencer_six_eight_timing_uses_steps_per_bar(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Six Eight Patch",
            "description": "6/8 timing status test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]

        start_response = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "pads": [{"pad_index": 0, "length_beats": 8, "steps": [60] + [None] * 31}],
                        }
                    ],
                    tempo_bpm=210,
                    meter_numerator=6,
                    meter_denominator=8,
                    steps_per_beat=4,
                )
            },
        )
        assert start_response.status_code == 200
        started = start_response.json()
        assert started["timing"] == _sequencer_timing(
            tempo_bpm=210,
            meter_numerator=4,
            meter_denominator=4,
            steps_per_beat=8,
        )
        assert started["step_count"] == 8
        assert started["tracks"][0]["timing"] == _sequencer_timing(
            tempo_bpm=210,
            meter_numerator=6,
            meter_denominator=8,
            steps_per_beat=4,
        )
        assert started["tracks"][0]["length_beats"] == 8
        assert started["tracks"][0]["step_count"] == 32

        stop_response = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_response.status_code == 200


def test_session_backend_sequencer_selected_range_loops_and_one_shot_ends_at_range_end(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Playback Window Patch",
            "description": "playback range test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        patch_response = client.post("/api/patches", json=patch_payload)
        assert patch_response.status_code == 201
        session_response = client.post("/api/sessions", json={"patch_id": patch_response.json()["id"]})
        assert session_response.status_code == 201
        session_id = session_response.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            loop_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "pad_loop_enabled": True,
                                "pad_loop_repeat": True,
                                "pad_loop_sequence": [0, 1],
                                "pads": [
                                    {"pad_index": 0, "steps": [60] + [None] * 15},
                                    {"pad_index": 1, "steps": [67] + [None] * 15},
                                ],
                            }
                        ],
                        tempo_bpm=300,
                        playback_start_step=16,
                        playback_end_step=24,
                        playback_loop=True,
                    )
                },
            )
            assert loop_response.status_code == 200

            saw_range_wrap = False
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                absolute_step = status.json()["cycle"] * status.json()["step_count"] + status.json()["current_step"]
                if absolute_step == 16 and status.json()["running"] is True:
                    saw_range_wrap = True
                    break

            assert saw_range_wrap, "Expected looping playback window to wrap back to the selected range start."

            client.post(f"/api/sessions/{session_id}/sequencer/stop")

            one_shot_response = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "pads": [{"pad_index": 0, "steps": [60] + [None] * 15}],
                            }
                        ],
                        tempo_bpm=300,
                        playback_start_step=0,
                        playback_end_step=8,
                        playback_loop=False,
                    )
                },
            )
            assert one_shot_response.status_code == 200

            stopped_at_end = False
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                body = status.json()
                absolute_step = body["cycle"] * body["step_count"] + body["current_step"]
                if body["running"] is False and absolute_step == 8:
                    stopped_at_end = True
                    break

            assert stopped_at_end, "Expected one-shot playback to stop at the configured playback_end_step."


def test_session_backend_sequencer_hold_steps_release_only_on_non_hold_rest(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Hold Patch",
            "description": "hold step runtime test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "active_pad": 0,
                                "pads": [
                                    {
                                        "pad_index": 0,
                                        "steps": [
                                            {"note": 60, "hold": False},
                                            {"note": None, "hold": True},
                                            {"note": None, "hold": True},
                                            {"note": None, "hold": False},
                                        ]
                                        + [None] * 12,
                                    }
                                ],
                            }
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200
            assert start_sequencer.json()["running"] is True

            saw_held_note = False
            saw_release_after_hold = False
            for _ in range(40):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-1")
                active_notes = track["active_notes"]
                if 60 in active_notes:
                    saw_held_note = True
                if saw_held_note and len(active_notes) == 0:
                    saw_release_after_hold = True
                    break

            assert saw_held_note, "Expected held note to remain active during hold-rest steps."
            assert saw_release_after_hold, "Expected held note to release on first rest step with hold disabled."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_sequencer_uses_step_velocity_for_note_on(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Velocity Patch",
            "description": "step velocity runtime test",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        midi_router = _runtime_midi_router(client, session_id)
        assert midi_router is not None
        captured_messages: list[list[int]] = []
        original_enqueue_message = midi_router._enqueue_timestamped_midi

        def capture_enqueue_message(
            message: list[int],
            *,
            source: str,
            target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None,
            source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None,
            sync_stale: bool = False,
        ) -> bool:
            _ = (
                source,
                target_engine_sample,
                delivery_delay_seconds,
                source_timestamp_ns,
                mapped_backend_monotonic_ns,
                sync_stale,
            )
            captured_messages.append(list(message))
            return True

        midi_router._enqueue_timestamped_midi = capture_enqueue_message
        try:
            with _BrowserClockRenderDriver(client, session_id) as driver:
                start_sequencer = client.post(
                    f"/api/sessions/{session_id}/sequencer/start",
                    json={
                        "config": _sequencer_config(
                            [
                                {
                                    "track_id": "voice-1",
                                    "midi_channel": 1,
                                    "velocity": 100,
                                    "active_pad": 0,
                                    "pads": [
                                        {
                                            "pad_index": 0,
                                            "steps": [
                                                {"note": 60, "hold": False, "velocity": 23},
                                                None,
                                                {"note": 67, "hold": False, "velocity": 91},
                                                None,
                                            ]
                                            + [None] * 12,
                                        }
                                    ],
                                }
                            ],
                            tempo_bpm=300,
                        )
                    },
                )
                assert start_sequencer.status_code == 200
                assert start_sequencer.json()["running"] is True

                saw_first_velocity = False
                saw_second_velocity = False
                for _ in range(40):
                    note_ons = [msg for msg in captured_messages if len(msg) == 3 and (msg[0] & 0xF0) == 0x90]
                    if any(msg[1] == 60 and msg[2] == 23 for msg in note_ons):
                        saw_first_velocity = True
                    if any(msg[1] == 67 and msg[2] == 91 for msg in note_ons):
                        saw_second_velocity = True
                    if saw_first_velocity and saw_second_velocity:
                        break
                    driver.pump_for(0.05)

                assert saw_first_velocity, "Expected step 1 note-on to use velocity 23."
                assert saw_second_velocity, "Expected step 3 note-on to use velocity 91."

                stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
                assert stop_sequencer.status_code == 200
                assert stop_sequencer.json()["running"] is False
        finally:
            midi_router._enqueue_timestamped_midi = original_enqueue_message


def test_session_backend_sequencer_schedules_pad_switch_note_events_with_positive_delay(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Timing Patch",
            "description": "scheduled pad switch timing",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        midi_router = _runtime_midi_router(client, session_id)
        assert midi_router is not None
        scheduled_calls: list[tuple[list[list[int]], float | None]] = []
        original_enqueue_message = midi_router._enqueue_timestamped_midi

        def capture_enqueue_message(
            message: list[int],
            *,
            source: str,
            target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None,
            source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None,
            sync_stale: bool = False,
        ) -> bool:
            _ = (
                source,
                target_engine_sample,
                source_timestamp_ns,
                mapped_backend_monotonic_ns,
                sync_stale,
            )
            scheduled_calls.append(([list(message)], delivery_delay_seconds))
            return True

        midi_router._enqueue_timestamped_midi = capture_enqueue_message
        try:
            with _BrowserClockRenderDriver(client, session_id) as driver:
                start_sequencer = client.post(
                    f"/api/sessions/{session_id}/sequencer/start",
                    json={
                        "config": _sequencer_config(
                                [
                                    {
                                        "track_id": "voice-1",
                                        "midi_channel": 1,
                                        "length_beats": 1,
                                        "active_pad": 0,
                                        "pads": [
                                            {"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]},
                                            {"pad_index": 1, "length_beats": 1, "steps": [67, None, None, None]},
                                        ],
                                    }
                                ],
                                tempo_bpm=300,
                                playback_end_step=16,
                            )
                        },
                    )
                assert start_sequencer.status_code == 200

                queue_pad = client.post(
                    f"/api/sessions/{session_id}/sequencer/tracks/voice-1/queue-pad",
                    json={"pad_index": 1},
                )
                assert queue_pad.status_code == 200

                saw_switched_note = False
                saw_render_driven_delivery = False
                for _ in range(50):
                    for messages, delivery_delay_seconds in scheduled_calls:
                        if delivery_delay_seconds is None:
                            saw_render_driven_delivery = True
                        if any(len(message) == 3 and (message[0] & 0xF0) == 0x90 and message[1] == 67 for message in messages):
                            saw_switched_note = True
                            if delivery_delay_seconds is None:
                                saw_render_driven_delivery = True
                    if saw_switched_note and saw_render_driven_delivery:
                        break
                    driver.pump_for(0.05)

                assert saw_switched_note, "Expected queued pad switch to emit the first note from pad 1."
                assert saw_render_driven_delivery, (
                    "Expected sequencer note events to use render-driven engine scheduling instead of wall-clock delays."
                )

                stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
                assert stop_sequencer.status_code == 200
        finally:
            midi_router._enqueue_timestamped_midi = original_enqueue_message


def test_session_backend_sequencer_queued_track_enable_starts_on_loop_boundary(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Sequencer Queued Enable Patch",
            "description": "queued track enable",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [
                            {
                                "track_id": "voice-1",
                                "midi_channel": 1,
                                "enabled": True,
                                "active_pad": 0,
                                "pads": [{"pad_index": 0, "steps": [60] + [None] * 15}],
                            },
                            {
                                "track_id": "voice-2",
                                "midi_channel": 2,
                                "enabled": False,
                                "queued_enabled": True,
                                "active_pad": 0,
                                "pads": [{"pad_index": 0, "steps": [72] + [None] * 15}],
                            },
                        ],
                        tempo_bpm=300,
                    )
                },
            )
            assert start_sequencer.status_code == 200

            track2 = next(track for track in start_sequencer.json()["tracks"] if track["track_id"] == "voice-2")
            assert track2["enabled"] is False
            assert track2["queued_enabled"] is True

            enabled_after_boundary = False
            for _ in range(25):
                driver.pump_for(0.1)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                data = status.json()
                track = next(item for item in data["tracks"] if item["track_id"] == "voice-2")
                if data["cycle"] >= 1 and track["enabled"] is True and track["queued_enabled"] is None:
                    enabled_after_boundary = True
                    break

            assert enabled_after_boundary, "Queued track enable did not activate on step-1 boundary in expected time."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_controller_sequencer_runs_without_note_tracks(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Controller Sequencer Patch",
            "description": "controller-only sequencer runtime",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [],
                    tempo_bpm=240,
                    controller_tracks=[
                        {
                            "track_id": "cc-1",
                            "controller_number": 74,
                            "length_beats": 16,
                            "active_pad": 0,
                            "enabled": True,
                            "pads": [
                                {
                                    "pad_index": 0,
                                    "length_beats": 16,
                                    "keypoints": [
                                        {"position": 0.0, "value": 10},
                                        {"position": 0.5, "value": 96},
                                        {"position": 1.0, "value": 10},
                                    ],
                                }
                            ],
                        }
                    ],
                )
            },
        )
        assert start_sequencer.status_code == 200
        payload = start_sequencer.json()
        assert payload["running"] is True
        assert payload["tracks"] == []
        assert len(payload["controller_tracks"]) == 1
        controller_track = payload["controller_tracks"][0]
        assert controller_track["track_id"] == "cc-1"
        assert controller_track["step_count"] == 64
        assert controller_track["length_beats"] == 16
        assert controller_track["active_pad"] == 0
        assert controller_track["runtime_pad_start_subunit"] == 0
        assert controller_track["target_channels"] == [1]

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200
        assert stop_sequencer.json()["running"] is False


def test_session_backend_controller_sequencer_sends_control_changes_on_session_channels(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Controller Routing Patch",
            "description": "controller sequencer output routing",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post(
            "/api/sessions",
            json={
                "instruments": [
                    {"patch_id": patch_id, "midi_channel": 2},
                    {"patch_id": patch_id, "midi_channel": 5},
                ]
            },
        )
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]

        midi_router = _runtime_midi_router(client, session_id)
        assert midi_router is not None
        captured_messages: list[list[int]] = []
        original_enqueue_message = midi_router._enqueue_timestamped_midi

        def capture_enqueue_message(
            message: list[int],
            *,
            source: str,
            target_engine_sample: int | None = None,
            delivery_delay_seconds: float | None = None,
            source_timestamp_ns: int | None = None,
            mapped_backend_monotonic_ns: int | None = None,
            sync_stale: bool = False,
        ) -> bool:
            _ = (
                source,
                target_engine_sample,
                delivery_delay_seconds,
                source_timestamp_ns,
                mapped_backend_monotonic_ns,
                sync_stale,
            )
            captured_messages.append(list(message))
            return True

        midi_router._enqueue_timestamped_midi = capture_enqueue_message
        try:
            with _BrowserClockRenderDriver(client, session_id) as driver:
                start_sequencer = client.post(
                    f"/api/sessions/{session_id}/sequencer/start",
                    json={
                        "config": _sequencer_config(
                            [],
                            tempo_bpm=300,
                            controller_tracks=[
                                {
                                    "track_id": "cc-1",
                                    "controller_number": 74,
                                    "active_pad": 0,
                                    "enabled": True,
                                    "pads": [
                                        {
                                            "pad_index": 0,
                                            "keypoints": [
                                                {"position": 0.0, "value": 22},
                                                {"position": 0.5, "value": 90},
                                                {"position": 1.0, "value": 22},
                                            ],
                                        }
                                    ],
                                }
                            ],
                        )
                    },
                )
                assert start_sequencer.status_code == 200

                saw_channel_2 = False
                saw_channel_5 = False
                for _ in range(40):
                    for message in captured_messages:
                        if len(message) != 3 or (message[0] & 0xF0) != 0xB0:
                            continue
                        channel = (message[0] & 0x0F) + 1
                        if message[1] == 74 and channel == 2:
                            saw_channel_2 = True
                        if message[1] == 74 and channel == 5:
                            saw_channel_5 = True
                    if saw_channel_2 and saw_channel_5:
                        break
                    driver.pump_for(0.05)

                assert saw_channel_2, "Expected controller sequencer to emit CC74 on session MIDI channel 2."
                assert saw_channel_5, "Expected controller sequencer to emit CC74 on session MIDI channel 5."

                stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
                assert stop_sequencer.status_code == 200
        finally:
            midi_router._enqueue_timestamped_midi = original_enqueue_message


def test_session_backend_controller_sequencer_queue_pad_switches_and_clears_queue(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        patch_payload = {
            "name": "Controller Queue Patch",
            "description": "controller pad queueing",
            "schema_version": 1,
            "graph": {
                "nodes": [
                    {"id": "n1", "opcode": "const_a", "params": {"value": 0.2}, "position": {"x": 50, "y": 50}},
                    {"id": "n2", "opcode": "outs", "params": {}, "position": {"x": 240, "y": 50}},
                ],
                "connections": [
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "left"},
                    {"from_node_id": "n1", "from_port_id": "aout", "to_node_id": "n2", "to_port_id": "right"},
                ],
                "ui_layout": {},
                "engine_config": {"sr": 48000, "ksmps": 64, "nchnls": 2, "0dbfs": 1.0},
            },
        }

        create_patch = client.post("/api/patches", json=patch_payload)
        assert create_patch.status_code == 201
        patch_id = create_patch.json()["id"]

        create_session = client.post("/api/sessions", json={"patch_id": patch_id})
        assert create_session.status_code == 201
        session_id = create_session.json()["session_id"]
        with _BrowserClockRenderDriver(client, session_id) as driver:
            start_sequencer = client.post(
                f"/api/sessions/{session_id}/sequencer/start",
                json={
                    "config": _sequencer_config(
                        [],
                        tempo_bpm=300,
                        playback_end_step=96,
                        controller_tracks=[
                            {
                                "track_id": "cc-1",
                                "controller_number": 74,
                                "length_beats": 4,
                                "active_pad": 0,
                                "enabled": True,
                                "pads": [
                                    {"pad_index": 0, "length_beats": 4, "keypoints": [{"position": 0.0, "value": 10}]},
                                    {"pad_index": 1, "length_beats": 4, "keypoints": [{"position": 0.0, "value": 90}]},
                                ],
                            }
                        ],
                    )
                },
            )
            assert start_sequencer.status_code == 200

            queue_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/cc-1/queue-pad",
                json={"pad_index": 1},
            )
            assert queue_pad.status_code == 200
            queued_track = queue_pad.json()["controller_tracks"][0]
            assert queued_track["active_pad"] == 0
            assert queued_track["queued_pad"] == 1

            switched = False
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                controller_track = status.json()["controller_tracks"][0]
                if controller_track["active_pad"] == 1 and controller_track["queued_pad"] is None:
                    switched = True
                    break

            assert switched, "Expected queued controller pad to switch on the next loop boundary."

            queue_second_pad = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/cc-1/queue-pad",
                json={"pad_index": 0},
            )
            assert queue_second_pad.status_code == 200
            clear_queue = client.post(
                f"/api/sessions/{session_id}/sequencer/tracks/cc-1/queue-pad",
                json={"pad_index": None},
            )
            assert clear_queue.status_code == 200
            cleared_track = clear_queue.json()["controller_tracks"][0]
            assert cleared_track["queued_pad"] is None

            remained_on_pad_1 = True
            for _ in range(30):
                driver.pump_for(0.05)
                status = client.get(f"/api/sessions/{session_id}/sequencer/status")
                assert status.status_code == 200
                controller_track = status.json()["controller_tracks"][0]
                if controller_track["active_pad"] != 1:
                    remained_on_pad_1 = False
                    break

            assert remained_on_pad_1, "Expected cleared controller queue to leave the active pad unchanged."

            stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
            assert stop_sequencer.status_code == 200
            assert stop_sequencer.json()["running"] is False


def test_session_backend_arpeggiator_config_does_not_reconfigure_sequencer_transport(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        session_id = _create_running_session(client, patch_name="Arpeggiator Config Isolation")

        start_sequencer = client.post(
            f"/api/sessions/{session_id}/sequencer/start",
            json={
                "config": _sequencer_config(
                    [
                        {
                            "track_id": "voice-1",
                            "midi_channel": 1,
                            "scale_root": "C",
                            "scale_type": "minor",
                            "mode": "aeolian",
                            "length_beats": 1,
                            "active_pad": 0,
                            "enabled": True,
                            "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]}],
                        }
                    ],
                    playback_end_step=8,
                )
            },
        )
        assert start_sequencer.status_code == 200
        assert start_sequencer.json()["running"] is True

        arpeggiator_config = client.put(
            f"/api/sessions/{session_id}/arpeggiators/config",
            json={
                "tempo_bpm": 120,
                "arpeggiators": [
                    {
                        "arpeggiator_id": "arp-1",
                        "enabled": True,
                        "input_channel": 2,
                        "target_channel": 1,
                    }
                ],
            },
        )
        assert arpeggiator_config.status_code == 200
        assert arpeggiator_config.json()[0]["arpeggiator_id"] == "arp-1"
        assert arpeggiator_config.json()[0]["enabled"] is True

        status = client.get(f"/api/sessions/{session_id}/sequencer/status")
        assert status.status_code == 200
        payload = status.json()
        assert payload["running"] is True
        assert payload["tracks"][0]["track_id"] == "voice-1"
        assert payload["tracks"][0]["enabled"] is True

        stop_sequencer = client.post(f"/api/sessions/{session_id}/sequencer/stop")
        assert stop_sequencer.status_code == 200



