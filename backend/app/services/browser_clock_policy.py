from __future__ import annotations

from dataclasses import dataclass, field
from typing import Awaitable, Callable

from fastapi import HTTPException

from backend.app.engine.midi_scheduler import ClockDomainMapping
from backend.app.models.session import (
    BROWSER_CLOCK_MAX_BLOCKS_PER_REQUEST,
    BROWSER_CLOCK_MAX_QUEUE_WATERMARK_MS,
    BROWSER_CLOCK_MAX_REPORTED_FRAMES,
    BROWSER_CLOCK_MAX_SAMPLE_RATE,
    BrowserClockClaimControllerRequest,
    BrowserClockTimingReportRequest,
)

BROWSER_TIMING_REPORT_INTERVAL_MS = 100

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
    latest_clock_sync_offset_ns: int | None = None
    latest_clock_sync_rtt_ms: float | None = None
    last_timing_report_server_ns: int | None = None
    last_note_on_client_perf_ms: float | None = None
    last_note_on_server_received_ns: int | None = None
    last_note_on_mapped_server_ns: int | None = None
    last_note_on_sync_stale: bool = True
    manual_midi_tokens: float = 0.0
    manual_midi_last_refill_ns: int | None = None


def validate_browser_clock_claim_budget(request: BrowserClockClaimControllerRequest) -> None:
    max_queue_frames = int(
        round(request.audio_context_sample_rate * (BROWSER_CLOCK_MAX_QUEUE_WATERMARK_MS / 1000.0))
    )
    if request.audio_context_sample_rate > BROWSER_CLOCK_MAX_SAMPLE_RATE:
        raise HTTPException(
            status_code=422,
            detail=f"Browser-clock sample rate must be <= {BROWSER_CLOCK_MAX_SAMPLE_RATE}.",
        )
    if request.max_blocks_per_request > BROWSER_CLOCK_MAX_BLOCKS_PER_REQUEST:
        raise HTTPException(
            status_code=422,
            detail=f"Browser-clock max_blocks_per_request must be <= {BROWSER_CLOCK_MAX_BLOCKS_PER_REQUEST}.",
        )
    if request.queue_high_water_frames > max_queue_frames:
        raise HTTPException(
            status_code=422,
            detail=(
                "Browser-clock queue_high_water_frames exceeds the server queue watermark budget "
                f"({max_queue_frames} frames)."
            ),
        )


def validate_browser_clock_timing_budget(
    lease: BrowserClockControllerLease,
    request: BrowserClockTimingReportRequest,
) -> None:
    max_reported_frames = max(
        BROWSER_CLOCK_MAX_REPORTED_FRAMES,
        lease.queue_high_water_frames + (lease.max_blocks_per_request * 2),
    )
    if request.sample_rate > BROWSER_CLOCK_MAX_SAMPLE_RATE:
        raise HTTPException(
            status_code=422,
            detail=f"Browser-clock timing report sample_rate must be <= {BROWSER_CLOCK_MAX_SAMPLE_RATE}.",
        )
    if request.queued_frames > max_reported_frames or request.pending_render_frames > max_reported_frames:
        raise HTTPException(
            status_code=422,
            detail="Browser-clock timing report frame counts exceed the server budget.",
        )


def consume_browser_clock_manual_midi_token(
    lease: BrowserClockControllerLease,
    *,
    now_server_ns: int,
    burst: int,
    rate_per_second: float,
) -> None:
    normalized_burst = max(1, int(burst))
    normalized_rate = max(0.001, float(rate_per_second))
    if lease.manual_midi_last_refill_ns is None:
        lease.manual_midi_tokens = float(normalized_burst)
        lease.manual_midi_last_refill_ns = now_server_ns
    else:
        elapsed_seconds = max(0.0, (now_server_ns - lease.manual_midi_last_refill_ns) / 1_000_000_000.0)
        lease.manual_midi_tokens = min(
            float(normalized_burst),
            lease.manual_midi_tokens + (elapsed_seconds * normalized_rate),
        )
        lease.manual_midi_last_refill_ns = now_server_ns

    if lease.manual_midi_tokens < 1.0:
        raise HTTPException(status_code=429, detail="Browser-clock manual MIDI rate limit exceeded.")
    lease.manual_midi_tokens -= 1.0


def browser_clock_manual_midi_max_future_samples(*, sample_rate: int, max_future_ms: float) -> int:
    normalized_sample_rate = max(1, int(sample_rate))
    return max(1, int(round(normalized_sample_rate * (max_future_ms / 1000.0))))


def validate_browser_clock_manual_midi_horizon(
    *,
    current_sample: int,
    target_engine_sample: int,
    max_future_samples: int,
) -> None:
    normalized_current_sample = max(0, int(current_sample))
    if int(target_engine_sample) > normalized_current_sample + max(1, int(max_future_samples)):
        raise HTTPException(status_code=422, detail="Browser-clock manual MIDI event is too far in the future.")
