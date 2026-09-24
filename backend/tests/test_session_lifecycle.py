from __future__ import annotations

import asyncio
from functools import partial
from concurrent.futures import ThreadPoolExecutor
import threading

from fastapi import HTTPException
import pytest

from backend.app.models.session import BrowserClockClaimControllerRequest
from backend.tests.api_test_support import _client, _create_running_session


def claim():
    return BrowserClockClaimControllerRequest(
        type="claim_controller",
        audio_context_sample_rate=48000,
        queue_low_water_frames=256,
        queue_high_water_frames=512,
        max_blocks_per_request=8,
    )


async def noop(*_):
    pass


def test_reconnected_controller_cancels_stop_waiting_on_lifecycle_lock(tmp_path):
    with _client(tmp_path) as client:
        session_id = _create_running_session(client)
        service = client.app.state.container.session_service
        runtime = service._sessions[session_id]

        async def scenario():
            await runtime.lifecycle_lock.acquire()
            stopping = asyncio.create_task(
                service._auto_stop_session_if_running(session_id, "browser_clock_controller_disconnect")
            )
            await asyncio.sleep(0)
            await service.claim_browser_clock_controller(session_id, "replacement", claim(), send_json=noop, close=noop)
            runtime.lifecycle_lock.release()
            await stopping
            assert runtime.worker.is_running
            assert service._connections.has_browser_controller(session_id)

        client.portal.call(scenario)


def test_deleting_session_rejects_controller_claim_during_close(tmp_path):
    with _client(tmp_path) as client:
        session_id = _create_running_session(client)
        service = client.app.state.container.session_service

        async def scenario():
            entered, release = asyncio.Event(), asyncio.Event()

            async def delayed_send(_):
                entered.set()
                await release.wait()

            await service.claim_browser_clock_controller(session_id, "old", claim(), send_json=delayed_send, close=noop)
            deleting = asyncio.create_task(service.delete_session(session_id))
            await entered.wait()
            try:
                with pytest.raises(HTTPException) as failure:
                    await service.claim_browser_clock_controller(session_id, "new", claim(), send_json=noop, close=noop)
                assert failure.value.status_code == 409
            finally:
                release.set()
                await deleting
            assert not service._connections.has_browser_controller(session_id)
            assert session_id not in service._sessions

        client.portal.call(scenario)


@pytest.mark.parametrize("work", ["compile", "patch-list", "performance-list"])
def test_library_and_compile_work_leave_audio_event_loop_available(tmp_path, monkeypatch, work):
    with _client(tmp_path) as client, ThreadPoolExecutor(max_workers=2) as requests:
        session_id = _create_running_session(client)
        container = client.app.state.container
        if work == "compile":
            client.post(f"/api/sessions/{session_id}/stop")
            service, method = container.compiler_service, "compile_patch_bundle"
            request = partial(client.post, f"/api/sessions/{session_id}/compile")
        elif work == "patch-list":
            service, method = container.patch_service, "list_patches"
            request = partial(client.get, "/api/patches")
        else:
            service, method = container.performance_service, "list_performances"
            request = partial(client.get, "/api/performances")
        original = getattr(service, method)
        entered, release = threading.Event(), threading.Event()

        def paused(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(service, method, paused)
        pending = requests.submit(request)
        assert entered.wait(5)
        try:
            status = requests.submit(client.get, f"/api/sessions/{session_id}/sequencer/status")
            assert status.result(timeout=2).status_code == 200
            assert not pending.done()
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 200
