"""Measure render-driven sequencer work around simultaneous pad boundaries.

Run locally with:

    uv run python -m backend.tools.benchmark_sequencer_boundary

Run in the container after `docker compose up -d --build` with:

    docker compose exec orchestron .venv/bin/python -m backend.tools.benchmark_sequencer_boundary

The benchmark intentionally uses two musically identical pads and a no-op MIDI output.
It therefore measures transport/status/event work at the boundary rather than a change
in note density or Csound DSP cost.
"""

from __future__ import annotations

import statistics
import time

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime import SessionSequencerRuntime


class _NoopMidiService:
    output_name = "benchmark"

    def send_scheduled_message(
        self,
        _selector: str,
        _message: list[int],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        del delivery_delay_seconds
        return self.output_name

    def send_scheduled_messages(
        self,
        _selector: str,
        _messages: list[list[int]],
        *,
        delivery_delay_seconds: float | None,
    ) -> str:
        del delivery_delay_seconds
        return self.output_name


def _runtime(track_count: int) -> SessionSequencerRuntime:
    runtime = SessionSequencerRuntime(
        session_id=f"benchmark-{track_count}",
        midi_service=_NoopMidiService(),
        midi_input_selector="internal:loopback",
        controller_default_channels=(1,),
        clock_mode="render_driven",
        publish_event=lambda _event_type, _payload: None,
    )
    runtime.configure(
        SessionSequencerConfigRequest.model_validate(
            {
                "timing": {"tempo_bpm": 120, "steps_per_beat": 4},
                "step_count": 16,
                "playback_end_step": 16,
                "tracks": [
                    {
                        "track_id": f"track-{index}",
                        "midi_channel": (index % 16) + 1,
                        "length_beats": 1,
                        "active_pad": 0,
                        "enabled": True,
                        "pad_loop_enabled": True,
                        "pad_loop_sequence": [0, 1],
                        "pads": [
                            {"pad_index": 0, "length_beats": 1, "steps": [60]},
                            {"pad_index": 1, "length_beats": 1, "steps": [60]},
                        ],
                    }
                    for index in range(track_count)
                ],
            }
        )
    )
    runtime.start(position_step=0)
    return runtime


def _measure(track_count: int, iterations: int) -> tuple[float, float, float]:
    steady_samples_ms: list[float] = []
    boundary_samples_ms: list[float] = []
    for _ in range(iterations):
        runtime = _runtime(track_count)
        # At 120 BPM a 32-sample k-block at 48 kHz advances 4.48 transport
        # subunits. Exactly 750 k-blocks reach the one-beat pad boundary.
        for block_index in range(750):
            started_ns = time.perf_counter_ns()
            runtime.advance_render_block(sample_rate=48_000, ksmps=32)
            elapsed_ms = (time.perf_counter_ns() - started_ns) / 1_000_000.0
            if block_index == 749:
                boundary_samples_ms.append(elapsed_ms)
            elif block_index == 250:
                steady_samples_ms.append(elapsed_ms)

    return (
        statistics.median(steady_samples_ms),
        statistics.median(boundary_samples_ms),
        max(boundary_samples_ms),
    )


def main() -> None:
    print("tracks,steady_median_ms,boundary_median_ms,boundary_max_ms")
    for track_count in (16, 64, 128):
        steady_median_ms, boundary_median_ms, boundary_max_ms = _measure(track_count, iterations=10)
        print(
            f"{track_count},{steady_median_ms:.3f},{boundary_median_ms:.3f},{boundary_max_ms:.3f}"
        )


if __name__ == "__main__":
    main()
