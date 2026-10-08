"""Isolated worker for benchmark_cython_playback; uses versioned fixtures only."""
# The selected checkout must precede application imports in this fresh worker.
# ruff: noqa: E402

from __future__ import annotations
import cProfile
from dataclasses import asdict
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import platform
import pstats
import statistics
import sys
import tempfile
import time

SOURCE = Path(os.environ["EVAL_SOURCE"]).resolve()
sys.path.insert(0, str(SOURCE))
import numpy as np
import backend.app.services.sequencer_runtime as runtime_module

assert Path(runtime_module.__file__).resolve().is_relative_to(SOURCE)
from backend.app.engine.csound_worker import CsoundWorker
from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.sequencer_preparation import _prepare
from backend.tools.benchmark_browser_clock_render import _sequencer
from backend.tools.benchmark_sequencer_boundary import _runtime

OUT = Path(os.environ["EVAL_OUTPUT"])
SUITE = os.environ["EVAL_SUITE"]
MODE = os.environ.get("EVAL_MODE", "timing")
ITERATIONS = int(os.environ["EVAL_ITERATIONS"])
WARMUP = int(os.environ["EVAL_WARMUP"])
ARM = os.environ["EVAL_ARM"]
if ARM == "baseline":
    implementation = "baseline"
else:
    from backend.app.services.sequencer_playback import implementation

    assert implementation == ARM, (implementation, ARM)
RESULT = {
    "source": str(SOURCE),
    "suite": SUITE,
    "mode": MODE,
    "platform": platform.platform(),
    "python": sys.version,
    "implementation": implementation,
    "iterations": ITERATIONS,
    "warmup": WARMUP,
    "versions": {n: importlib.metadata.version(n) for n in ("numpy", "pydantic", "fastapi")},
    "metrics": {},
    "profiles": {},
}
os.environ["VISUALCSOUND_AUDIO_OUTPUT_MODE"] = "browser_clock"
os.environ["VISUALCSOUND_CSOUND_PERFORMANCE_LOGGING"] = "false"


EMPTY = """<CsoundSynthesizer>
<CsOptions>
</CsOptions>
<CsInstruments>
sr = 48000
ksmps = 32
nchnls = 2
0dbfs = 1
instr 1
endin
</CsInstruments>
<CsScore>
f 0 600
</CsScore>
</CsoundSynthesizer>"""


def save():
    OUT.write_text(json.dumps(RESULT, indent=2))


def record(name, samples, unit="ms"):
    ordered = sorted(samples)
    RESULT["metrics"][name] = {
        "unit": unit,
        "samples": samples,
        "median": statistics.median(samples),
        "p95": ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))],
        "p99": ordered[min(len(ordered) - 1, int(0.99 * len(ordered)))],
        "max": max(samples),
    }


def profile(name, action):
    profiler = cProfile.Profile()
    profiler.runcall(action)
    path = OUT.with_name(OUT.stem + "_" + name + ".prof")
    profiler.dump_stats(str(path))
    stream = io.StringIO()
    stats = pstats.Stats(profiler, stream=stream)
    stats.sort_stats("cumulative").print_stats(35)
    stats.sort_stats("tottime").print_stats(35)
    path.with_suffix(".txt").write_text(stream.getvalue())
    RESULT["profiles"][name] = {"file": str(path), "calls": stats.total_calls, "seconds": stats.total_tt}


def fixture(name="tb303"):
    filename = "tb303_madness.runtime.json" if name == "tb303" else "arpeggiator_patterns.runtime.json"
    return SessionSequencerConfigRequest.model_validate_json(
        (SOURCE / "backend/tests/fixtures/performances" / filename).read_text()
    )


def render(kind, tracks, count):
    native = kind != "mock"
    os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false" if native else "true"
    worker = CsoundWorker()
    if native and worker.backend != "ctcsound":
        raise RuntimeError("Native Csound unavailable")
    worker.start(csd=EMPTY, midi_input="internal:loopback", rtmidi_module="null")
    RESULT["binding"] = type(worker._csound).__name__ if native else "mock"
    samples = []
    cpus = []
    try:
        worker.render_blocks(block_count=750, target_sample_rate=48000)
        for index in range(WARMUP + count):
            runtime = _sequencer(tracks) if tracks else None

            def callback(_, sample):
                if runtime:
                    runtime.advance_render_block(sample_rate=48000, ksmps=32, block_start_sample=sample)

            def action():
                return worker.render_blocks(block_count=750, target_sample_rate=48000, before_block=callback)

            if MODE == "profile" and index == WARMUP:
                profile(f"render_{kind}_{tracks}", action)
            started, cpu = time.perf_counter_ns(), time.process_time_ns()
            result = action()
            elapsed = (time.perf_counter_ns() - started) / 1e6
            used = (time.process_time_ns() - cpu) / 1e6
            assert result.target_frame_count == 24000
            if index >= WARMUP:
                samples.append(elapsed)
                cpus.append(used)
        RESULT.setdefault("pcm_hashes", {})[f"{kind}_{tracks}"] = hashlib.sha256(result.pcm_f32le).hexdigest()
        record(f"render_{kind}_{tracks}", samples)
        record(f"render_cpu_{kind}_{tracks}", cpus)
    finally:
        worker.stop()


def boundary(tracks, count):
    whole = []
    switch = []
    ordinary = []
    cpu = []
    for index in range(WARMUP + count):
        runtime = _runtime(tracks)
        start, c = time.perf_counter_ns(), time.process_time_ns()
        for block in range(750):
            before = time.perf_counter_ns()
            runtime.advance_render_block(sample_rate=48000, ksmps=32)
            elapsed = (time.perf_counter_ns() - before) / 1e6
            if index >= WARMUP:
                (switch if block == 749 else ordinary).append(elapsed)
        if index >= WARMUP:
            whole.append((time.perf_counter_ns() - start) / 1e6)
            cpu.append((time.process_time_ns() - c) / 1e6)
    record(f"boundary_window_{tracks}", whole)
    record(f"boundary_cpu_{tracks}", cpu)
    record(f"pad_switch_{tracks}", switch)
    record(f"nonboundary_{tracks}", ordinary)
    if MODE == "profile":

        def all_blocks():
            for _ in range(750):
                runtime.advance_render_block(sample_rate=48000, ksmps=32)

        runtime = _runtime(tracks)
        profile(f"boundary_all_{tracks}", all_blocks)
        runtime = _runtime(tracks)
        for _ in range(749):
            runtime.advance_render_block(sample_rate=48000, ksmps=32)
        profile(f"pad_switch_{tracks}", lambda: runtime.advance_render_block(sample_rate=48000, ksmps=32))


def fingerprints():
    from backend.tests.test_sequencer_note_timing import make_runtime, advance, notes

    cases = {}
    for offset in (-50, 0, 37, 50):
        for ratio in ((1, 1), (3, 2), (4, 3)):
            r, capture, _ = make_runtime(
                [{"note": [60, 64], "timing_offset_percent": offset, "ratchets": 3}, {"hold": True}, 67, None],
                timing={"steps_per_beat": 4, "beat_rate_numerator": ratio[0], "beat_rate_denominator": ratio[1]},
            )
            advance(r, capture, 15000)
            events = [
                asdict(event)
                for event in r.drain_render_transport_events(engine_sample_start=0, engine_sample_end=15000)
            ]
            cases[f"{offset}/{ratio}"] = {"notes": notes(capture), "events": events, "status": r.status().model_dump()}
    for name in ("tb303", "arp"):
        cases[name] = asdict(_prepare(fixture(name), (1, 2)))
    raw = json.dumps(cases, sort_keys=True, default=sorted).encode()
    RESULT["fingerprint"] = hashlib.sha256(raw).hexdigest()
    RESULT["fingerprint_bytes"] = len(raw)
    RESULT["source_sha256"] = {
        path: hashlib.sha256((SOURCE / path).read_bytes()).hexdigest()
        for path in (
            "backend/app/services/sequencer_runtime.py",
            "backend/app/services/sequencer_runtime_config.py",
            "backend/app/models/controller_curve.py",
            "backend/app/engine/ctcsound_loader.py",
            "backend/app/services/sequencer_preparation.py",
        )
    }


def dense_request(kind, tracks):
    return SessionSequencerConfigRequest.model_validate(
        {
            "timing": {"tempo_bpm": 150},
            "playback_end_step": 1000000,
            "tracks": [
                {
                    "track_id": f"n{i}",
                    "midi_channel": 1,
                    "length_beats": 2,
                    "timing": {
                        "steps_per_beat": 4,
                        "beat_rate_numerator": (3 if i % 3 == 0 else 1),
                        "beat_rate_denominator": (2 if i % 3 == 0 else 1),
                    },
                    "pads": [
                        {
                            "pad_index": p,
                            "length_beats": 2,
                            "steps": [
                                {
                                    "note": 48 + (i + step + p) % 24,
                                    "velocity": 90,
                                    "ratchets": 4 if kind == "ratchet" else 1,
                                    "ratchet_end_velocity": 30 if kind == "ratchet" else None,
                                    "timing_offset_percent": [-50, -25, 0, 25, 50][(i + step) % 5],
                                }
                                if step % 3 != 1
                                else {"hold": True}
                                for step in range(8)
                            ],
                        }
                        for p in (0, 1)
                    ],
                    "pad_loop_enabled": True,
                    "pad_loop_sequence": [0, 1],
                }
                for i in range(tracks)
            ],
        }
    )


class DenseMidi:
    output_name = "benchmark"

    def __init__(self, capture=False):
        self.capture = capture
        self.events = []
        self.sample = 0

    def send_scheduled_messages(self, _selector, messages, *, delivery_delay_seconds=None):
        if self.capture:
            self.events.extend((self.sample + round((delivery_delay_seconds or 0) * 48000), tuple(m)) for m in messages)
        return self.output_name

    def send_scheduled_message(self, selector, message, *, delivery_delay_seconds=None):
        return self.send_scheduled_messages(selector, [message], delivery_delay_seconds=delivery_delay_seconds)


def dense_runtime(kind, tracks, capture=False):
    midi = DenseMidi(capture)
    runtime = runtime_module.SessionSequencerRuntime(
        "dense", midi, "internal:loopback", (1,), lambda *_: None, clock_mode="render_driven"
    )
    request = dense_request(kind, tracks)
    runtime.configure(request)
    runtime.start(position_step=0)
    return runtime, midi, request


def dense_suite(count):
    for kind, tracks in [("offset", 64), ("ratchet", 64), ("ratchet", 128)]:
        chunks = []
        totals = []
        cpus = []
        for iteration in range(WARMUP + count):
            runtime, midi, _ = dense_runtime(kind, tracks)
            started = time.perf_counter_ns()
            cpu = time.process_time_ns()
            for chunk in range(48):
                begin = time.perf_counter_ns()
                for block in range(16):
                    at = (chunk * 16 + block) * 32
                    runtime.advance_render_block(sample_rate=48000, ksmps=32, block_start_sample=at)
                elapsed = (time.perf_counter_ns() - begin) / 1e6
                if iteration >= WARMUP:
                    chunks.append(elapsed)
            if iteration >= WARMUP:
                totals.append((time.perf_counter_ns() - started) / 1e6)
                cpus.append((time.process_time_ns() - cpu) / 1e6)
        record(f"dense_{kind}_{tracks}_512ms", totals)
        record(f"dense_cpu_{kind}_{tracks}_512ms", cpus)
        record(f"dense_{kind}_{tracks}_chunk_10.667ms", chunks)
        RESULT.setdefault("deadlines", {})[f"dense_{kind}_{tracks}"] = {
            "budget_ms": 16 * 32 / 48,
            "samples": len(chunks),
            "over_budget": sum(t > 16 * 32 / 48 for t in chunks),
        }
        if MODE == "profile":
            runtime, _, _ = dense_runtime(kind, tracks)
            profile(
                f"dense_{kind}_{tracks}",
                lambda: [runtime.advance_render_block(sample_rate=48000, ksmps=32) for _ in range(768)],
            )
        save()


def dense_fingerprints():
    scenarios = {}
    for kind in ("offset", "ratchet"):
        runtime, midi, request = dense_runtime(kind, 12, True)
        history = []
        for i in range(1600):
            midi.sample = i * 32
            if i == 211:
                request.tracks[0].pads[0].steps[0].timing_offset_percent = 37
                runtime.configure(request)
            if i == 499:
                runtime.queue_pad("n1", 1)
            if i == 701:
                request.tracks[0].enabled = False
                runtime.configure(request)
            runtime.advance_render_block(sample_rate=48000, ksmps=32, block_start_sample=midi.sample)
            history.extend(
                asdict(e)
                for e in runtime.drain_render_transport_events(
                    engine_sample_start=midi.sample, engine_sample_end=midi.sample + 32
                )
            )
        scenarios[kind] = {"midi": midi.events, "markers": history, "status": runtime.status().model_dump()}
    raw = json.dumps(scenarios, sort_keys=True).encode()
    RESULT["dense_fingerprint"] = hashlib.sha256(raw).hexdigest()
    RESULT["dense_event_count"] = sum(len(x["midi"]) for x in scenarios.values())


def live_suite():
    import logging

    logging.disable(logging.CRITICAL)
    from backend.tests.api_test_support import _client, _BrowserClockRenderDriver

    class CapturingDriver(_BrowserClockRenderDriver):
        def pump_once(self, *, block_count=None):
            with self._lock:
                self._send_timing_report()
                self._websocket.send_json({"type": "request_render", "block_count": block_count or self._block_count})
                metadata = self._websocket.receive_json()
                assert metadata["type"] == "render_chunk", metadata
                self.pcm = self._websocket.receive_bytes()
                return metadata

    with tempfile.TemporaryDirectory() as tmp, _client(Path(tmp)) as client:
        os.environ["VISUALCSOUND_FORCE_MOCK_ENGINE"] = "false"
        patch = json.loads((SOURCE / "backend/tests/fixtures/patches/midi_legato.patch.json").read_text())
        patch = {
            key: patch[key]
            for key in ("name", "description", "is_template", "always_on", "instrument_type", "schema_version", "graph")
        }
        patch["graph"]["engine_config"].update(ksmps=32, control_rate=1500)
        response = client.post("/api/patches", json=patch)
        assert response.status_code == 201, response.text
        response = client.post("/api/sessions", json={"patch_id": response.json()["id"]})
        assert response.status_code == 201, response.text
        sid = response.json()["session_id"]
        response = client.post(f"/api/sessions/{sid}/compile")
        assert response.status_code == 200, response.text
        session = client.app.state.container.session_service._sessions[sid]
        config_request = dense_request("ratchet", 64)
        response = client.put(f"/api/sessions/{sid}/sequencer/config", json=config_request.model_dump())
        assert response.status_code == 200, response.text
        windows = []
        all_chunks = []
        render_service = []
        timeline = []
        pcm = hashlib.sha256()
        peak = 0.0
        with CapturingDriver(client, sid, block_count=16) as driver:
            assert session.worker.backend == "ctcsound"
            RESULT["binding"] = type(session.worker._csound).__name__
            response = client.post(f"/api/sessions/{sid}/sequencer/start", json={"position_step": 0})
            assert response.status_code == 200, response.text
            driver.pump_for(0.5)
            for window in range(5 if MODE == "timing" else 1):
                begin = time.perf_counter_ns()
                for chunk in range(375):  # Four seconds of actual audio; no sleeping.
                    before = time.perf_counter_ns()
                    meta = driver.pump_once()
                    all_chunks.append((time.perf_counter_ns() - before) / 1e6)
                    render_service.append(meta["telemetry"]["render_service_time_ms"])
                    timeline.append((meta["timeline_segments"], meta["transport_events"]))
                    pcm.update(driver.pcm)
                    peak = max(peak, float(np.max(np.abs(np.frombuffer(driver.pcm, dtype=np.float32)[::2]))))
                windows.append((time.perf_counter_ns() - begin) / 1e6)
        assert peak > 0.00001, peak
        record("live_ratchet_64_4s", windows)
        record("live_chunk_10.667ms", all_chunks)
        record("live_render_service", render_service)
        RESULT["live_pcm_hash"] = pcm.hexdigest()
        RESULT["live_timeline_hash"] = hashlib.sha256(json.dumps(timeline, sort_keys=True).encode()).hexdigest()
        RESULT["pcm_peak_left"] = peak
        RESULT["deadlines"] = {
            "live": {
                "budget_ms": 16 * 32 / 48,
                "samples": len(all_chunks),
                "over_budget": sum(t > 16 * 32 / 48 for t in all_chunks),
            }
        }


def main():
    count = ITERATIONS if MODE == "timing" else 1
    if MODE == "fingerprint":
        fingerprints()
        dense_fingerprints()
    elif SUITE == "runtime":
        for tracks in (16, 64, 128):
            render("mock", tracks, count)
            boundary(tracks, count)
        render("native", 128, count)
    elif SUITE == "dense":
        dense_suite(count)
    elif SUITE == "live":
        live_suite()
    else:
        raise ValueError(SUITE)
    RESULT["complete"] = True
    save()


if __name__ == "__main__":
    main()
