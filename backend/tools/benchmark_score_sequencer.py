"""Long-score preparation and bounded rendering, using versioned fixtures only.

Run: .venv/bin/python -m backend.tools.benchmark_score_sequencer
Reports measurements, not machine-dependent pass/fail thresholds.
"""
from __future__ import annotations

import asyncio
import copy
import json
import platform
import statistics
import time

from backend.app.models.session import SessionScoreSequencerTrackConfig
from backend.app.services.score_sequencer import prepare_pad
from backend.app.services.sequencer_preparation import SequencerPreparationService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.tools.benchmark_browser_clock_render import _NoopMidi
from backend.tools.benchmark_sequencer_preparation import fixture_request


def request_for(minutes, count):
    request = fixture_request()
    beats = minutes * 120
    request.timing.tempo_bpm = 120
    request.playback_end_step = beats * 8
    request.playback_loop = False
    request.score_tracks = [SessionScoreSequencerTrackConfig(track_id="benchmark-score", length_beats=beats,
        pads=[dict(pad_index=0, length_beats=beats, notes=[dict(id=str(i), pitch=36 + i % 72,
            velocity=90, start_ticks=i * (beats - 1) * 20160 // count, duration_ticks=20160)
            for i in range(count)])])]
    return request


def measure_preparation(request):
    result = {}
    for mode in ("cold", "cached", "one_pad_edit"):
        samples = []
        for i in range(7):
            current = request.model_copy(deep=True)
            if mode == "cold":
                prepare_pad.cache_clear()
            if mode == "one_pad_edit":
                current.score_tracks[0].pads[0].notes[0].duration_ticks += i + 1
            started = time.perf_counter()
            compile_sequencer_runtime_config(current, controller_default_channels=(1,))
            samples.append((time.perf_counter() - started) * 1000)
        result[mode] = summary(samples)
    return result


def summary(samples):
    return {"median_ms": round(statistics.median(samples), 4), "max_ms": round(max(samples), 4)}


def measure_render(request, prepared):
    result = {}
    for label, step in (("start", 0), ("near_end", request.playback_end_step - 32)):
        runtime = SessionSequencerRuntime("score-benchmark", _NoopMidi(), "internal:loopback", (1,),
            lambda *_: None, clock_mode="render_driven")
        runtime.apply_prepared(copy.deepcopy(prepared))
        runtime.start(position_step=step)
        samples = []
        for block in range(1000):
            started = time.perf_counter()
            runtime.advance_render_block(sample_rate=48000, ksmps=64, block_start_sample=block * 64)
            samples.append((time.perf_counter() - started) * 1000)
        result[label] = {**summary(samples), "p99_ms": round(sorted(samples)[989], 4),
                         "block_budget_ms": round(64 / 48, 4)}
        runtime.stop()
    return result


async def main():
    compiler = SequencerPreparationService()
    await compiler.start()
    results = []
    try:
        for minutes in (5, 10):
            for count in (128, 10000):
                request = request_for(minutes, count)
                preparation = await asyncio.get_running_loop().run_in_executor(
                    compiler._executor(), measure_preparation, request)
                started = time.perf_counter()
                prepared = await compiler.prepare(request, (1,))
                round_trip = (time.perf_counter() - started) * 1000
                results.append(dict(minutes=minutes, notes=count, existing_tracks=len(request.tracks),
                    controllers=len(request.controller_tracks), arpeggiators=len(request.arpeggiators),
                    preparation=preparation, cached_process_round_trip_ms=round(round_trip, 3),
                    render=measure_render(request, prepared)))
        print(json.dumps({"machine": platform.platform(), "scores": results}, indent=2))
    finally:
        await compiler.close()


if __name__ == "__main__":
    asyncio.run(main())
