"""Measure browser-clock render headroom with render-driven sequencers.

Run with:

    uv run python -m backend.tools.benchmark_browser_clock_render
"""

from __future__ import annotations

import os
import statistics
import time

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime import SessionSequencerRuntime


class _NoopMidi:
    output_name = "benchmark"

    def send_scheduled_message(self, _selector, _message, *, delivery_delay_seconds=None):
        del delivery_delay_seconds
        return self.output_name

    def send_scheduled_messages(self, _selector, _messages, *, delivery_delay_seconds=None):
        del delivery_delay_seconds
        return self.output_name


def _sequencer(track_count: int) -> SessionSequencerRuntime:
    sequencer = SessionSequencerRuntime(
        session_id="browser-clock-benchmark",
        midi_service=_NoopMidi(),
        midi_input_selector="internal:loopback",
        controller_default_channels=(1,),
        publish_event=lambda _event_type, _payload: None,
        clock_mode="render_driven",
    )
    sequencer.configure(
        SessionSequencerConfigRequest.model_validate(
            {
                "timing": {"tempo_bpm": 120, "steps_per_beat": 4},
                "step_count": 16,
                "playback_end_step": 1_000_000,
                "tracks": [
                    {
                        "track_id": f"track-{index}",
                        "midi_channel": (index % 16) + 1,
                        "length_beats": 1,
                        "enabled": True,
                        "pads": [{"pad_index": 0, "length_beats": 1, "steps": [60, None, None, None]}],
                    }
                    for index in range(track_count)
                ],
            }
        )
    )
    sequencer.start(position_step=0)
    return sequencer


def _measure(track_count: int, iterations: int = 5) -> tuple[float, float]:
    ratios: list[float] = []
    os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = "browser_clock"
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "true"
    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "</CsOptions>",
            "<CsInstruments>",
            "sr = 48000",
            "ksmps = 32",
            "nchnls = 2",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )
    for _ in range(iterations):
        worker = CsoundWorker()
        worker.start(csd=csd, midi_input="unused", rtmidi_module="null")
        sequencer = _sequencer(track_count)

        def before_block(_index: int, block_start_sample: int) -> None:
            sequencer.advance_render_block(
                sample_rate=48_000,
                ksmps=32,
                block_start_sample=block_start_sample,
            )

        started = time.perf_counter()
        render = worker.render_blocks(
            block_count=750,
            target_sample_rate=48_000,
            before_block=before_block,
        )
        elapsed = time.perf_counter() - started
        audio_seconds = render.target_frame_count / 48_000.0
        ratios.append(elapsed / audio_seconds)
        worker.stop()
    return statistics.median(ratios), max(ratios)


def main() -> None:
    print("tracks,median_render_audio_ratio,max_render_audio_ratio")
    for track_count in (16, 64, 128):
        median_ratio, max_ratio = _measure(track_count)
        print(f"{track_count},{median_ratio:.3f},{max_ratio:.3f}")


if __name__ == "__main__":
    main()
