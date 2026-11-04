"""Bounded preparation, serialization and render measurements; no timing assertions.

Run: .venv/bin/python -m backend.tools.benchmark_clip_transposition
Use --identity in both this checkout and an isolated baseline checkout for comparison.
"""

import argparse
import json
import pickle
import platform
import statistics
import time

from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config, _cached_note_pad
from backend.app.services.score_sequencer import prepare_pad
from backend.tools.benchmark_score_sequencer import measure_render
from backend.tools.benchmark_sequencer_preparation import fixture_request


def summary(samples):
    ordered = sorted(samples)
    return dict(
        median_ms=round(statistics.median(samples), 4),
        p95_ms=round(ordered[int(0.95 * (len(ordered) - 1))], 4),
        max_ms=round(max(samples), 4),
    )


def transposed_request(dense=False):
    duration = 16 * 20160
    pairs = 20 if dense else 21
    entries = [dict(index=i, offset=dict(diatonicSteps=i % pairs, chromaticSemitones=0)) for i in range(4096)]
    schedule = dict(
        version=2,
        end=20160000000,
        transpose_plans=[dict(base=dict(diatonicSteps=0, chromaticSemitones=12), repetitions=entries)],
        clips=[
            dict(
                id="loop",
                start=0,
                length=20160000000,
                offset=0,
                mode="loop",
                content=[dict(pad=0, length=duration, transpose_refs=[0])],
            )
        ],
    )
    track = dict(
        track_id="score",
        length_beats=16,
        pad_loop_enabled=True,
        clip_schedule=schedule,
        pads=[
            dict(
                pad_index=0,
                length_beats=16,
                scale_root="C",
                mode="ionian",
                notes=[
                    dict(
                        id=str(i),
                        pitch=36 + i % 48,
                        velocity=96,
                        start_ticks=i * (duration - 20160) // (10000 if dense else 128),
                        duration_ticks=20160,
                    )
                    for i in range(10000 if dense else 128)
                ],
            )
        ],
    )
    return SessionSequencerConfigRequest.model_validate(dict(playback_end_step=8000000, score_tracks=[track]))


def measure(request):
    result = {}
    try:
        from backend.app.services import clip_transposition as transpose
    except ImportError:
        transpose = None
    for mode in ("cold", "cached", "one_entry"):
        samples = []
        for i in range(8):
            current = request.model_copy(deep=True)
            if mode == "cold":
                _cached_note_pad.cache_clear()
                prepare_pad.cache_clear()
                if transpose:
                    transpose._cache.clear()
                    transpose._cache_bytes = transpose._cache_records = 0
            if mode == "one_entry" and current.score_tracks and current.score_tracks[0].clip_schedule:
                plan = current.score_tracks[0].clip_schedule.transpose_plans[0]
                entries = list(plan.repetitions)
                entries[0] = entries[0].model_copy(
                    update={"offset": entries[0].offset.model_copy(update={"diatonic_steps": i + 1})}
                )
                current.score_tracks[0].clip_schedule.transpose_plans[0] = plan.model_copy(
                    update={"repetitions": tuple(entries)}
                )
            start = time.perf_counter()
            compiled = compile_sequencer_runtime_config(current, controller_default_channels=(1,))
            elapsed = (time.perf_counter() - start) * 1000
            if i:
                samples.append(elapsed)
        result[mode] = summary(samples)
    start = time.perf_counter()
    encoded = pickle.dumps(compiled)
    result["serialization_ms"] = round((time.perf_counter() - start) * 1000, 4)
    result["serialized_bytes"] = len(encoded)
    if transpose:
        result["retained_bytes"] = transpose.retained_size(compiled)
    result["render"] = measure_render(request, compiled)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity", action="store_true")
    args = parser.parse_args()
    cases = {"identity_tb303": fixture_request()}
    if not args.identity:
        cases.update(sparse_long_loop=transposed_request(), dense_200000_records=transposed_request(True))
    print(
        json.dumps(
            dict(
                platform=platform.platform(),
                preparation_samples=7,
                render_samples=1000,
                results={name: measure(request) for name, request in cases.items()},
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
