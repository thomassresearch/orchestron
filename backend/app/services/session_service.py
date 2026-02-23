from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from backend.app.core.config import Settings
from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.session_runtime import RuntimeSession
from backend.app.models.session import (
    BindMidiInputRequest,
    CompileResponse,
    SessionAudioWebRtcAnswerResponse,
    SessionAudioWebRtcOfferRequest,
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
from backend.app.services.midi_service import MidiService
from backend.app.services.patch_service import PatchService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime

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
        self._patch_service = patch_service
        self._compiler_service = compiler_service
        self._midi_service = midi_service
        self._event_bus = event_bus
        self._sessions: dict[str, RuntimeSession] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def create_session(self, request: SessionCreateRequest) -> SessionCreateResponse:
        self._remember_running_loop()
        instruments = self._resolve_session_instruments(request)
        # Verify patches exist before creating runtime.
        for assignment in instruments:
            self._patch_service.get_patch_document(assignment.patch_id)

        midi_inputs = self._midi_service.list_inputs()
        default_midi = midi_inputs[0].id if midi_inputs else self._settings.default_midi_device
        backend_webrtc_ice_servers = [
            server.model_dump(exclude_none=True) for server in self._settings.resolved_webrtc_backend_ice_servers
        ]

        runtime = RuntimeSession(
            session_id=str(uuid4()),
            instruments=instruments,
            midi_input=default_midi,
            worker=CsoundWorker(
                webrtc_ice_servers=backend_webrtc_ice_servers,
                gen_audio_assets_dir=str(self._settings.gen_audio_assets_dir),
            ),
        )
        runtime.sequencer = SessionSequencerRuntime(
            session_id=runtime.session_id,
            midi_service=self._midi_service,
            midi_input_selector=default_midi,
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

        midi_device = runtime.midi_input or self._settings.default_midi_device

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
                midi_input=runtime.midi_input or self._settings.default_midi_device,
                rtmidi_module=self._settings.default_rtmidi_module,
            )
        except Exception as exc:
            runtime.state = SessionState.ERROR
            await self._publish(runtime.session_id, "start_failed", {"error": str(exc)})
            raise HTTPException(status_code=500, detail=f"Failed to start session: {exc}") from exc

        runtime.state = SessionState.RUNNING
        runtime.started_at = datetime.now(timezone.utc)
        self._sync_runtime_direct_midi_sink(runtime)

        await self._publish(
            runtime.session_id,
            "started",
            {
                "backend": result.backend,
                "detail": result.detail,
                "midi_input": runtime.midi_input or self._settings.default_midi_device,
                "audio_mode": result.audio_mode,
                "audio_stream_ready": result.audio_stream_ready,
                "audio_stream_sample_rate": result.audio_stream_sample_rate,
            },
        )

        return SessionActionResponse(
            session_id=runtime.session_id,
            state=runtime.state,
            detail=result.detail,
        )

    async def stop_session(self, session_id: str) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        if runtime.sequencer is not None:
            runtime.sequencer.stop()
        self._detach_runtime_direct_midi_sink(runtime)
        await runtime.worker.close_webrtc_audio()
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

    async def negotiate_session_audio_stream(
        self,
        session_id: str,
        request: SessionAudioWebRtcOfferRequest,
    ) -> SessionAudioWebRtcAnswerResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)

        try:
            answer_sdp, answer_type = await runtime.worker.create_webrtc_audio_answer(
                offer_sdp=request.sdp,
                offer_type=request.type,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except RuntimeError as exc:
            message = str(exc)
            status_code = (
                409
                if any(
                    token in message.lower()
                    for token in (
                        "disabled",
                        "must be running",
                        "not ready",
                        "requires the ctcsound backend",
                    )
                )
                else 500
            )
            raise HTTPException(status_code=status_code, detail=message) from exc

        await self._publish(
            runtime.session_id,
            "audio_stream_negotiated",
            {
                "sample_rate": runtime.worker.browser_audio_stream_sample_rate or 0,
                "mode": runtime.worker.audio_output_mode,
            },
        )
        return SessionAudioWebRtcAnswerResponse(
            type=answer_type,  # type: ignore[arg-type]
            sdp=answer_sdp,
            sample_rate=runtime.worker.browser_audio_stream_sample_rate or 48_000,
        )

    async def send_midi_event(self, session_id: str, request: SessionMidiEventRequest) -> SessionActionResponse:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        if not runtime.worker.is_running:
            raise HTTPException(status_code=409, detail="Session must be running to receive MIDI events.")

        midi_input_selector = runtime.midi_input or self._settings.default_midi_device
        channel = request.channel - 1

        try:
            if request.type == "note_on":
                assert request.note is not None
                output_name = self._midi_service.send_message(
                    midi_input_selector,
                    [0x90 + channel, request.note, request.velocity],
                )
                detail = f"note_on sent via {output_name}"
            elif request.type == "note_off":
                assert request.note is not None
                output_name = self._midi_service.send_message(
                    midi_input_selector,
                    [0x80 + channel, request.note, 0],
                )
                detail = f"note_off sent via {output_name}"
            elif request.type == "control_change":
                assert request.controller is not None
                assert request.value is not None
                output_name = self._midi_service.send_message(
                    midi_input_selector,
                    [0xB0 + channel, request.controller, request.value],
                )
                detail = f"control_change sent via {output_name}"
            else:
                output_name = self._midi_service.send_message(midi_input_selector, [0xB0 + channel, 123, 0])
                self._midi_service.send_message(midi_input_selector, [0xB0 + channel, 120, 0])
                detail = f"all_notes_off sent via {output_name}"
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        payload: dict[str, str | int | float | bool | None] = {
            "type": request.type,
            "channel": request.channel,
            "output": output_name,
        }
        if request.note is not None:
            payload["note"] = request.note
        if request.type == "note_on":
            payload["velocity"] = request.velocity
        if request.type == "control_change":
            payload["controller"] = request.controller
            payload["value"] = request.value

        await self._publish(runtime.session_id, "midi_event", payload)

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
                "bpm": status.bpm,
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
            status = sequencer.start()
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await self._publish(
            runtime.session_id,
            "sequencer_started",
            {
                "bpm": status.bpm,
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
        if runtime.sequencer is not None:
            runtime.sequencer.set_midi_input(resolved)
        self._sync_runtime_direct_midi_sink(runtime)
        runtime.compile_artifact = None
        runtime.state = SessionState.IDLE if not runtime.worker.is_running else runtime.state

        await self._publish(runtime.session_id, "midi_bound", {"midi_input": resolved})

        return self._session_info(runtime)

    async def delete_session(self, session_id: str) -> None:
        self._remember_running_loop()
        runtime = await self._get_session(session_id)
        if runtime.sequencer is not None:
            runtime.sequencer.shutdown()
        self._detach_runtime_direct_midi_sink(runtime)
        await runtime.worker.close_webrtc_audio()
        runtime.worker.stop()

        async with self._lock:
            self._sessions.pop(session_id, None)

        await self._publish(session_id, "session_deleted", {})

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

    async def _publish(self, session_id: str, event_type: str, payload: dict[str, str | int | float | bool | None]) -> None:
        event = SessionEvent(session_id=session_id, type=event_type, payload=payload)
        await self._event_bus.publish(event)

    def _ensure_sequencer(self, runtime: RuntimeSession) -> SessionSequencerRuntime:
        if runtime.sequencer is not None:
            return runtime.sequencer

        midi_input = runtime.midi_input or self._settings.default_midi_device
        runtime.sequencer = SessionSequencerRuntime(
            session_id=runtime.session_id,
            midi_service=self._midi_service,
            midi_input_selector=midi_input,
            publish_event=lambda event_type, payload, session_id=runtime.session_id: self._publish_from_thread(
                session_id=session_id,
                event_type=event_type,
                payload=payload,
            ),
        )
        return runtime.sequencer

    def _remember_running_loop(self) -> None:
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            return

    def _sync_runtime_direct_midi_sink(self, runtime: RuntimeSession) -> None:
        selector = runtime.midi_input or self._settings.default_midi_device

        if runtime.direct_midi_sink_selector and runtime.direct_midi_sink_selector != selector:
            self._midi_service.unregister_virtual_output_sink(
                selector=runtime.direct_midi_sink_selector,
                sink_id=runtime.session_id,
            )
            runtime.direct_midi_sink_selector = None

        if runtime.worker.accepts_direct_midi:
            self._midi_service.register_virtual_output_sink(
                selector=selector,
                sink_id=runtime.session_id,
                sink=runtime.worker.queue_midi_message,
            )
            runtime.direct_midi_sink_selector = selector
            return

        self._detach_runtime_direct_midi_sink(runtime)

    def _detach_runtime_direct_midi_sink(self, runtime: RuntimeSession) -> None:
        if not runtime.direct_midi_sink_selector:
            return
        self._midi_service.unregister_virtual_output_sink(
            selector=runtime.direct_midi_sink_selector,
            sink_id=runtime.session_id,
        )
        runtime.direct_midi_sink_selector = None

    def _publish_from_thread(
        self,
        session_id: str,
        event_type: str,
        payload: dict[str, str | int | float | bool | None],
    ) -> None:
        loop = self._loop
        if loop is None:
            return

        try:
            future = asyncio.run_coroutine_threadsafe(
                self._publish(session_id=session_id, event_type=event_type, payload=payload),
                loop,
            )
            future.add_done_callback(self._handle_threadsafe_publish_result)
        except Exception:  # pragma: no cover - thread to loop failures are environment-dependent
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
