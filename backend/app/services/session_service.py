from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
import math
import time
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from backend.app.core.config import Settings
from backend.app.engine.csound_worker import CsoundWorker
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
    SessionArpeggiatorConfigRequest,
    SessionArpeggiatorStatus,
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
    SessionInstrumentValidationRequest,
    SessionInstrumentValidationResponse,
    SessionResolvedEffectRoute,
    SessionState,
)
from backend.app.services.compiler_common import CompilationError
from backend.app.services.compiler_service import CompilerService
from backend.app.services.event_bus import SessionEventBus
from backend.app.services.host_midi_bridge_registry import (
    HostMidiBridgeLease,
    HostMidiBridgeRegistry,
    session_midi_request_from_bytes,
)
from backend.app.services.midi_service import INTERNAL_LOOPBACK_ID, INTERNAL_LOOPBACK_SELECTOR, MidiService
from backend.app.services.patch_service import PatchService
from backend.app.services.arpeggiator_runtime import MidiSourceContext, PerformanceMidiRouter
from backend.app.services.browser_clock_policy import (
    BROWSER_TIMING_REPORT_INTERVAL_MS,
    BrowserClockClose,
    BrowserClockControllerLease,
    BrowserClockSendJson,
    consume_browser_clock_manual_midi_token,
    validate_browser_clock_claim_budget,
    validate_browser_clock_manual_midi_horizon,
    validate_browser_clock_timing_budget,
)
from backend.app.services.browser_clock_runtime import BrowserClockRuntimeCoordinator
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.app.services.session_admission import SessionAdmissionController
from backend.app.services.session_connection_registry import SessionConnectionRegistry
from backend.app.services.session_instrument_resolver import SessionInstrumentResolver
from backend.app.services.session_performance_runtime import SessionPerformanceRuntimeCoordinator

logger = logging.getLogger(__name__)


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
        self._compiler_service = compiler_service
        self._instrument_resolver = SessionInstrumentResolver(patch_service)
        self._midi_service = midi_service
        self._event_bus = event_bus
        self._admission = SessionAdmissionController(settings)
        self._browser_clock_runtime = BrowserClockRuntimeCoordinator()
        self._performance_runtime = SessionPerformanceRuntimeCoordinator(settings, self._publish_from_thread)
        self._sessions: dict[str, RuntimeSession] = {}
        self._connections = SessionConnectionRegistry()
        self._frontend_heartbeat_watchdogs: dict[str, dict[str, asyncio.Task[None]]] = {}
        self._frontend_auto_stop_tasks: dict[str, asyncio.Task[None]] = {}
        self._browser_clock_auto_stop_tasks: dict[str, asyncio.Task[None]] = {}
        self._host_midi_bridges = HostMidiBridgeRegistry()
        self._session_last_activity: dict[str, float] = {}
        self._session_idle_tasks: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def create_session(
        self,
        request: SessionCreateRequest,
        *,
        client_key: str = "unknown",
    ) -> SessionCreateResponse:
        self._remember_running_loop()
        client_key = self._admission.normalize_client_key(client_key)
        await self._reserve_session_create(client_key)
        committed = False
        instruments = self._instrument_resolver.resolve_request(request)

        try:
            instruments = self._instrument_resolver.normalize(instruments)
            self._instrument_resolver.resolve_audio_routes(instruments)

            midi_inputs = self._midi_service.list_inputs()
            default_midi = self._resolve_default_midi_input_id(midi_inputs)

            runtime = RuntimeSession(
                session_id=str(uuid4()),
                instruments=instruments,
                midi_input=default_midi,
                worker=CsoundWorker(
                    gen_audio_assets_dir=str(self._settings.gen_audio_assets_dir),
                    csound_performance_logging=self._settings.csound_performance_logging,
                ),
            )
            self._performance_runtime.initialize(runtime)

            async with self._lock:
                self._sessions[runtime.session_id] = runtime
                self._admission.commit_session(runtime.session_id, client_key)
                self._session_last_activity[runtime.session_id] = time.monotonic()
                self._schedule_session_idle_expiry_unlocked(runtime.session_id)
                committed = True
        finally:
            if not committed:
                await self._release_session_create_reservation(client_key)

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

    async def validate_session_instruments(
        self,
        request: SessionInstrumentValidationRequest,
    ) -> SessionInstrumentValidationResponse:
        self._remember_running_loop()
        instruments = self._instrument_resolver.normalize(list(request.instruments))
        resolved_routes = self._instrument_resolver.resolve_audio_routes(instruments)
        return SessionInstrumentValidationResponse(
            instruments=instruments,
            resolved_routes=[
                SessionResolvedEffectRoute(
                    source_id=route.source_assignment_id,
                    source_outlet=route.source_port_name,
                    target_id=route.target_assignment_id,
                    target_inlet=route.target_port_name,
                )
                for route in resolved_routes
            ],
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

    async def validate_session_event_ws_connect(self, session_id: str, *, client_key: str = "unknown") -> None:
        self._remember_running_loop()
        client_key = self._admission.normalize_client_key(client_key)
        async with self._lock:
            self._admission.validate_event_ws_connect(client_key, now=time.monotonic())
            if session_id not in self._sessions:
                raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    async def frontend_connected(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        async with self._lock:
            if session_id not in self._sessions:
                return
            self._touch_session_activity_unlocked(session_id)
            self._cancel_frontend_auto_stop_task_unlocked(session_id)
            self._connections.add_frontend(session_id, connection_id)
            self._reset_frontend_heartbeat_watchdog_unlocked(session_id, connection_id)

    async def frontend_heartbeat(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        async with self._lock:
            if session_id not in self._sessions:
                return
            if not self._connections.contains_frontend(session_id, connection_id):
                return
            self._touch_session_activity_unlocked(session_id)
            self._reset_frontend_heartbeat_watchdog_unlocked(session_id, connection_id)

    async def frontend_disconnected(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        await self._drop_frontend_connection(session_id, connection_id, immediate_stop=False, reason="disconnect")

    async def compile_session(self, session_id: str) -> CompileResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        targets = [
            self._instrument_resolver.compile_target(assignment)
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
        if runtime.midi_router is not None:
            runtime.midi_router.shutdown()
        detail = runtime.worker.stop()
        runtime.state = SessionState.COMPILED if runtime.compile_artifact else SessionState.IDLE

        await self._publish(runtime.session_id, "stopped", {"detail": detail})

        return SessionActionResponse(session_id=runtime.session_id, state=runtime.state, detail=detail)

    async def panic_session(self, session_id: str) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        if runtime.midi_router is not None:
            runtime.midi_router.panic()
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
        validate_browser_clock_claim_budget(request)

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
            self._cancel_browser_clock_auto_stop_task_unlocked(session_id)
            previous = self._connections.replace_browser_controller(session_id, lease)

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
            "timing_report_interval_ms": BROWSER_TIMING_REPORT_INTERVAL_MS,
            "engine_ksmps_latency_frames": runtime.worker.runtime_ksmps,
            "sequencer_status": self._status_with_arpeggiators(runtime, sequencer.status()).model_dump(mode="json"),
        }

    async def release_browser_clock_controller(self, session_id: str, connection_id: str) -> None:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        self._assert_browser_clock_mode(runtime)

        should_schedule_auto_stop = False
        async with self._lock:
            lease = self._connections.remove_browser_controller(
                session_id,
                connection_id=connection_id,
            )
            if lease is None:
                return
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
        consume_browser_clock_manual_midi_token(
            lease,
            now_server_ns=event_server_received_ns,
            burst=self._settings.browser_clock_manual_midi_burst,
            rate_per_second=self._settings.browser_clock_manual_midi_rate_per_second,
        )
        if request.event_perf_ms is not None and not math.isfinite(request.event_perf_ms):
            raise HTTPException(status_code=422, detail="Browser-clock manual MIDI event_perf_ms must be finite.")
        target_engine_sample, mapped_backend_monotonic_ns, sync_stale = self._target_engine_sample_for_browser_event(
            runtime=runtime,
            lease=lease,
            event_perf_ms=request.event_perf_ms,
            now_server_ns=event_server_received_ns,
        )
        validate_browser_clock_manual_midi_horizon(
            current_sample=runtime.worker.render_sample_cursor,
            target_engine_sample=target_engine_sample,
            max_future_samples=self._browser_clock_manual_midi_max_future_samples(runtime),
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
        validate_browser_clock_timing_budget(lease, request)
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
        lease.latest_clock_sync_offset_ns = request.clock_sync_offset_ns
        lease.latest_clock_sync_rtt_ms = request.clock_sync_rtt_ms
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
            lease = self._connections.browser_controller(session_id)
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
        if request.block_count > lease.max_blocks_per_request:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Browser-clock render request exceeds the active controller block budget "
                    f"({lease.max_blocks_per_request})."
                ),
            )
        block_count = request.block_count
        sequencer = self._ensure_sequencer(runtime)
        router = self._ensure_midi_router(runtime)
        initial_transport_subunit, _initial_running = sequencer.render_transport_state()

        def _before_block(_block_index: int, block_start_sample: int | None = None) -> None:
            tempo_bpm = sequencer.advance_render_block(
                sample_rate=runtime.worker.runtime_sample_rate,
                ksmps=runtime.worker.runtime_ksmps,
                block_start_sample=block_start_sample,
            )
            start_sample = (
                runtime.worker.render_sample_cursor
                if block_start_sample is None
                else max(0, int(block_start_sample))
            )
            router.advance_render_block(
                block_start_sample=start_sample,
                block_end_sample=start_sample + max(1, runtime.worker.runtime_ksmps),
                sample_rate=max(1, runtime.worker.runtime_sample_rate),
                tempo_bpm=tempo_bpm,
            )

        render_started_ns = time.perf_counter_ns()
        try:
            render = await asyncio.to_thread(
                runtime.worker.render_blocks,
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
        final_transport_subunit, _final_running = sequencer.render_transport_state()
        transport_events = sequencer.drain_render_transport_events(
            engine_sample_start=render.engine_sample_start,
            engine_sample_end=render.engine_sample_end,
        )
        timeline_segments, serialized_transport_events = self._browser_clock_transport_timeline(
            engine_sample_start=render.engine_sample_start,
            engine_sample_end=render.engine_sample_end,
            engine_sample_rate=render.engine_sample_rate,
            target_frame_count=render.target_frame_count,
            initial_transport_subunit=initial_transport_subunit,
            final_transport_subunit=final_transport_subunit,
            transport_events=transport_events,
        )

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
                "timeline_segments": timeline_segments,
                "transport_events": serialized_transport_events,
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

    @staticmethod
    def _browser_clock_transport_timeline(
        *,
        engine_sample_start: int,
        engine_sample_end: int,
        engine_sample_rate: int,
        target_frame_count: int,
        initial_transport_subunit: int,
        final_transport_subunit: int,
        transport_events: list[Any],
    ) -> tuple[list[dict[str, int]], list[dict[str, object]]]:
        return BrowserClockRuntimeCoordinator.transport_timeline(
            engine_sample_start=engine_sample_start,
            engine_sample_end=engine_sample_end,
            engine_sample_rate=engine_sample_rate,
            target_frame_count=target_frame_count,
            initial_transport_subunit=initial_transport_subunit,
            final_transport_subunit=final_transport_subunit,
            transport_events=transport_events,
        )

    async def register_host_midi_bridge(
        self,
        connection_id: str,
        request: HostMidiRegisterRequest,
    ) -> dict[str, object]:
        self._remember_running_loop()
        async with self._lock:
            replacement_host_ids = self._host_midi_bridges.register(connection_id, request)

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
                    (runtime, self._connections.browser_controller(runtime.session_id))
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
        async with self._lock:
            lease = self._host_midi_bridges.release(connection_id)
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
            self._ensure_midi_router(runtime).configure(
                request.arpeggiators,
                tempo_bpm=request.timing.tempo_bpm,
            )
            status = self._status_with_arpeggiators(runtime, status)
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

    async def configure_session_arpeggiators(
        self,
        session_id: str,
        request: SessionArpeggiatorConfigRequest,
    ) -> list[SessionArpeggiatorStatus]:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)

        try:
            router = self._ensure_midi_router(runtime)
            router.configure(
                request.arpeggiators,
                tempo_bpm=request.tempo_bpm,
            )
            status = router.status()
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await self._publish(
            runtime.session_id,
            "arpeggiators_configured",
            {
                "tempo_bpm": request.tempo_bpm,
                "arpeggiators": len(status),
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
                self._ensure_midi_router(runtime).configure(
                    request.config.arpeggiators,
                    tempo_bpm=request.config.timing.tempo_bpm,
                )
            status = sequencer.start(request.position_step)
            status = self._status_with_arpeggiators(runtime, status)
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
        status = self._status_with_arpeggiators(runtime, status)

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

        status = self._status_with_arpeggiators(runtime, status)
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
        status = self._status_with_arpeggiators(runtime, status)

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
        status = self._status_with_arpeggiators(runtime, status)

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
        return self._status_with_arpeggiators(runtime, sequencer.status())

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
        await self._delete_session_resources(
            session_id,
            detail="Session deleted.",
            close_code=4004,
            close_reason="session_deleted",
            event_type="session_deleted",
            missing_ok=False,
        )

    async def _delete_session_resources(
        self,
        session_id: str,
        *,
        detail: str,
        close_code: int,
        close_reason: str,
        event_type: str,
        missing_ok: bool,
    ) -> None:
        async with self._lock:
            runtime = self._sessions.get(session_id)
        if runtime is None:
            if missing_ok:
                return
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

        await self._disconnect_browser_clock_controller(
            session_id,
            detail=detail,
            close_code=close_code,
            close_reason=close_reason,
        )
        if runtime.sequencer is not None:
            runtime.sequencer.shutdown()
        if runtime.midi_router is not None:
            runtime.midi_router.shutdown()
        runtime.worker.stop()

        heartbeat_tasks_to_cancel: list[asyncio.Task[None]] = []
        auto_stop_task_to_cancel: asyncio.Task[None] | None = None
        idle_task_to_cancel: asyncio.Task[None] | None = None
        async with self._lock:
            self._sessions.pop(session_id, None)
            self._admission.remove_session(session_id)
            self._session_last_activity.pop(session_id, None)
            heartbeat_tasks = self._frontend_heartbeat_watchdogs.pop(session_id, {})
            heartbeat_tasks_to_cancel = list(heartbeat_tasks.values())
            self._connections.clear_frontend(session_id)
            auto_stop_task_to_cancel = self._frontend_auto_stop_tasks.pop(session_id, None)
            browser_clock_auto_stop_task = self._browser_clock_auto_stop_tasks.pop(session_id, None)
            idle_task_to_cancel = self._session_idle_tasks.pop(session_id, None)
        for task in heartbeat_tasks_to_cancel:
            task.cancel()
        if auto_stop_task_to_cancel is not None:
            auto_stop_task_to_cancel.cancel()
        if browser_clock_auto_stop_task is not None:
            browser_clock_auto_stop_task.cancel()
        if idle_task_to_cancel is not None and idle_task_to_cancel is not asyncio.current_task():
            idle_task_to_cancel.cancel()

        await self._publish(session_id, event_type, {})

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
            router = self._ensure_midi_router(runtime)
            source_context = MidiSourceContext(
                source_id=request.source_id,
                scale_root=request.source_scale_root,
                mode=request.source_mode,
            )
            queued = router.route_message(
                message,
                source=source,
                target_engine_sample=target_engine_sample,
                delivery_delay_seconds=None,
                source_timestamp_ns=source_timestamp_ns,
                mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
                sync_stale=sync_stale,
                source_context=source_context,
            )
            if queued:
                continue
            await self._publish(
                runtime.session_id,
                "runtime_warning",
                {"detail": "Engine MIDI input queue rejected new MIDI events."},
            )
            raise HTTPException(status_code=409, detail="Engine MIDI input queue rejected new MIDI events.")

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
        return self._browser_clock_runtime.target_engine_sample_for_browser_event(
            runtime=runtime,
            lease=lease,
            event_perf_ms=event_perf_ms,
            now_server_ns=now_server_ns or time.perf_counter_ns(),
        )

    async def _get_session(self, session_id: str) -> RuntimeSession:
        async with self._lock:
            runtime = self._sessions.get(session_id)
            if runtime is not None:
                self._touch_session_activity_unlocked(session_id)
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

    async def _publish(self, session_id: str, event_type: str, payload: dict[str, Any]) -> None:
        event = SessionEvent(session_id=session_id, type=event_type, payload=payload)
        await self._event_bus.publish(event)

    async def _reserve_session_create(self, client_key: str) -> None:
        async with self._lock:
            self._admission.reserve_session_create(
                client_key,
                active_session_count=len(self._sessions),
                now=time.monotonic(),
            )

    async def _release_session_create_reservation(self, client_key: str) -> None:
        async with self._lock:
            self._admission.release_session_create_reservation(client_key)
    def _touch_session_activity_unlocked(self, session_id: str) -> None:
        if session_id not in self._sessions:
            return
        self._session_last_activity[session_id] = time.monotonic()
        self._schedule_session_idle_expiry_unlocked(session_id)

    def _schedule_session_idle_expiry_unlocked(self, session_id: str) -> None:
        self._cancel_session_idle_task_unlocked(session_id)
        self._session_idle_tasks[session_id] = asyncio.create_task(
            self._expire_session_after_idle_timeout(session_id),
            name=f"session-idle-expiry:{session_id}",
        )

    def _cancel_session_idle_task_unlocked(self, session_id: str) -> None:
        task = self._session_idle_tasks.pop(session_id, None)
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def _expire_session_after_idle_timeout(self, session_id: str) -> None:
        try:
            await asyncio.sleep(self._settings.session_idle_timeout_seconds)

            async with self._lock:
                runtime = self._sessions.get(session_id)
                if runtime is None:
                    self._session_idle_tasks.pop(session_id, None)
                    return
                if runtime.worker.is_running:
                    self._schedule_session_idle_expiry_unlocked(session_id)
                    return
                if self._connections.has_frontend(session_id) or self._connections.has_browser_controller(session_id):
                    self._schedule_session_idle_expiry_unlocked(session_id)
                    return
                current = self._session_idle_tasks.get(session_id)
                if current is not asyncio.current_task():
                    return
                last_activity = self._session_last_activity.get(session_id, 0.0)
                idle_for = time.monotonic() - last_activity
                if idle_for < self._settings.session_idle_timeout_seconds:
                    self._schedule_session_idle_expiry_unlocked(session_id)
                    return
                self._session_idle_tasks.pop(session_id, None)

            logger.info("Deleting idle session '%s' after timeout.", session_id)
            await self._delete_session_resources(
                session_id,
                detail="Session expired after being idle.",
                close_code=4004,
                close_reason="session_idle_expired",
                event_type="session_idle_expired",
                missing_ok=True,
            )
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("Failed during idle cleanup for session '%s'", session_id)

    def _ensure_sequencer(self, runtime: RuntimeSession) -> SessionSequencerRuntime:
        return self._performance_runtime.ensure_sequencer(runtime)

    def _ensure_midi_router(self, runtime: RuntimeSession) -> PerformanceMidiRouter:
        return self._performance_runtime.ensure_midi_router(runtime)

    def _create_midi_router(self, runtime: RuntimeSession) -> PerformanceMidiRouter:
        return self._performance_runtime.create_midi_router(runtime)

    def _browser_clock_manual_midi_max_future_samples(self, runtime: RuntimeSession) -> int:
        return self._performance_runtime.manual_midi_max_future_samples(runtime)

    def _status_with_arpeggiators(
        self,
        runtime: RuntimeSession,
        status: SessionSequencerStatus,
    ) -> SessionSequencerStatus:
        return self._performance_runtime.status_with_arpeggiators(runtime, status)

    @staticmethod
    def _controller_default_channels_for_runtime(runtime: RuntimeSession) -> tuple[int, ...]:
        return SessionPerformanceRuntimeCoordinator.controller_default_channels(runtime)
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
        return self._browser_clock_runtime.map_perf_ms_to_server_ns(
            lease,
            perf_ms,
            now_server_ns=now_server_ns,
        )

    @staticmethod
    def _browser_timing_report_is_stale(
        lease: BrowserClockControllerLease | None,
        *,
        now_server_ns: int,
    ) -> bool:
        return BrowserClockRuntimeCoordinator.timing_report_is_stale(
            lease,
            now_server_ns=now_server_ns,
        )

    def _target_engine_sample_for_mapped_event(
        self,
        *,
        runtime: RuntimeSession,
        lease: BrowserClockControllerLease | None,
        mapped_backend_monotonic_ns: int | None,
        now_server_ns: int,
    ) -> int:
        return self._browser_clock_runtime.target_engine_sample_for_mapped_event(
            runtime=runtime,
            lease=lease,
            mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
            now_server_ns=now_server_ns,
        )

    def _browser_clock_render_telemetry(
        self,
        *,
        lease: BrowserClockControllerLease | None,
        request: BrowserClockRequestRenderRequest,
        server_received_ns: int,
        server_render_start_ns: int,
        server_render_end_ns: int,
    ) -> dict[str, object]:
        return self._browser_clock_runtime.render_telemetry(
            lease=lease,
            request=request,
            server_received_ns=server_received_ns,
            server_render_start_ns=server_render_start_ns,
            server_render_end_ns=server_render_end_ns,
        )

    async def _require_host_midi_bridge(self, connection_id: str) -> HostMidiBridgeLease:
        async with self._lock:
            return self._host_midi_bridges.require(connection_id)

    @staticmethod
    def _session_midi_request_from_bytes(message: list[int]) -> SessionMidiEventRequest | None:
        return session_midi_request_from_bytes(message)

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
            lease = self._connections.remove_browser_controller(session_id)
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

            if not self._connections.remove_frontend(session_id, connection_id):
                return

            if session_id not in self._sessions:
                return

            if self._connections.has_frontend(session_id):
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
                if self._connections.has_frontend(session_id):
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
                if self._connections.has_browser_controller(session_id):
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
