from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.models.session import (
    BROWSER_CLOCK_MAX_REPORTED_FRAMES,
    BROWSER_CLOCK_MAX_SAMPLE_RATE,
    BrowserClockClaimControllerRequest,
    BrowserClockTimingReportRequest,
)
from backend.app.services.browser_clock_policy import (
    BrowserClockControllerLease,
    browser_clock_manual_midi_max_future_samples,
    consume_browser_clock_manual_midi_token,
    validate_browser_clock_claim_budget,
    validate_browser_clock_manual_midi_horizon,
    validate_browser_clock_timing_budget,
)


async def _send_json(_payload: dict[str, object]) -> None:
    return None


async def _close(_code: int, _reason: str) -> None:
    return None


def _lease() -> BrowserClockControllerLease:
    return BrowserClockControllerLease(
        connection_id="controller-1",
        sample_rate=48_000,
        queue_low_water_frames=1_024,
        queue_high_water_frames=4_096,
        max_blocks_per_request=64,
        send_json=_send_json,
        close=_close,
    )


def test_manual_midi_rate_limit_refills_tokens_over_time() -> None:
    lease = _lease()
    start_ns = 1_000_000_000

    consume_browser_clock_manual_midi_token(lease, now_server_ns=start_ns, burst=2, rate_per_second=1.0)
    consume_browser_clock_manual_midi_token(lease, now_server_ns=start_ns, burst=2, rate_per_second=1.0)

    with pytest.raises(HTTPException) as exc_info:
        consume_browser_clock_manual_midi_token(lease, now_server_ns=start_ns, burst=2, rate_per_second=1.0)
    assert exc_info.value.status_code == 429

    consume_browser_clock_manual_midi_token(
        lease,
        now_server_ns=start_ns + 1_000_000_000,
        burst=2,
        rate_per_second=1.0,
    )
    assert lease.manual_midi_tokens == pytest.approx(0.0)


def test_manual_midi_horizon_accepts_boundary_and_rejects_later_sample() -> None:
    max_future_samples = browser_clock_manual_midi_max_future_samples(sample_rate=48_000, max_future_ms=10.0)
    assert max_future_samples == 480

    validate_browser_clock_manual_midi_horizon(
        current_sample=1_000,
        target_engine_sample=1_480,
        max_future_samples=max_future_samples,
    )
    with pytest.raises(HTTPException) as exc_info:
        validate_browser_clock_manual_midi_horizon(
            current_sample=1_000,
            target_engine_sample=1_481,
            max_future_samples=max_future_samples,
        )
    assert exc_info.value.status_code == 422


def test_claim_budget_rejects_sample_rate_above_server_limit() -> None:
    request = BrowserClockClaimControllerRequest.model_construct(
        type="claim_controller",
        audio_context_sample_rate=BROWSER_CLOCK_MAX_SAMPLE_RATE + 1,
        queue_low_water_frames=1_024,
        queue_high_water_frames=4_096,
        max_blocks_per_request=64,
    )

    with pytest.raises(HTTPException) as exc_info:
        validate_browser_clock_claim_budget(request)
    assert exc_info.value.status_code == 422


def test_timing_budget_rejects_reported_frames_above_server_limit() -> None:
    request = BrowserClockTimingReportRequest.model_construct(
        type="timing_report",
        client_perf_ms=100.0,
        audio_context_time_s=1.0,
        queued_frames=BROWSER_CLOCK_MAX_REPORTED_FRAMES + 1,
        sample_rate=48_000,
        pending_render_frames=0,
        underrun_count=0,
    )

    with pytest.raises(HTTPException) as exc_info:
        validate_browser_clock_timing_budget(_lease(), request)
    assert exc_info.value.status_code == 422
