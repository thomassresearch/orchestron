from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
from datetime import datetime, timezone
import time
from typing import Any
from typing import Awaitable, Callable
from uuid import uuid4

from fastapi import HTTPException

from backend.app.core.config import Settings
from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.midi_scheduler import ClockDomainMapping
from backend.app.engine.session_runtime import RuntimeSession
from backend.app.models.session import (
    BrowserClockClaimControllerRequest,
    BrowserClockManualMidiRequest,
    BrowserClockQueuePadControlRequest,
    BrowserClockReleaseControllerRequest,
    BrowserClockRequestRenderRequest,
    BrowserClockSequencerCommandRequest,
    BrowserClockSequencerStartControlRequest,
    BrowserClockTimingReportRequest,
    BindMidiInputRequest,
    CompileResponse,
    HostMidiClockSyncRequest,
    HostMidiDeviceInventoryRequest,
    HostMidiDeviceRef,
    HostMidiEventsRequest,
    HostMidiRegisterRequest,
    MidiInputRef,
    SessionSequencerConfigRequest,
    SessionSequencerQueuePadRequest,
    SessionSequencerStartRequest,
    SessionSequencerStatus,
    SessionMidiEventRequest,
    SessionActionResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionEvent,
    SessionInfo,
    SessionInstrumentAssignment,
    SessionState,
)
from backend.app.services.compiler_service import CompilationError, CompilerService, PatchInstrumentTarget
from backend.app.services.event_bus import SessionEventBus
from backend.app.services.midi_service import INTERNAL_LOOPBACK_ID, INTERNAL_LOOPBACK_SELECTOR, MidiService
from backend.app.services.patch_service import PatchService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime

logger = logging.getLogger(__name__)
_BROWSER_TIMING_REPORT_INTERVAL_MS = 100

BrowserClockSendJson = Callable[[dict[str, object]], Awaitable[None]]
BrowserClockClose = Callable[[int, str], Awaitable[None]]


@dataclass(slots=True)
class BrowserClockControllerLease:
    connection_id: str
    sample_rate: int
    queue_low_water_frames: int
    queue_high_water_frames: int
    max_blocks_per_request: int
    send_json: BrowserClockSendJson
    close: BrowserClockClose
    timing_mapping: ClockDomainMapping = field(default_factory=ClockDomainMapping)
    latest_client_perf_ms: float | None = None
    latest_audio_context_time_s: float | None = None
    latest_queued_frames: int = 0
    latest_pending_render_frames: int = 0
    latest_underrun_count: int = 0
    latest_report_sample_rate: int = 0
    last_timing_report_server_ns: int | None = None
    last_note_on_client_perf_ms: float | None = None
    last_note_on_server_received_ns: int | None = None
    last_note_on_mapped_server_ns: int | None = None
    last_note_on_sync_stale: bool = True


@dataclass(slots=True)
class HostMidiBridgeLease:
    connection_id: str
    host_id: str
    host_name: str | None = None
    protocol_version: int = 1
    timing_mapping: ClockDomainMapping = field(default_factory=ClockDomainMapping)


class SessionService:
    def __init__(
        self,
        settings: Settings,
        patch_service: PatchService,
        compiler_service: CompilerService,
        midi_service: MidiService,
        event_bus: SessionEventBus,
    ) -> None:
        self._settings = settings
        self._patch_service = patch_service
        self._compiler_service = compiler_service
        self._midi_service = midi_service
        self._event_bus = event_bus
        self._sessions: dict[str, RuntimeSession] = {}
        self._frontend_connections: dict[str, set[str]] = {}
        self._frontend_heartbeat_watchdogs: dict[str, dict[str, asyncio.Task[None]]] = {}
        self._frontend_auto_stop_tasks: dict[str, asyncio.Task[None]] = {}
        self._browser_clock_controllers: dict[str, BrowserClockControllerLease] = {}
        self._browser_clock_auto_stop_tasks: dict[str, asyncio.Task[None]] = {}
        self._host_midi_bridges: dict[str, HostMidiBridgeLease] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def create_session(self, request: SessionCreateRequest) -> SessionCreateResponse:
        self._remember_running_loop()
        instruments = self._resolve_session_instruments(request)
        # Verify patches exist before creating runtime.
        for assignment in instruments:
            self._patch_service.get_patch_document(assignment.patch_id)

        midi_inputs = self._midi_service.list_inputs()
        default_midi = self._resolve_default_midi_input_id(midi_inputs)

        runtime = RuntimeSession(
            session_id=str(uuid4()),
            instruments=instruments,
            midi_input=default_midi,
            worker=CsoundWorker(
                gen_audio_assets_dir=str(self._settings.gen_audio_assets_dir),
            ),
        )
        runtime.sequencer = SessionSequencerRuntime(
            session_id=runtime.session_id,
            midi_service=runtime.worker.midi_output,
            midi_input_selector=INTERNAL_LOOPBACK_ID,
            controller_default_channels=self._controller_default_channels_for_runtime(runtime),
            clock_mode="render_driven",
            publish_event=lambda event_type, payload, session_id=runtime.session_id: self._publish_from_thread(
                session_id=session_id,
                event_type=event_type,
                payload=payload,
            ),
        )

        async with self._lock:
            self._sessions[runtime.session_id] = runtime

        await self._publish(
            runtime.session_id,
            "session_created",
            {"patch_id": runtime.patch_id, "instrument_count": len(runtime.instruments)},
        )

        return SessionCreateResponse(
            session_id=runtime.session_id,
            patch_id=runtime.patch_id,
            instruments=runtime.instruments,
            state=runtime.state,
        )

    async def list_sessions(self) -> list[SessionInfo]:
        self._remember_running_loop()
        async with self._lock:
            sessions = list(self._sessions.values())
        return [self._session_info(runtime) for runtime in sessions]

    async def get_session(self, session_id: str) -> SessionInfo:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        return self._session_info(runtime)

    async def frontend_connected(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        async with self._lock:
            if session_id not in self._sessions:
                return
            self._cancel_frontend_auto_stop_task_unlocked(session_id)
            connections = self._frontend_connections.setdefault(session_id, set())
            connections.add(connection_id)
            self._reset_frontend_heartbeat_watchdog_unlocked(session_id, connection_id)

    async def frontend_heartbeat(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        async with self._lock:
            if session_id not in self._sessions:
                return
            connections = self._frontend_connections.get(session_id)
            if not connections or connection_id not in connections:
                return
            self._reset_frontend_heartbeat_watchdog_unlocked(session_id, connection_id)

    async def frontend_disconnected(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        await self._drop_frontend_connection(session_id, connection_id, immediate_stop=False, reason="disconnect")

    async def compile_session(self, session_id: str) -> CompileResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        targets = [
            PatchInstrumentTarget(
                patch=self._patch_service.get_patch_document(assignment.patch_id),
                midi_channel=assignment.midi_channel,
            )
            for assignment in runtime.instruments
        ]

        midi_device = self._resolve_runtime_midi_backend_selector(runtime)

        try:
            artifact = self._compiler_service.compile_patch_bundle(
                targets=targets,
                midi_input=midi_device,
                rtmidi_module=self._settings.default_rtmidi_module,
            )
        except CompilationError as error:
            runtime.state = SessionState.ERROR
            await self._publish(runtime.session_id, "compile_failed", {"errors": " | ".join(error.diagnostics)})
            raise HTTPException(status_code=422, detail={"diagnostics": error.diagnostics}) from error

        runtime.compile_artifact = artifact
        runtime.state = SessionState.COMPILED

        await self._publish(runtime.session_id, "compiled", {"diagnostics": len(artifact.diagnostics)})

        return CompileResponse(
            session_id=runtime.session_id,
            state=runtime.state,
            orc=artifact.orc,
            csd=artifact.csd,
            diagnostics=artifact.diagnostics,
        )

    async def start_session(self, session_id: str) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)

        if not runtime.compile_artifact:
            await self.compile_session(session_id)

        assert runtime.compile_artifact is not None

        try:
            result = runtime.worker.start(
                runtime.compile_artifact.csd,
                midi_input=self._resolve_runtime_midi_backend_selector(runtime),
                rtmidi_module=self._settings.default_rtmidi_module,
            )
        except Exception as exc:
            runtime.state = SessionState.ERROR
            await self._publish(runtime.session_id, "start_failed", {"error": str(exc)})
            raise HTTPException(status_code=500, detail=f"Failed to start session: {exc}") from exc

        runtime.state = SessionState.RUNNING
        runtime.started_at = datetime.now(timezone.utc)

        await self._publish(
            runtime.session_id,
            "started",
            {
                "backend": result.backend,
                "detail": result.detail,
                "midi_input": runtime.midi_input or self._settings.default_midi_device,
                "audio_mode": result.audio_mode,
            },
        )
        if runtime.worker.runtime_ksmps > 32:
            await self._publish(
                runtime.session_id,
                "runtime_warning",
                {"detail": f"Runtime ksmps={runtime.worker.runtime_ksmps} may quantize live MIDI timing."},
            )

        return SessionActionResponse(
            session_id=runtime.session_id,
            state=runtime.state,
            detail=result.detail,
        )

    async def stop_session(self, session_id: str) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        await self._disconnect_browser_clock_controller(
            session_id,
            detail="Session stopped.",
            close_code=4001,
            close_reason="session_stopped",
        )
        if runtime.sequencer is not None:
            runtime.sequencer.stop()
        detail = runtime.worker.stop()
        runtime.state = SessionState.COMPILED if runtime.compile_artifact else SessionState.IDLE

        await self._publish(runtime.session_id, "stopped", {"detail": detail})

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def panic_session(self, session_id: str) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        detail = runtime.worker.panic()

        await self._publish(runtime.session_id, "panic", {"detail": detail})

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def claim_browser_clock_controller(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockClaimControllerRequest,
        *,
        send_json: BrowserClockSendJson,
        close: BrowserClockClose,
    ) -> dict[str, object]:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        self._assert_browser_clock_mode(runtime)
        if not runtime.worker.is_running:
            raise HTTPException(status_code=409, detail="Session must be running before claiming browser-clock control.")

        previous: BrowserClockControllerLease | None = None
        lease = BrowserClockControllerLease(
            connection_id=connection_id,
            sample_rate=request.audio_context_sample_rate,
            queue_low_water_frames=request.queue_low_water_frames,
            queue_high_water_frames=request.queue_high_water_frames,
            max_blocks_per_request=request.max_blocks_per_request,
            send_json=send_json,
            close=close,
        )

        async with self._lock:
            previous = self._browser_clock_controllers.get(session_id)
            self._cancel_browser_clock_auto_stop_task_unlocked(session_id)
            self._browser_clock_controllers[session_id] = lease

        if previous is not None and previous.connection_id != connection_id:
            try:
                await previous.send_json(
                    {
                        "type": "controller_revoked",
                        "reason": "A newer browser claimed controller ownership for this session.",
                    }
                )
            except Exception:
                logger.exception("Failed to notify previous browser-clock controller for session '%s'", session_id)
            try:
                await previous.close(4002, "controller_revoked")
            except Exception:
                logger.exception("Failed to close previous browser-clock controller for session '%s'", session_id)

        sequencer = self._ensure_sequencer(runtime)
        return {
            "type": "stream_config",
            "engine_sample_rate": runtime.worker.runtime_sample_rate,
            "ksmps": runtime.worker.runtime_ksmps,
            "channels": 2,
            "target_sample_rate": request.audio_context_sample_rate,
            "engine_sample_cursor": runtime.worker.render_sample_cursor,
            "queue_low_water_frames": request.queue_low_water_frames,
            "queue_high_water_frames": request.queue_high_water_frames,
            "max_blocks_per_request": request.max_blocks_per_request,
            "server_monotonic_ns": time.perf_counter_ns(),
            "timing_report_interval_ms": _BROWSER_TIMING_REPORT_INTERVAL_MS,
            "engine_ksmps_latency_frames": runtime.worker.runtime_ksmps,
            "sequencer_status": sequencer.status().model_dump(mode="json"),
        }

    async def release_browser_clock_controller(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        self._assert_browser_clock_mode(runtime)

        should_schedule_auto_stop = False
        async with self._lock:
            lease = self._browser_clock_controllers.get(session_id)
            if lease is None or lease.connection_id != connection_id:
                return
            self._browser_clock_controllers.pop(session_id, None)
            self._schedule_browser_clock_auto_stop_task_unlocked(
                session_id=session_id,
                delay_seconds=self._settings.frontend_disconnect_grace_seconds,
            )
            should_schedule_auto_stop = True

        if should_schedule_auto_stop:
            logger.info(
                "Browser-clock controller disconnected for session '%s'; scheduling auto-stop.",
                session_id,
            )

    async def browser_clock_manual_midi(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockManualMidiRequest,
        *,
        server_received_ns: int | None = None,
    ) -> None:
        self._remember_running_loop()
        runtime, lease = await self.require_browser_clock_controller(session_id, connection_id)
        event_server_received_ns = server_received_ns or time.perf_counter_ns()
        target_engine_sample, mapped_backend_monotonic_ns, sync_stale = self._target_engine_sample_for_browser_event(
            runtime=runtime,
            lease=lease,
            event_perf_ms=request.event_perf_ms,
            now_server_ns=event_server_received_ns,
        )
        if request.midi.type == "note_on":
            lease.last_note_on_client_perf_ms = request.event_perf_ms
            lease.last_note_on_server_received_ns = event_server_received_ns
            lease.last_note_on_mapped_server_ns = mapped_backend_monotonic_ns
            lease.last_note_on_sync_stale = sync_stale
        await self._queue_session_midi_event(
            runtime,
            request.midi,
            source="browser_manual",
            target_engine_sample=target_engine_sample,
            event_perf_ms=request.event_perf_ms,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
            sync_stale=sync_stale,
        )

    async def browser_clock_timing_report(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockTimingReportRequest,
        *,
        server_received_ns: int | None = None,
    ) -> None:
        self._remember_running_loop()
        _runtime, lease = await self.require_browser_clock_controller(session_id, connection_id)
        server_now_ns = server_received_ns or time.perf_counter_ns()
        lease.timing_mapping.update(
            remote_timestamp_ns=int(round(request.client_perf_ms * 1_000_000.0)),
            server_timestamp_ns=server_now_ns,
        )
        lease.latest_client_perf_ms = request.client_perf_ms
        lease.latest_audio_context_time_s = request.audio_context_time_s
        lease.latest_queued_frames = request.queued_frames
        lease.latest_pending_render_frames = request.pending_render_frames
        lease.latest_underrun_count = request.underrun_count
        lease.latest_report_sample_rate = request.sample_rate
        lease.last_timing_report_server_ns = server_now_ns

    async def browser_clock_release_controller(
        self,
        session_id: str,
        connection_id: str,
        _request: BrowserClockReleaseControllerRequest,
    ) -> None:
        self._remember_running_loop()
        await self.release_browser_clock_controller(session_id, connection_id)

    async def browser_clock_start_sequencer(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockSequencerStartControlRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        await self.require_browser_clock_controller(session_id, connection_id)
        status = await self.start_session_sequencer(
            session_id,
            SessionSequencerStartRequest(
                config=request.config,
                position_step=request.position_step,
            ),
        )
        return self._browser_clock_sequencer_status_message(
            request_id=request.request_id,
            action=request.type,
            status=status,
        )

    async def browser_clock_command_sequencer(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockSequencerCommandRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        await self.require_browser_clock_controller(session_id, connection_id)
        if request.type == "sequencer_stop":
            status = await self.stop_session_sequencer(session_id)
        elif request.type == "sequencer_rewind":
            status = await self.rewind_session_sequencer_cycle(session_id)
        else:
            status = await self.forward_session_sequencer_cycle(session_id)
        return self._browser_clock_sequencer_status_message(
            request_id=request.request_id,
            action=request.type,
            status=status,
        )

    async def browser_clock_queue_pad(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockQueuePadControlRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        await self.require_browser_clock_controller(session_id, connection_id)
        status = await self.queue_session_sequencer_pad(
            session_id,
            request.track_id,
            SessionSequencerQueuePadRequest(pad_index=request.pad_index),
        )
        return self._browser_clock_sequencer_status_message(
            request_id=request.request_id,
            action=request.type,
            status=status,
        )

    async def require_browser_clock_controller(
        self,
        session_id: str,
        connection_id: str,
    ) -> tuple[RuntimeSession, BrowserClockControllerLease]:
        runtime = await self._get_session(session_id)
        self._assert_browser_clock_mode(runtime)

        async with self._lock:
            lease = self._browser_clock_controllers.get(session_id)
        if lease is None or lease.connection_id != connection_id:
            raise HTTPException(status_code=409, detail="This browser is not the active controller for the session.")
        return runtime, lease

    async def render_browser_clock_audio(
        self,
        session_id: str,
        connection_id: str,
        request: BrowserClockRequestRenderRequest,
        *,
        server_received_ns: int | None = None,
    ) -> tuple[dict[str, object], bytes]:
        self._remember_running_loop()
        runtime, lease = await self.require_browser_clock_controller(session_id, connection_id)
        if not runtime.worker.browser_clock_ready and runtime.worker.backend != "mock":
            raise HTTPException(status_code=409, detail="Browser-clock audio is not ready for this session.")

        request_received_ns = server_received_ns or time.perf_counter_ns()
        block_count = max(1, min(request.block_count, lease.max_blocks_per_request))
        sequencer = self._ensure_sequencer(runtime)
        latest_status = sequencer.status()

        def _before_block(_block_index: int) -> None:
            nonlocal latest_status
            latest_status = sequencer.advance_render_block(
                sample_rate=runtime.worker.runtime_sample_rate,
                ksmps=runtime.worker.runtime_ksmps,
            )

        render_started_ns = time.perf_counter_ns()
        try:
            render = runtime.worker.render_blocks(
                block_count=block_count,
                target_sample_rate=lease.sample_rate,
                before_block=_before_block,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to render browser-clock audio: {exc}") from exc
        render_completed_ns = time.perf_counter_ns()

        return (
            {
                "type": "render_chunk",
                "chunk_id": str(uuid4()),
                "engine_block_count": render.block_count,
                "engine_sample_start": render.engine_sample_start,
                "engine_sample_end": render.engine_sample_end,
                "engine_sample_rate": render.engine_sample_rate,
                "target_sample_rate": render.target_sample_rate,
                "target_frame_count": render.target_frame_count,
                "channels": render.channels,
                "sequencer_status": latest_status.model_dump(mode="json"),
                "telemetry": self._browser_clock_render_telemetry(
                    lease=lease,
                    request=request,
                    server_received_ns=request_received_ns,
                    server_render_start_ns=render_started_ns,
                    server_render_end_ns=render_completed_ns,
                ),
            },
            render.pcm_f32le,
        )

    async def register_host_midi_bridge(
        self,
        connection_id: str,
        request: HostMidiRegisterRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        replacement_host_ids: set[str] = set()
        async with self._lock:
            existing = self._host_midi_bridges.get(connection_id)
            if existing is not None:
                replacement_host_ids.add(existing.host_id)

            duplicate_connection_ids = [
                bridge_connection_id
                for bridge_connection_id, lease in self._host_midi_bridges.items()
                if bridge_connection_id != connection_id and lease.host_id == request.host_id
            ]
            for bridge_connection_id in duplicate_connection_ids:
                removed = self._host_midi_bridges.pop(bridge_connection_id, None)
                if removed is not None:
                    replacement_host_ids.add(removed.host_id)

            self._host_midi_bridges[connection_id] = HostMidiBridgeLease(
                connection_id=connection_id,
                host_id=request.host_id,
                host_name=request.host_name,
                protocol_version=request.protocol_version,
            )

        for host_id in replacement_host_ids:
            self._midi_service.remove_host_inputs(host_id=host_id)

        return {
            "type": "host_registered",
            "host_id": request.host_id,
            "server_monotonic_ns": time.perf_counter_ns(),
            "protocol_version": request.protocol_version,
        }

    async def host_midi_clock_sync(
        self,
        connection_id: str,
        request: HostMidiClockSyncRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        lease = await self._require_host_midi_bridge(connection_id)
        server_monotonic_ns = time.perf_counter_ns()
        lease.timing_mapping.update(
            remote_timestamp_ns=request.client_monotonic_ns,
            server_timestamp_ns=server_monotonic_ns,
        )
        return {
            "type": "clock_sync",
            "host_id": lease.host_id,
            "server_monotonic_ns": server_monotonic_ns,
        }

    async def host_midi_device_inventory(
        self,
        connection_id: str,
        request: HostMidiDeviceInventoryRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        lease = await self._require_host_midi_bridge(connection_id)
        devices = [
            HostMidiDeviceRef(
                id=device.id,
                name=device.name,
                backend="host_bridge",
                selector=device.selector,
                host_id=lease.host_id,
                timestamp_quality=device.timestamp_quality,
            )
            for device in request.devices
        ]
        self._midi_service.replace_host_inputs(host_id=lease.host_id, devices=devices)
        return {
            "type": "device_inventory_ack",
            "host_id": lease.host_id,
            "device_count": len(devices),
        }

    async def host_midi_events(
        self,
        connection_id: str,
        request: HostMidiEventsRequest,
    ) -> None:
        self._remember_running_loop()
        if not request.events:
            return

        lease = await self._require_host_midi_bridge(connection_id)
        async with self._lock:
            sessions_by_device: dict[str, list[tuple[RuntimeSession, BrowserClockControllerLease | None]]] = {}
            for runtime in self._sessions.values():
                if not runtime.worker.is_running or not runtime.midi_input:
                    continue
                sessions_by_device.setdefault(runtime.midi_input, []).append(
                    (runtime, self._browser_clock_controllers.get(runtime.session_id))
                )

        for event in request.events:
            targets = sessions_by_device.get(event.device_id)
            if not targets:
                continue

            now_server_ns = time.perf_counter_ns()
            mapped_backend_monotonic_ns: int | None = None
            sync_stale = False
            if event.timestamp_ns is not None:
                mapped_backend_monotonic_ns, sync_stale = lease.timing_mapping.map_to_server_time(
                    event.timestamp_ns,
                    now_server_ns=now_server_ns,
                )
                if mapped_backend_monotonic_ns is None:
                    sync_stale = True

            midi_request = self._session_midi_request_from_bytes(event.midi)
            if midi_request is None:
                continue

            for runtime, controller_lease in targets:
                target_engine_sample = self._target_engine_sample_for_mapped_event(
                    runtime=runtime,
                    lease=controller_lease,
                    mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
                    now_server_ns=now_server_ns,
                )
                await self._queue_session_midi_event(
                    runtime,
                    midi_request,
                    source=f"host_bridge:{lease.host_id}",
                    target_engine_sample=target_engine_sample,
                    mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
                    sync_stale=sync_stale,
                )

    async def release_host_midi_bridge(self, connection_id: str) -> None:
        self._remember_running_loop()
        lease: HostMidiBridgeLease | None = None
        async with self._lock:
            lease = self._host_midi_bridges.pop(connection_id, None)
        if lease is None:
            return
        self._midi_service.remove_host_inputs(host_id=lease.host_id)

    async def send_midi_event(self, session_id: str, request: SessionMidiEventRequest) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        if not runtime.worker.is_running:
            raise HTTPException(status_code=409, detail="Session must be running to receive MIDI events.")

        detail = await self._queue_session_midi_event(runtime, request, source="internal_api")

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def configure_session_sequencer(
        self,
        session_id: str,
        request: SessionSequencerConfigRequest,
    ) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        sequencer = self._ensure_sequencer(runtime)

        try:
            status = sequencer.configure(request)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await self._publish(
            runtime.session_id,
            "sequencer_configured",
            {
                "tempo_bpm": status.timing.tempo_bpm,
                "step_count": status.step_count,
                "tracks": len(status.tracks),
            },
        )
        return status

    async def start_session_sequencer(
        self,
        session_id: str,
        request: SessionSequencerStartRequest,
    ) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        if not runtime.worker.is_running:
            await self.start_session(session_id)

        sequencer = self._ensure_sequencer(runtime)

        try:
            if request.config is not None:
                sequencer.configure(request.config)
            status = sequencer.start(request.position_step)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await self._publish(
            runtime.session_id,
            "sequencer_started",
            {
                "tempo_bpm": status.timing.tempo_bpm,
                "step_count": status.step_count,
            },
        )
        return status

    async def stop_session_sequencer(self, session_id: str) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        sequencer = self._ensure_sequencer(runtime)
        status = sequencer.stop()

        await self._publish(runtime.session_id, "sequencer_stopped", {"cycle": status.cycle})
        return status

    async def queue_session_sequencer_pad(
        self,
        session_id: str,
        track_id: str,
        request: SessionSequencerQueuePadRequest,
    ) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        sequencer = self._ensure_sequencer(runtime)
        try:
            status = sequencer.queue_pad(track_id, request.pad_index)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await self._publish(
            runtime.session_id,
            "sequencer_pad_queued",
            {"track_id": track_id, "pad_index": request.pad_index},
        )
        return status

    async def rewind_session_sequencer_cycle(self, session_id: str) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        sequencer = self._ensure_sequencer(runtime)
        status = sequencer.rewind_cycle()

        await self._publish(
            runtime.session_id,
            "sequencer_cycle_rewound",
            {"cycle": status.cycle, "step": status.current_step, "running": status.running},
        )
        return status

    async def forward_session_sequencer_cycle(self, session_id: str) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        sequencer = self._ensure_sequencer(runtime)
        status = sequencer.forward_cycle()

        await self._publish(
            runtime.session_id,
            "sequencer_cycle_forwarded",
            {"cycle": status.cycle, "step": status.current_step, "running": status.running},
        )
        return status

    async def get_session_sequencer_status(self, session_id: str) -> SessionSequencerStatus:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        sequencer = self._ensure_sequencer(runtime)
        return sequencer.status()

    async def bind_midi_input(self, session_id: str, request: BindMidiInputRequest) -> SessionInfo:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)

        try:
            resolved = self._midi_service.resolve_input(request.midi_input)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        runtime.midi_input = resolved

        await self._publish(runtime.session_id, "midi_bound", {"midi_input": resolved})

        return self._session_info(runtime)

    async def delete_session(self, session_id: str) -> None:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        await self._disconnect_browser_clock_controller(
            session_id,
            detail="Session deleted.",
            close_code=4004,
            close_reason="session_deleted",
        )
        if runtime.sequencer is not None:
            runtime.sequencer.shutdown()
        runtime.worker.stop()

        heartbeat_tasks_to_cancel: list[asyncio.Task[None]] = []
        auto_stop_task_to_cancel: asyncio.Task[None] | None = None
        async with self._lock:
            self._sessions.pop(session_id, None)
            heartbeat_tasks = self._frontend_heartbeat_watchdogs.pop(session_id, {})
            heartbeat_tasks_to_cancel = list(heartbeat_tasks.values())
            self._frontend_connections.pop(session_id, None)
            auto_stop_task_to_cancel = self._frontend_auto_stop_tasks.pop(session_id, None)
            browser_clock_auto_stop_task = self._browser_clock_auto_stop_tasks.pop(session_id, None)
        for task in heartbeat_tasks_to_cancel:
            task.cancel()
        if auto_stop_task_to_cancel is not None:
            auto_stop_task_to_cancel.cancel()
        if browser_clock_auto_stop_task is not None:
            browser_clock_auto_stop_task.cancel()

        await self._publish(session_id, "session_deleted", {})

    async def _queue_session_midi_event(
        self,
        runtime: RuntimeSession,
        request: SessionMidiEventRequest,
        *,
        source: str,
        target_engine_sample: int | None = None,
        event_perf_ms: float | None = None,
        mapped_backend_monotonic_ns: int | None = None,
        sync_stale: bool = False,
    ) -> str:
        channel = request.channel - 1
        messages: list[list[int]] = []
        if request.type == "note_on":
            assert request.note is not None
            messages.append([0x90 + channel, request.note, request.velocity])
            detail = "note_on queued via engine:internal"
        elif request.type == "note_off":
            assert request.note is not None
            messages.append([0x80 + channel, request.note, 0])
            detail = "note_off queued via engine:internal"
        elif request.type == "control_change":
            assert request.controller is not None
            assert request.value is not None
            messages.append([0xB0 + channel, request.controller, request.value])
            detail = "control_change queued via engine:internal"
        else:
            messages.extend([[0xB0 + channel, 123, 0], [0xB0 + channel, 120, 0]])
            detail = "all_notes_off queued via engine:internal"

        source_timestamp_ns = (
            None
            if event_perf_ms is None
            else int(round(max(0.0, event_perf_ms) * 1_000_000.0))
        )
        for message in messages:
            queued = runtime.worker.enqueue_timestamped_midi(
                message,
                source=source,
                target_engine_sample=target_engine_sample,
                source_timestamp_ns=source_timestamp_ns,
                mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
                sync_stale=sync_stale,
            )
            if queued:
                continue
            await self._publish(
                runtime.session_id,
                "runtime_warning",
                {"detail": "Engine MIDI scheduler overflowed and rejected new MIDI events."},
            )
            raise HTTPException(status_code=409, detail="Engine MIDI scheduler overflowed.")

        payload: dict[str, str | int | float | bool | None] = {
            "type": request.type,
            "channel": request.channel,
            "output": "engine:internal",
        }
        if request.note is not None:
            payload["note"] = request.note
        if request.type == "note_on":
            payload["velocity"] = request.velocity
        if request.type == "control_change":
            payload["controller"] = request.controller
            payload["value"] = request.value
        if sync_stale:
            payload["sync_stale"] = True

        await self._publish(runtime.session_id, "midi_event", payload)
        return detail

    def _target_engine_sample_for_browser_event(
        self,
        *,
        runtime: RuntimeSession,
        lease: BrowserClockControllerLease,
        event_perf_ms: float | None,
        now_server_ns: int | None = None,
    ) -> tuple[int, int | None, bool]:
        if event_perf_ms is None:
            return (runtime.worker.render_sample_cursor, None, False)

        effective_now_server_ns = now_server_ns or time.perf_counter_ns()
        mapped_backend_monotonic_ns, sync_stale = self._map_browser_clock_perf_ms_to_server_ns(
            lease,
            event_perf_ms,
            now_server_ns=effective_now_server_ns,
        )
        if mapped_backend_monotonic_ns is None:
            return (runtime.worker.render_sample_cursor, None, True)
        if sync_stale:
            return (runtime.worker.render_sample_cursor, mapped_backend_monotonic_ns, True)

        return (
            self._target_engine_sample_for_mapped_event(
                runtime=runtime,
                lease=lease,
                mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
                now_server_ns=effective_now_server_ns,
            ),
            mapped_backend_monotonic_ns,
            False,
        )

    async def _get_session(self, session_id: str) -> RuntimeSession:
        async with self._lock:
            runtime = self._sessions.get(session_id)
        if not runtime:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
        return runtime

    @staticmethod
    def _session_info(runtime: RuntimeSession) -> SessionInfo:
        return SessionInfo(
            session_id=runtime.session_id,
            patch_id=runtime.patch_id,
            instruments=runtime.instruments,
            state=runtime.state,
            midi_input=runtime.midi_input,
            created_at=runtime.created_at,
            started_at=runtime.started_at,
        )

    @staticmethod
    def _resolve_session_instruments(request: SessionCreateRequest) -> list[SessionInstrumentAssignment]:
        if request.instruments:
            return list(request.instruments)
        if request.patch_id:
            return [SessionInstrumentAssignment(patch_id=request.patch_id, midi_channel=1)]
        raise HTTPException(status_code=422, detail="Session requires at least one instrument patch.")

    async def _publish(self, session_id: str, event_type: str, payload: dict[str, Any]) -> None:
        event = SessionEvent(session_id=session_id, type=event_type, payload=payload)
        await self._event_bus.publish(event)

    def _ensure_sequencer(self, runtime: RuntimeSession) -> SessionSequencerRuntime:
        if runtime.sequencer is not None:
            return runtime.sequencer

        runtime.sequencer = SessionSequencerRuntime(
            session_id=runtime.session_id,
            midi_service=runtime.worker.midi_output,
            midi_input_selector=INTERNAL_LOOPBACK_ID,
            controller_default_channels=self._controller_default_channels_for_runtime(runtime),
            clock_mode="render_driven",
            publish_event=lambda event_type, payload, session_id=runtime.session_id: self._publish_from_thread(
                session_id=session_id,
                event_type=event_type,
                payload=payload,
            ),
        )
        return runtime.sequencer

    @staticmethod
    def _controller_default_channels_for_runtime(runtime: RuntimeSession) -> tuple[int, ...]:
        channels = tuple(
            sorted(
                {
                    max(1, min(16, int(assignment.midi_channel)))
                    for assignment in runtime.instruments
                }
            )
        )
        return channels if channels else (1,)

    def _resolve_default_midi_input_id(self, midi_inputs: list[MidiInputRef] | None = None) -> str:
        inputs = midi_inputs if midi_inputs is not None else self._midi_service.list_inputs()
        if not inputs:
            return INTERNAL_LOOPBACK_ID
        try:
            return self._midi_service.resolve_input(self._settings.default_midi_device)
        except ValueError:
            return inputs[0].id

    def _resolve_runtime_midi_backend_selector(self, runtime: RuntimeSession) -> str:
        return INTERNAL_LOOPBACK_SELECTOR

    def _map_browser_clock_perf_ms_to_server_ns(
        self,
        lease: BrowserClockControllerLease | None,
        perf_ms: float | None,
        *,
        now_server_ns: int,
    ) -> tuple[int | None, bool]:
        if lease is None or perf_ms is None:
            return (None, True)
        remote_timestamp_ns = int(round(max(0.0, perf_ms) * 1_000_000.0))
        mapped_server_ns, sync_stale = lease.timing_mapping.map_to_server_time(
            remote_timestamp_ns,
            now_server_ns=now_server_ns,
        )
        if mapped_server_ns is None:
            return (None, True)
        if sync_stale or self._browser_timing_report_is_stale(lease, now_server_ns=now_server_ns):
            return (mapped_server_ns, True)
        return (mapped_server_ns, False)

    @staticmethod
    def _browser_timing_report_is_stale(
        lease: BrowserClockControllerLease | None,
        *,
        now_server_ns: int,
    ) -> bool:
        if lease is None or lease.last_timing_report_server_ns is None:
            return True
        return (now_server_ns - lease.last_timing_report_server_ns) > 1_000_000_000

    def _target_engine_sample_for_mapped_event(
        self,
        *,
        runtime: RuntimeSession,
        lease: BrowserClockControllerLease | None,
        mapped_backend_monotonic_ns: int | None,
        now_server_ns: int,
    ) -> int:
        if mapped_backend_monotonic_ns is None:
            return runtime.worker.render_sample_cursor
        if lease is None or lease.latest_report_sample_rate <= 0:
            return runtime.worker.render_sample_cursor
        if self._browser_timing_report_is_stale(lease, now_server_ns=now_server_ns):
            return runtime.worker.render_sample_cursor

        engine_sample_rate = max(1, runtime.worker.runtime_sample_rate)
        report_sample_rate = max(1, lease.latest_report_sample_rate)
        queued_engine_frames = int(
            round(
                (lease.latest_queued_frames + lease.latest_pending_render_frames)
                * (engine_sample_rate / float(report_sample_rate))
            )
        )
        audible_sample_estimate = max(0, runtime.worker.render_sample_cursor - queued_engine_frames)
        delta_ns = mapped_backend_monotonic_ns - now_server_ns
        target_sample = audible_sample_estimate + int(round((delta_ns * engine_sample_rate) / 1_000_000_000.0))
        return max(0, target_sample)

    def _browser_clock_render_telemetry(
        self,
        *,
        lease: BrowserClockControllerLease | None,
        request: BrowserClockRequestRenderRequest,
        server_received_ns: int,
        server_render_start_ns: int,
        server_render_end_ns: int,
    ) -> dict[str, object]:
        mapped_request_server_ns, timing_sync_stale = self._map_browser_clock_perf_ms_to_server_ns(
            lease,
            request.client_perf_ms,
            now_server_ns=server_received_ns,
        )
        websocket_message_wait_ms = None
        if mapped_request_server_ns is not None and not timing_sync_stale:
            websocket_message_wait_ms = max(0.0, (server_received_ns - mapped_request_server_ns) / 1_000_000.0)

        timing_report_age_ms = None
        if lease is not None and lease.last_timing_report_server_ns is not None:
            timing_report_age_ms = max(0.0, (server_received_ns - lease.last_timing_report_server_ns) / 1_000_000.0)

        note_on_to_render_request_ms = None
        note_on_to_render_complete_ms = None
        if lease is not None and not lease.last_note_on_sync_stale:
            note_on_anchor_ns = lease.last_note_on_mapped_server_ns
            if note_on_anchor_ns is not None:
                note_on_to_render_request_ms = max(0.0, (server_received_ns - note_on_anchor_ns) / 1_000_000.0)
                note_on_to_render_complete_ms = max(0.0, (server_render_end_ns - note_on_anchor_ns) / 1_000_000.0)

        return {
            "request_id": request.request_id,
            "priority": request.priority,
            "queued_frames_at_start": 0 if lease is None else lease.latest_queued_frames,
            "pending_render_frames_at_start": 0 if lease is None else lease.latest_pending_render_frames,
            "underrun_count_at_start": 0 if lease is None else lease.latest_underrun_count,
            "timing_report_age_ms": timing_report_age_ms,
            "timing_sync_stale": timing_sync_stale,
            "websocket_message_wait_ms": websocket_message_wait_ms,
            "render_service_time_ms": max(0.0, (server_render_end_ns - server_render_start_ns) / 1_000_000.0),
            "server_received_monotonic_ns": server_received_ns,
            "server_render_started_monotonic_ns": server_render_start_ns,
            "server_render_completed_monotonic_ns": server_render_end_ns,
            "note_on_to_render_request_ms": note_on_to_render_request_ms,
            "note_on_to_render_complete_ms": note_on_to_render_complete_ms,
        }

    async def _require_host_midi_bridge(self, connection_id: str) -> HostMidiBridgeLease:
        async with self._lock:
            lease = self._host_midi_bridges.get(connection_id)
        if lease is None:
            raise HTTPException(status_code=409, detail="Host MIDI bridge must register before sending data.")
        return lease

    @staticmethod
    def _session_midi_request_from_bytes(message: list[int]) -> SessionMidiEventRequest | None:
        if len(message) != 3:
            return None
        status = int(message[0]) & 0xF0
        channel = (int(message[0]) & 0x0F) + 1
        data1 = int(message[1]) & 0x7F
        data2 = int(message[2]) & 0x7F

        if status == 0x90:
            if data2 == 0:
                return SessionMidiEventRequest(type="note_off", channel=channel, note=data1)
            return SessionMidiEventRequest(type="note_on", channel=channel, note=data1, velocity=data2)
        if status == 0x80:
            return SessionMidiEventRequest(type="note_off", channel=channel, note=data1)
        if status == 0xB0 and data1 in {120, 123}:
            return SessionMidiEventRequest(type="all_notes_off", channel=channel)
        if status == 0xB0:
            return SessionMidiEventRequest(type="control_change", channel=channel, controller=data1, value=data2)
        return None

    def _remember_running_loop(self) -> None:
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            return

    @staticmethod
    def _browser_clock_sequencer_status_message(
        *,
        request_id: str,
        action: str,
        status: SessionSequencerStatus,
    ) -> dict[str, object]:
        return {
            "type": "sequencer_status",
            "request_id": request_id,
            "action": action,
            "sequencer_status": status.model_dump(mode="json"),
        }

    @staticmethod
    def _assert_browser_clock_mode(runtime: RuntimeSession) -> None:
        if runtime.worker.audio_output_mode != "browser_clock":
            raise HTTPException(
                status_code=409,
                detail="Browser-clock control requires VISUALCSOUND_AUDIO_OUTPUT_MODE=browser_clock.",
            )

    async def _disconnect_browser_clock_controller(
        self,
        session_id: str,
        *,
        detail: str,
        close_code: int,
        close_reason: str,
    ) -> None:
        lease: BrowserClockControllerLease | None = None
        async with self._lock:
            lease = self._browser_clock_controllers.pop(session_id, None)
            self._cancel_browser_clock_auto_stop_task_unlocked(session_id)
        if lease is None:
            return
        try:
            await lease.send_json({"type": "engine_error", "detail": detail})
        except Exception:
            logger.exception("Failed to notify browser-clock controller for session '%s'", session_id)
        try:
            await lease.close(close_code, close_reason)
        except Exception:
            logger.exception("Failed to close browser-clock controller for session '%s'", session_id)

    async def _drop_frontend_connection(
        self,
        session_id: str,
        connection_id: str,
        *,
        immediate_stop: bool,
        reason: str,
    ) -> None:
        should_stop_now = False

        async with self._lock:
            self._cancel_frontend_heartbeat_watchdog_unlocked(session_id, connection_id)

            connections = self._frontend_connections.get(session_id)
            if not connections or connection_id not in connections:
                return

            connections.discard(connection_id)
            if not connections:
                self._frontend_connections.pop(session_id, None)

            if session_id not in self._sessions:
                return

            if self._frontend_connections.get(session_id):
                return

            if immediate_stop:
                self._cancel_frontend_auto_stop_task_unlocked(session_id)
                should_stop_now = True
            else:
                self._schedule_frontend_auto_stop_task_unlocked(
                    session_id=session_id,
                    delay_seconds=self._settings.frontend_disconnect_grace_seconds,
                    reason=reason,
                )

        if should_stop_now:
            await self._auto_stop_session_if_running(session_id, reason)

    def _reset_frontend_heartbeat_watchdog_unlocked(self, session_id: str, connection_id: str) -> None:
        watchdogs = self._frontend_heartbeat_watchdogs.setdefault(session_id, {})
        existing = watchdogs.pop(connection_id, None)
        if existing is not None:
            existing.cancel()
        watchdogs[connection_id] = asyncio.create_task(
            self._frontend_heartbeat_watchdog(session_id, connection_id),
            name=f"frontend-heartbeat:{session_id}:{connection_id}",
        )

    def _cancel_frontend_heartbeat_watchdog_unlocked(self, session_id: str, connection_id: str) -> None:
        watchdogs = self._frontend_heartbeat_watchdogs.get(session_id)
        if not watchdogs:
            return
        task = watchdogs.pop(connection_id, None)
        current_task = asyncio.current_task()
        if task is not None and task is not current_task:
            task.cancel()
        if not watchdogs:
            self._frontend_heartbeat_watchdogs.pop(session_id, None)

    async def _frontend_heartbeat_watchdog(self, session_id: str, connection_id: str) -> None:
        try:
            await asyncio.sleep(self._settings.frontend_heartbeat_timeout_seconds)
        except asyncio.CancelledError:
            return

        logger.info(
            "Frontend heartbeat timed out for session '%s' connection '%s'",
            session_id,
            connection_id,
        )
        await self._drop_frontend_connection(
            session_id,
            connection_id,
            immediate_stop=True,
            reason="heartbeat_timeout",
        )

    def _schedule_frontend_auto_stop_task_unlocked(
        self,
        *,
        session_id: str,
        delay_seconds: float,
        reason: str,
    ) -> None:
        self._cancel_frontend_auto_stop_task_unlocked(session_id)
        self._frontend_auto_stop_tasks[session_id] = asyncio.create_task(
            self._frontend_auto_stop_after_delay(session_id, delay_seconds, reason),
            name=f"frontend-autostop:{session_id}",
        )

    def _cancel_frontend_auto_stop_task_unlocked(self, session_id: str) -> None:
        task = self._frontend_auto_stop_tasks.pop(session_id, None)
        if task is not None:
            task.cancel()

    async def _frontend_auto_stop_after_delay(self, session_id: str, delay_seconds: float, reason: str) -> None:
        try:
            await asyncio.sleep(delay_seconds)

            async with self._lock:
                if self._frontend_connections.get(session_id):
                    return
                current = self._frontend_auto_stop_tasks.get(session_id)
                if current is not asyncio.current_task():
                    return
                self._frontend_auto_stop_tasks.pop(session_id, None)

            await self._auto_stop_session_if_running(session_id, reason)
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("Failed during frontend disconnect auto-stop for session '%s'", session_id)

    def _schedule_browser_clock_auto_stop_task_unlocked(self, *, session_id: str, delay_seconds: float) -> None:
        self._cancel_browser_clock_auto_stop_task_unlocked(session_id)
        self._browser_clock_auto_stop_tasks[session_id] = asyncio.create_task(
            self._browser_clock_auto_stop_after_delay(session_id, delay_seconds),
            name=f"browser-clock-autostop:{session_id}",
        )

    def _cancel_browser_clock_auto_stop_task_unlocked(self, session_id: str) -> None:
        task = self._browser_clock_auto_stop_tasks.pop(session_id, None)
        if task is not None:
            task.cancel()

    async def _browser_clock_auto_stop_after_delay(self, session_id: str, delay_seconds: float) -> None:
        try:
            await asyncio.sleep(delay_seconds)

            async with self._lock:
                if self._browser_clock_controllers.get(session_id) is not None:
                    return
                current = self._browser_clock_auto_stop_tasks.get(session_id)
                if current is not asyncio.current_task():
                    return
                self._browser_clock_auto_stop_tasks.pop(session_id, None)

            await self._auto_stop_session_if_running(session_id, "browser_clock_controller_disconnect")
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("Failed during browser-clock controller auto-stop for session '%s'", session_id)

    async def _auto_stop_session_if_running(self, session_id: str, reason: str) -> None:
        try:
            runtime = await self._get_session(session_id)
        except HTTPException as exc:
            if exc.status_code == 404:
                return
            raise

        if not runtime.worker.is_running:
            return

        logger.info("Auto-stopping session '%s' after frontend loss (%s)", session_id, reason)
        try:
            await self.stop_session(session_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                logger.warning(
                    "Auto-stop for session '%s' failed with HTTP %s: %s",
                    session_id,
                    exc.status_code,
                    exc.detail,
                )
        except Exception:
            logger.exception("Auto-stop for session '%s' failed", session_id)

    def _publish_from_thread(
        self,
        session_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        loop = self._loop
        if loop is None:
            return
        coroutine = self._publish(session_id=session_id, event_type=event_type, payload=payload)
        if loop.is_closed():
            coroutine.close()
            return

        try:
            future = asyncio.run_coroutine_threadsafe(
                coroutine,
                loop,
            )
            future.add_done_callback(self._handle_threadsafe_publish_result)
        except Exception:  # pragma: no cover - thread to loop failures are environment-dependent
            coroutine.close()
            logger.exception("Failed to publish sequencer event from worker thread")

    @staticmethod
    def _handle_threadsafe_publish_result(future: object) -> None:
        try:
            error = getattr(future, "exception")()
        except Exception:  # pragma: no cover - event-loop dependent
            logger.exception("Failed to inspect sequencer publish future state")
            return
        if error is not None:  # pragma: no cover - event-loop dependent
            logger.warning("Sequencer event publish failed: %s", error)
