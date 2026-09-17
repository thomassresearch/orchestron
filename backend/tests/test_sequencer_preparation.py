from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading

import pytest

from backend.tests.api_test_support import _client, _create_running_session, _sequencer_config


def configuration(tempo: int = 120) -> dict:
    return _sequencer_config([{
        "track_id": "lead", "midi_channel": 1, "enabled": True, "length_beats": 4,
        "pads": [{"pad_index": index, "length_beats": 4,
                  "steps": [{"note": 60 + index, "hold": True}]} for index in range(2)],
    }], tempo_bpm=tempo, playback_end_step=10000)


@pytest.mark.parametrize("command", ["queue", "seek", "stop", "delete", "failure", "newer"])
def test_preparation_does_not_block_rendering_or_lose_concurrent_commands(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, command: str,
) -> None:
    with _client(tmp_path) as client, ThreadPoolExecutor(max_workers=3) as requests:
        session_id = _create_running_session(client)
        base = f"/api/sessions/{session_id}"
        assert client.post(f"{base}/sequencer/start", json={"config": configuration()}).status_code == 200
        service = client.app.state.container.session_service
        runtime = service._sessions[session_id]
        sequencer = runtime.sequencer
        original = service._preparation.prepare
        entered, release = threading.Event(), threading.Event()
        calls = []

        async def paused(request, channels):
            calls.append(request.timing.tempo_bpm)
            if len(calls) == 1:
                entered.set()
                assert await asyncio.to_thread(release.wait, 5), "test barrier timed out"
                if command == "failure":
                    raise RuntimeError("compiler process failed")
            return await original(request, channels)

        monkeypatch.setattr(service._preparation, "prepare", paused)
        edit = requests.submit(client.put, f"{base}/sequencer/config", json=configuration(137))
        assert entered.wait(5)
        try:
            # Complete audio chunks while preparation is held. No wall-clock timing assertion.
            for _ in range(5):
                rendered = runtime.worker.render_blocks(block_count=74, target_sample_rate=48000,
                    before_block=lambda _: sequencer.advance_render_block(sample_rate=48000, ksmps=64))
                assert rendered.block_count == 74
            position = sequencer.status().transport_subunit
            remainder = sequencer._render_subunit_remainder
            assert position > 0
            assert sequencer.status().timing.tempo_bpm == 120
            assert not edit.done()
            if command == "queue":
                assert client.post(f"{base}/sequencer/tracks/lead/queue-pad", json={"pad_index": 1}).status_code == 200
            elif command == "seek":
                assert client.post(f"{base}/sequencer/forward").status_code == 200
                position = sequencer.status().transport_subunit
                remainder = sequencer._render_subunit_remainder
            elif command == "stop":
                assert client.post(f"{base}/sequencer/stop").status_code == 200
            elif command == "delete":
                assert client.delete(base).status_code == 204
            elif command == "newer":
                newest = requests.submit(client.put, f"{base}/sequencer/config", json=configuration(151))
                assert edit.result(timeout=5).status_code == 409
        finally:
            release.set()
        response = edit.result(timeout=5)
        if command in {"stop", "delete", "newer"}:
            assert response.status_code == 409
        elif command == "failure":
            assert response.status_code == 500
            assert sequencer.status().timing.tempo_bpm == 120
            assert sequencer.status().running
        else:
            assert response.status_code == 200, response.text
            assert sequencer.status().timing.tempo_bpm == 137
            assert sequencer.status().transport_subunit == position
            assert sequencer._render_subunit_remainder == remainder
            if command == "queue":
                assert sequencer.status().tracks[0].queued_pad == 1
        if command == "newer":
            assert newest.result(timeout=5).status_code == 200
            assert sequencer.status().timing.tempo_bpm == 151
        elif command in {"stop", "delete"}:
            # Wait for the stale compiler result; it must never restart transport.
            client.portal.call(lambda: service._preparation._dispatcher)
            assert not sequencer.status().running


def test_preparation_pending_queue_keeps_only_latest_per_session() -> None:
    from backend.app.models.session import SessionSequencerConfigRequest
    from backend.app.services.sequencer_preparation import SequencerPreparationService, SupersededConfigurationError
    from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config

    async def exercise():
        compiler = SequencerPreparationService()
        entered, release = asyncio.Event(), asyncio.Event()
        calls, applied = [], []

        async def prepare(request, channels):
            calls.append(request.timing.tempo_bpm)
            entered.set()
            await release.wait()
            return compile_sequencer_runtime_config(request, controller_default_channels=channels)

        async def apply(config):
            applied.append(config.timing.tempo_bpm)
            return config.timing.tempo_bpm

        compiler.prepare = prepare
        jobs = []
        for tempo in (120, 130, 140, 150):
            jobs.append(asyncio.create_task(compiler.submit("session", SessionSequencerConfigRequest.model_validate(configuration(tempo)), (1,), apply)))
            await asyncio.sleep(0)
            if tempo == 120:
                await entered.wait()
        release.set()
        outcomes = await asyncio.gather(*jobs, return_exceptions=True)
        assert all(isinstance(outcome, SupersededConfigurationError) for outcome in outcomes[:-1])
        assert outcomes[-1] == 150
        assert calls == [120, 150]
        assert applied == [150]
        await compiler.close()

    asyncio.run(exercise())


def test_application_runs_before_next_block_and_also_completes_when_idle(monkeypatch) -> None:
    from backend.app.engine.csound_worker import CsoundWorker

    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "browser_clock")
    worker = CsoundWorker()
    worker.start(csd="<CsoundSynthesizer>\n<CsInstruments>\nsr=48000\nksmps=16\nnchnls=2\n</CsInstruments>\n</CsoundSynthesizer>",
                 midi_input="unused", rtmidi_module="null")
    entered, release, staged = threading.Event(), threading.Event(), threading.Event()
    applied, observations = [], []

    class SignallingQueue(list):
        def append(self, item):
            super().append(item)
            staged.set()

    worker._boundary_actions = SignallingQueue()

    def before_block(index):
        observations.append((index, len(applied)))
        if index == 0:
            # The first block consumed the empty queue; instrument the new one.
            worker._boundary_actions = SignallingQueue()
            entered.set()
            assert release.wait(5)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            render = pool.submit(worker.render_blocks, block_count=3, target_sample_rate=48000, before_block=before_block)
            assert entered.wait(5)
            edit = pool.submit(worker.run_at_render_boundary, lambda: applied.append("edit"))
            try:
                assert staged.wait(5)
            finally:
                release.set()
            render.result(timeout=5)
            edit.result(timeout=5)
        assert observations == [(0, 0), (1, 1), (2, 1)]
        worker.run_at_render_boundary(lambda: applied.append("idle"))
        assert applied == ["edit", "idle"]
    finally:
        release.set()
        worker.stop()


def test_autosave_does_not_block_the_audio_api_event_loop(tmp_path, monkeypatch) -> None:
    with _client(tmp_path) as client, ThreadPoolExecutor(max_workers=2) as requests:
        session_id = _create_running_session(client)
        service = client.app.state.container.app_state_service
        original = service.save_last_state
        entered, release = threading.Event(), threading.Event()

        def paused(request):
            entered.set()
            assert release.wait(5)
            return original(request)

        monkeypatch.setattr(service, "save_last_state", paused)
        saving = requests.submit(client.put, "/api/app-state", json={"state": {"version": 1}})
        assert entered.wait(5)
        try:
            status = requests.submit(client.get, f"/api/sessions/{session_id}/sequencer/status")
            assert status.result(timeout=2).status_code == 200
            assert not saving.done()
        finally:
            release.set()
        assert saving.result(timeout=5).status_code == 200


def test_failed_preparation_keeps_active_audition_and_authored_sequence(tmp_path, monkeypatch):
    with _client(tmp_path) as client:
        session_id = _create_running_session(client)
        base = f"/api/sessions/{session_id}/sequencer"
        authored = configuration()
        assert client.put(base + "/config", json=authored).status_code == 200
        assert client.post(base + "/audition", json={"action": "start", "track_ids": ["lead"], "sequence": [1, -2]}).status_code == 200
        service = client.app.state.container.session_service
        async def fail(*_):
            raise RuntimeError("preparation failed")
        monkeypatch.setattr(service._preparation, "prepare", fail)
        assert client.put(base + "/config", json=configuration(137)).status_code == 500
        status = client.get(base + "/status").json()
        assert status["running"] and status["auditions"]["lead"]["active"]
        assert status["tracks"][0]["active_pad"] == 1 and status["timing"]["tempo_bpm"] == 120
        sequencer = service._sessions[session_id].sequencer
        sequencer.clear_auditions()
        assert not sequencer._config.tracks["lead"].pad_loop_enabled
