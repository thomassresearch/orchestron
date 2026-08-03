from __future__ import annotations

from typing import Any

from backend.app.engine.session_runtime import RuntimeSession
from backend.app.models.session import BrowserClockRequestRenderRequest
from backend.app.services.browser_clock_policy import BrowserClockControllerLease


class BrowserClockRuntimeCoordinator:
    """Pure browser-clock timing, projection, and telemetry calculations."""

    @staticmethod
    def transport_timeline(
        *,
        engine_sample_start: int,
        engine_sample_end: int,
        engine_sample_rate: int,
        target_frame_count: int,
        initial_transport_subunit: int,
        final_transport_subunit: int,
        transport_events: list[Any],
    ) -> tuple[list[dict[str, int]], list[dict[str, object]]]:
        del engine_sample_rate
        source_frames = max(1, int(engine_sample_end) - int(engine_sample_start))
        target_frames = max(1, int(target_frame_count))

        def target_offset(engine_sample: int) -> int:
            source_offset = max(0, min(source_frames, int(engine_sample) - int(engine_sample_start)))
            return max(0, min(target_frames, int(round(source_offset * target_frames / source_frames))))

        ordered_events = sorted(transport_events, key=lambda event: int(event.engine_sample))
        serialized_events: list[dict[str, object]] = []
        segments: list[dict[str, int]] = []
        segment_frame_start = 0
        segment_subunit_start = max(0, int(initial_transport_subunit))

        for event in ordered_events:
            frame_offset = target_offset(event.engine_sample)
            serialized_events.append(
                {
                    "target_frame_offset": frame_offset,
                    "kind": event.kind,
                    "payload": event.payload,
                }
            )
            if event.kind == "loop":
                previous_subunit = max(
                    segment_subunit_start,
                    int(event.payload.get("previous_transport_subunit", segment_subunit_start)),
                )
                if frame_offset > segment_frame_start:
                    segments.append(
                        {
                            "target_frame_start": segment_frame_start,
                            "target_frame_end": frame_offset,
                            "transport_subunit_start": segment_subunit_start,
                            "transport_subunit_end": previous_subunit,
                        }
                    )
                segment_frame_start = frame_offset
                segment_subunit_start = max(0, int(event.payload.get("transport_subunit", 0)))
            elif event.kind == "stopped":
                stopped_subunit = max(0, int(event.payload.get("transport_subunit", final_transport_subunit)))
                if frame_offset > segment_frame_start:
                    segments.append(
                        {
                            "target_frame_start": segment_frame_start,
                            "target_frame_end": frame_offset,
                            "transport_subunit_start": segment_subunit_start,
                            "transport_subunit_end": stopped_subunit,
                        }
                    )
                segment_frame_start = frame_offset
                segment_subunit_start = stopped_subunit

        if target_frames > segment_frame_start:
            segments.append(
                {
                    "target_frame_start": segment_frame_start,
                    "target_frame_end": target_frames,
                    "transport_subunit_start": segment_subunit_start,
                    "transport_subunit_end": max(0, int(final_transport_subunit)),
                }
            )
        elif not segments:
            segments.append(
                {
                    "target_frame_start": 0,
                    "target_frame_end": target_frames,
                    "transport_subunit_start": segment_subunit_start,
                    "transport_subunit_end": max(0, int(final_transport_subunit)),
                }
            )
        return segments, serialized_events

    @staticmethod
    def timing_report_is_stale(
        lease: BrowserClockControllerLease | None,
        *,
        now_server_ns: int,
    ) -> bool:
        if lease is None or lease.last_timing_report_server_ns is None:
            return True
        return (now_server_ns - lease.last_timing_report_server_ns) > 1_000_000_000

    def map_perf_ms_to_server_ns(
        self,
        lease: BrowserClockControllerLease | None,
        perf_ms: float | None,
        *,
        now_server_ns: int,
    ) -> tuple[int | None, bool]:
        if lease is None or perf_ms is None:
            return (None, True)
        remote_timestamp_ns = int(round(max(0.0, perf_ms) * 1_000_000.0))
        if lease.latest_clock_sync_offset_ns is not None and not self.timing_report_is_stale(
            lease,
            now_server_ns=now_server_ns,
        ):
            return (remote_timestamp_ns + int(lease.latest_clock_sync_offset_ns), False)
        mapped_server_ns, sync_stale = lease.timing_mapping.map_to_server_time(
            remote_timestamp_ns,
            now_server_ns=now_server_ns,
        )
        if mapped_server_ns is None:
            return (None, True)
        if sync_stale or self.timing_report_is_stale(lease, now_server_ns=now_server_ns):
            return (mapped_server_ns, True)
        return (mapped_server_ns, False)

    def target_engine_sample_for_mapped_event(
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
        if self.timing_report_is_stale(lease, now_server_ns=now_server_ns):
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

    def target_engine_sample_for_browser_event(
        self,
        *,
        runtime: RuntimeSession,
        lease: BrowserClockControllerLease,
        event_perf_ms: float | None,
        now_server_ns: int,
    ) -> tuple[int, int | None, bool]:
        if event_perf_ms is None:
            return (runtime.worker.render_sample_cursor, None, False)

        mapped_backend_monotonic_ns, sync_stale = self.map_perf_ms_to_server_ns(
            lease,
            event_perf_ms,
            now_server_ns=now_server_ns,
        )
        if mapped_backend_monotonic_ns is None:
            return (runtime.worker.render_sample_cursor, None, True)
        if sync_stale:
            return (runtime.worker.render_sample_cursor, mapped_backend_monotonic_ns, True)

        return (
            self.target_engine_sample_for_mapped_event(
                runtime=runtime,
                lease=lease,
                mapped_backend_monotonic_ns=mapped_backend_monotonic_ns,
                now_server_ns=now_server_ns,
            ),
            mapped_backend_monotonic_ns,
            False,
        )

    def render_telemetry(
        self,
        *,
        lease: BrowserClockControllerLease | None,
        request: BrowserClockRequestRenderRequest,
        server_received_ns: int,
        server_render_start_ns: int,
        server_render_end_ns: int,
    ) -> dict[str, object]:
        mapped_request_server_ns, timing_sync_stale = self.map_perf_ms_to_server_ns(
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
            "clock_sync_rtt_ms": None if lease is None else lease.latest_clock_sync_rtt_ms,
            "websocket_message_wait_ms": websocket_message_wait_ms,
            "render_service_time_ms": max(0.0, (server_render_end_ns - server_render_start_ns) / 1_000_000.0),
            "server_received_monotonic_ns": server_received_ns,
            "server_render_started_monotonic_ns": server_render_start_ns,
            "server_render_completed_monotonic_ns": server_render_end_ns,
            "note_on_to_render_request_ms": note_on_to_render_request_ms,
            "note_on_to_render_complete_ms": note_on_to_render_complete_ms,
        }
