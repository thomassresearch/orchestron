"""Report controller and complete preparation costs; no timing-sensitive assertions.

Run: .venv/bin/python -m backend.tools.benchmark_sequencer_preparation
The versioned TB303 fixture requires neither a database nor examples/.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import platform
import statistics
import time

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_preparation import SequencerPreparationService
from backend.app.services.sequencer_runtime_config import _compiled_controller_pad, compile_sequencer_runtime_config


def fixture_request() -> SessionSequencerConfigRequest:
    return SessionSequencerConfigRequest.model_validate_json(
        (Path(__file__).parents[1] / "tests/fixtures/performances/tb303_madness.runtime.json").read_text()
    )


def controller_measurements(request: SessionSequencerConfigRequest) -> dict:
    request = request.model_copy(update={"tracks": [], "arpeggiators": []})
    result = {}
    for mode in ("cold", "unchanged", "one_pad_edit"):
        samples = []
        for iteration in range(7):
            if mode == "cold":
                _compiled_controller_pad.cache_clear()
            current = request.model_copy(deep=True)
            if mode == "one_pad_edit":
                pad = next(pad for track in current.controller_tracks for pad in track.pads if len(pad.keypoints) > 2)
                pad.keypoints[1].position += (iteration + 1) * 0.0001
            started = time.perf_counter()
            compile_sequencer_runtime_config(current, controller_default_channels=(1,))
            samples.append((time.perf_counter() - started) * 1000)
        result[mode] = {"median_ms": round(statistics.median(samples), 3), "max_ms": round(max(samples), 3)}
    return result


async def main() -> None:
    request = fixture_request()
    compiler = SequencerPreparationService()
    await compiler.start()
    try:
        # Measurements and cache both live in the persistent spawned compiler.
        curves = await asyncio.get_running_loop().run_in_executor(compiler._executor(), controller_measurements, request)
        complete = {}
        for mode in ("cold", "unchanged", "one_pad_edit"):
            if mode == "one_pad_edit":
                pad = next(pad for track in request.controller_tracks for pad in track.pads if len(pad.keypoints) > 2)
                pad.keypoints[1].position += 0.0009
            if mode == "cold":
                await asyncio.get_running_loop().run_in_executor(compiler._executor(), clear_cache)
            started = time.perf_counter()
            await compiler.prepare(request, (1,))
            complete[mode] = round((time.perf_counter() - started) * 1000, 3)
        print(json.dumps({"machine": platform.platform(), "controllers": curves,
                          "complete_process_round_trip_ms": complete}, indent=2))
    finally:
        await compiler.close()


def clear_cache() -> None:
    _compiled_controller_pad.cache_clear()


if __name__ == "__main__":
    asyncio.run(main())
