from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
import threading

import numpy as np
import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.engine.browser_audio_pcm import resample_stereo_block_linear


def test_controls_queued_during_drain_are_applied_at_following_boundary(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    entered, enqueued = threading.Event(), threading.Event()
    observed = []

    class Channels:
        def setControlChannel(self, name, value):
            observed.append((name, value))
            if value == 1:
                entered.set()
                assert enqueued.wait(5)

    def producer():
        assert entered.wait(5)
        worker.queue_control_channels({"gain": 2})
        enqueued.set()

    worker._apply_control_channels(Channels())  # Empty fast path before first write.
    worker.queue_control_channels({"gain": 1})
    with ThreadPoolExecutor(max_workers=1) as threads:
        queued = threads.submit(producer)
        worker._apply_control_channels(Channels())
        queued.result(timeout=5)
    assert observed == [("gain", 1)]
    worker._apply_control_channels(Channels())
    worker._apply_control_channels(Channels())
    assert observed == [("gain", 1), ("gain", 2)]


def test_boundary_actions_enqueued_while_applying_wait_for_next_boundary(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    first, second = Future(), Future()
    worker._apply_boundary_actions()

    def action():
        with worker._boundary_lock:
            worker._boundary_actions.append((lambda: 2, second))
        return 1

    with worker._boundary_lock:
        worker._boundary_actions.append((action, first))
    worker._apply_boundary_actions()
    assert first.result() == 1 and not second.done()
    worker._apply_boundary_actions()
    assert second.result() == 2


def test_empty_midi_period_discards_unconsumed_bytes_and_accepts_next_sample(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    worker._host_midi_buffer.extend([0x90, 60])  # Partial read left over from the previous period.
    worker._prepare_host_midi_block(block_start_sample=10, block_end_sample=11)
    assert not worker._host_midi_buffer
    worker._midi_scheduler.enqueue([0x90, 62, 99], source="manual", target_engine_sample=11)
    worker._prepare_host_midi_block(block_start_sample=10, block_end_sample=11)
    assert not worker._host_midi_buffer
    worker._prepare_host_midi_block(block_start_sample=11, block_end_sample=12)
    assert worker._host_midi_buffer == bytes([0x90, 62, 99])
    worker._prepare_host_midi_block(block_start_sample=12, block_end_sample=13)
    assert not worker._host_midi_buffer


def test_midi_arriving_after_empty_check_is_delivered_at_next_sample(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    worker.start("sr = 48000\nksmps = 1\nnchnls = 2", "unused", "null")
    entered, enqueued = threading.Event(), threading.Event()
    delivered = []

    class Engine:
        def performKsmps(self):
            delivered.append(bytes(worker._host_midi_buffer))
            if len(delivered) == 1:
                entered.set()
                assert enqueued.wait(5)
            return 0

        def spout(self):
            return np.zeros(2)

    def producer():
        assert entered.wait(5)
        assert worker.enqueue_timestamped_midi([0x90, 60, 100], source="manual", target_engine_sample=0)
        enqueued.set()

    worker._backend, worker._csound = "ctcsound", Engine()
    with ThreadPoolExecutor(max_workers=1) as threads:
        queued = threads.submit(producer)
        worker.render_blocks(block_count=3, target_sample_rate=48000)
        queued.result(timeout=5)
    assert delivered == [b"", bytes([0x90, 60, 100]), b""]
    assert worker.render_sample_cursor == 3


def test_native_ksmps_one_midi_audio_onsets_and_controls_are_sample_exact(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "false")
    worker = CsoundWorker()
    if worker.backend != "ctcsound":
        pytest.skip("Native Csound unavailable")
    csd = (Path(__file__).parent / "fixtures/csound/midi_sample_probe.csd").read_text()
    worker.start(csd, "internal:loopback", "null")
    try:
        assert worker.runtime_ksmps == 1
        # Boundaries adjacent to a 512-frame PCM request, and same-sample order.
        for sample, message in [(1, [0x90, 60, 100]), (511, [0x80, 60, 0]),
                                (512, [0xB0, 74, 127]), (512, [0x90, 62, 100]),
                                (513, [0xB0, 74, 0]), (700, [0x80, 62, 0])]:
            assert worker.enqueue_timestamped_midi(message, source="manual", target_engine_sample=sample)
        worker.queue_control_channels({"gain": 1})
        chunks = [worker.render_blocks(block_count=512, target_sample_rate=48000).pcm_f32le for _ in range(2)]
        pcm = np.frombuffer(b"".join(chunks), dtype=np.float32).reshape(-1, 2)
        expected = np.zeros(1024, dtype=np.float32)
        expected[1:511] = .25
        expected[512] = .5
        expected[513:700] = .25
        np.testing.assert_array_equal(pcm[:, 0], expected)
        np.testing.assert_array_equal(pcm[:, 1], -expected)
    finally:
        worker.stop()


def test_stop_waits_for_render_ownership_and_prevents_late_pcm(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    worker.start("sr = 48000\nksmps = 64\nnchnls = 2", "unused", "null")
    entered, release, stopping = threading.Event(), threading.Event(), threading.Event()

    def before_block(_):
        entered.set()
        assert release.wait(5)

    def stop():
        stopping.set()
        return worker.stop()

    with ThreadPoolExecutor(max_workers=2) as threads:
        render = threads.submit(worker.render_blocks, block_count=1, target_sample_rate=48000, before_block=before_block)
        assert entered.wait(5)
        stopping_task = threads.submit(stop)
        assert stopping.wait(5)
        try:
            assert not stopping_task.done()
        finally:
            release.set()
        assert render.result(timeout=5).engine_sample_end == 64
        assert stopping_task.result(timeout=5) == "stopped"
    assert worker.render_sample_cursor == 0
    with pytest.raises(RuntimeError, match="must be running"):
        worker.render_blocks(block_count=1, target_sample_rate=48000)


def test_stop_cleans_up_native_engine_after_perform_failure(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    worker.start("sr = 48000\nksmps = 64\nnchnls = 2", "unused", "null")
    calls = []

    class FailedEngine:
        def performKsmps(self):
            return 1

        def stop(self):
            calls.append("stop")

        def cleanup(self):
            calls.append("cleanup")

        def reset(self):
            calls.append("reset")

    worker._backend = "ctcsound"
    worker._csound = FailedEngine()
    with pytest.raises(RuntimeError, match="performKsmps"):
        worker.render_blocks(block_count=1, target_sample_rate=48000)
    assert not worker.is_running
    assert worker.stop() == "stopped"
    assert calls == ["stop", "cleanup", "reset"]
    assert worker._csound is None


def test_rtmidi_candidates_prefer_requested_and_normalize_quotes(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "darwin")

    candidates = CsoundWorker._rtmidi_candidates("'cmidi'")

    assert candidates[0] == "cmidi"
    assert "portmidi" in candidates
    assert len(candidates) == len(set(candidates))


def test_apply_runtime_midi_options_replaces_csd_midi_flags() -> None:
    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "-d -odac -b 256 -B2048 -M1 -+rtmidi=cmidi -+rtaudio=jack",
            "</CsOptions>",
            "<CsInstruments>",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    sanitized = CsoundWorker._apply_runtime_midi_options(
        csd,
        midi_input="2",
        rtmidi_module="coremidi",
        rtaudio_option="auhal",
    )

    assert "-M1" not in sanitized
    assert "-b 256" in sanitized
    assert "-B2048" in sanitized
    assert "-+rtmidi=cmidi" not in sanitized
    assert "-+rtaudio=jack" not in sanitized
    assert "-b 128" not in sanitized
    assert "-B512" not in sanitized
    assert "-M2" in sanitized
    assert "-+rtmidi=coremidi" in sanitized
    assert "-+rtaudio=auhal" in sanitized
    assert "-odac" in sanitized
    assert "<CsOptions>" in sanitized
    assert "</CsOptions>" in sanitized


def test_headless_runtime_options_disable_realtime_audio_output() -> None:
    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "-d -odac -iadc -M0 -+rtmidi=coremidi -+rtaudio=auhal",
            "</CsOptions>",
            "<CsInstruments>",
            "sr = 44100",
            "nchnls = 2",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    sanitized = CsoundWorker._apply_headless_runtime_options(
        csd,
        midi_input="1",
        rtmidi_module="alsaseq",
    )

    assert "-M1" in sanitized
    assert "-+rtmidi=alsaseq" in sanitized
    assert "-odac" not in sanitized
    assert "-iadc" not in sanitized
    assert "-+rtaudio=auhal" not in sanitized
    assert " -n" in sanitized or sanitized.strip().endswith("-n")


def test_audio_output_mode_maps_streaming_to_browser_clock(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "streaming")
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")

    worker = CsoundWorker()

    assert worker.audio_output_mode == "browser_clock"


def test_audio_output_mode_rejects_local(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "local")

    with pytest.raises(ValueError, match="VISUALCSOUND_AUDIO_OUTPUT_MODE=local is no longer supported"):
        CsoundWorker()


def test_audio_output_mode_rejects_webrtc(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "webrtc")

    with pytest.raises(ValueError, match="VISUALCSOUND_AUDIO_OUTPUT_MODE=webrtc is no longer supported"):
        CsoundWorker()


def test_worker_uses_loaded_ctcsound_module(monkeypatch) -> None:
    sentinel = object()
    monkeypatch.setattr("backend.app.engine.csound_worker.load_ctcsound_module", lambda: sentinel)
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)

    worker = CsoundWorker()

    assert worker.backend == "ctcsound"
    assert worker._ctcsound is sentinel


def test_load_ctcsound_module_falls_back_to_direct_binding_on_macos(monkeypatch) -> None:
    sentinel = object()
    monkeypatch.setattr("backend.app.engine.ctcsound_loader.sys.platform", "darwin")
    monkeypatch.setattr(
        "backend.app.engine.ctcsound_loader._import_stock_ctcsound",
        lambda: (_ for _ in ()).throw(AttributeError("csoundSetOpcodedir missing")),
    )
    monkeypatch.setattr("backend.app.engine.ctcsound_loader._load_direct_ctcsound_module", lambda: sentinel)

    assert load_ctcsound_module() is sentinel


def test_start_ctcsound_falls_back_to_supported_rtmidi_module(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "darwin")
    monkeypatch.setattr(CsoundWorker, "_configure_host_midi_callbacks", lambda self, csound: None)

    class FakeCsound:
        def __init__(self, failing_modules: set[str]) -> None:
            self._failing_modules = failing_modules
            self.selected_module = ""
            self.last_csd = ""
            self.options: list[str] = []

        def setOption(self, option: str) -> None:  # noqa: N802
            self.options.append(option)
            if option.startswith("-+rtmidi="):
                self.selected_module = option.split("=", 1)[1]

        def compileCsdText(self, csd: str) -> int:  # noqa: N802
            self.last_csd = csd
            marker = "-+rtmidi="
            idx = csd.find(marker)
            if idx >= 0:
                tail = csd[idx + len(marker) :]
                self.selected_module = tail.split()[0]
            if self.selected_module in self._failing_modules:
                return 1
            return 0

        def start(self) -> int:
            if self.selected_module in self._failing_modules:
                return 1
            return 0

        def perform(self) -> int:
            return 0

        def stop(self) -> None:
            return None

        def cleanup(self) -> None:
            return None

        def reset(self) -> None:
            return None

    class FakeCtcsound:
        def __init__(self) -> None:
            self.instances: list[FakeCsound] = []

        def Csound(self) -> FakeCsound:  # noqa: N802
            instance = FakeCsound({"coremidi"})
            self.instances.append(instance)
            return instance

    worker = CsoundWorker()
    worker._backend = "ctcsound"
    worker._ctcsound = FakeCtcsound()

    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "-d -odac -M0 -+rtmidi=cmidi",
            "</CsOptions>",
            "<CsInstruments>",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    result = worker.start(csd=csd, midi_input="0", rtmidi_module="cmidi")

    assert result.backend == "ctcsound"
    assert "fallback" in result.detail

    instances = worker._ctcsound.instances
    assert len(instances) == 1
    assert instances[0].selected_module == "null"
    assert "-b 128" in instances[0].last_csd
    assert "-B512" in instances[0].last_csd
    assert "-+rtmidi=null" in instances[0].last_csd
    assert "-n" in instances[0].last_csd
    assert "-b128" in instances[0].options
    assert "-B512" in instances[0].options
    assert "-n" in instances[0].options


def test_start_ctcsound_sets_ssdir_option_for_gen_audio_assets(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "linux")
    monkeypatch.setattr(CsoundWorker, "_configure_host_midi_callbacks", lambda self, csound: None)

    class FakeCsound:
        def __init__(self) -> None:
            self.options: list[str] = []

        def setOption(self, option: str) -> None:  # noqa: N802
            self.options.append(option)

        def compileCsdText(self, _csd: str) -> int:  # noqa: N802
            return 0

        def start(self) -> int:
            return 0

        def perform(self) -> int:
            return 0

        def stop(self) -> None:
            return None

        def cleanup(self) -> None:
            return None

        def reset(self) -> None:
            return None

    class FakeCtcsound:
        def __init__(self) -> None:
            self.instance = FakeCsound()

        def Csound(self) -> FakeCsound:  # noqa: N802
            return self.instance

    assets_dir = tmp_path / "gen_audio_assets"
    worker = CsoundWorker(gen_audio_assets_dir=str(assets_dir))
    worker._backend = "ctcsound"
    worker._ctcsound = FakeCtcsound()

    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "-d -odac -M0 -+rtmidi=alsaseq",
            "</CsOptions>",
            "<CsInstruments>",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    worker.start(csd=csd, midi_input="0", rtmidi_module="alsaseq")

    assert f"--env:SSDIR={assets_dir.resolve()}" in worker._ctcsound.instance.options
    assert f"--env:SADIR={assets_dir.resolve()}" in worker._ctcsound.instance.options


def test_headless_runtime_suppresses_csound_messages_after_start(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "linux")
    monkeypatch.setattr(CsoundWorker, "_configure_host_midi_callbacks", lambda self, csound: None)

    class FakeCsound:
        def __init__(self) -> None:
            self.lifecycle: list[str] = []
            self.message_levels: list[int] = []

        def setOption(self, _option: str) -> None:  # noqa: N802
            return None

        def compileCsdText(self, _csd: str) -> int:  # noqa: N802
            self.lifecycle.append("compile")
            return 0

        def start(self) -> int:
            self.lifecycle.append("start")
            return 0

        def setMessageLevel(self, level: int) -> None:  # noqa: N802
            self.lifecycle.append("message-level")
            self.message_levels.append(level)

        def perform(self) -> int:
            return 0

        def stop(self) -> None:
            return None

        def cleanup(self) -> None:
            return None

        def reset(self) -> None:
            return None

    class FakeCtcsound:
        def __init__(self) -> None:
            self.instance = FakeCsound()

        def Csound(self) -> FakeCsound:  # noqa: N802
            return self.instance

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

    worker = CsoundWorker(csound_performance_logging=False)
    worker._backend = "ctcsound"
    worker._ctcsound = FakeCtcsound()
    worker.start(csd=csd, midi_input="0", rtmidi_module="null")

    assert worker._ctcsound.instance.lifecycle == ["compile", "start", "message-level"]
    assert worker._ctcsound.instance.message_levels == [0]


def test_headless_runtime_can_keep_csound_performance_messages_for_diagnostics(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "linux")
    monkeypatch.setattr(CsoundWorker, "_configure_host_midi_callbacks", lambda self, csound: None)

    class FakeCsound:
        def __init__(self) -> None:
            self.message_levels: list[int] = []

        def setOption(self, _option: str) -> None:  # noqa: N802
            return None

        def compileCsdText(self, _csd: str) -> int:  # noqa: N802
            return 0

        def start(self) -> int:
            return 0

        def setMessageLevel(self, level: int) -> None:  # noqa: N802
            self.message_levels.append(level)

        def stop(self) -> None:
            return None

        def cleanup(self) -> None:
            return None

        def reset(self) -> None:
            return None

    class FakeCtcsound:
        def __init__(self) -> None:
            self.instance = FakeCsound()

        def Csound(self) -> FakeCsound:  # noqa: N802
            return self.instance

    worker = CsoundWorker(csound_performance_logging=True)
    worker._backend = "ctcsound"
    worker._ctcsound = FakeCtcsound()
    worker.start(
        csd=(
            "<CsoundSynthesizer>\n<CsOptions>\n</CsOptions>\n<CsInstruments>\n"
            "sr = 48000\nksmps = 32\nnchnls = 2\ninstr 1\nendin\n"
            "</CsInstruments>\n</CsoundSynthesizer>"
        ),
        midi_input="0",
        rtmidi_module="null",
    )

    assert worker._ctcsound.instance.message_levels == []


def test_queue_midi_message_honors_delivery_delay() -> None:
    worker = CsoundWorker()
    worker._backend = "ctcsound"
    worker._running = True
    worker._host_midi_enabled = True
    worker._runtime_sr = 1_000
    worker._render_sample_cursor = 10_000
    worker._midi_scheduler.set_engine_sample_rate(1_000)

    assert worker.queue_midi_message([0x90, 60, 100], delivery_delay_seconds=0.05) is True

    with worker._host_midi_lock:
        assert worker._host_midi_buffer == bytearray()
    assert worker._midi_scheduler.pending_count == 1

    worker._prepare_host_midi_block(block_start_sample=10_000, block_end_sample=10_050)
    with worker._host_midi_lock:
        assert worker._host_midi_buffer == bytearray()

    worker._prepare_host_midi_block(block_start_sample=10_050, block_end_sample=10_051)
    with worker._host_midi_lock:
        assert worker._host_midi_buffer == bytearray([0x90, 60, 100])
    assert worker._midi_scheduler.pending_count == 0


def test_browser_clock_mock_runtime_renders_exact_block_windows(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "browser_clock")
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")

    worker = CsoundWorker()
    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "</CsOptions>",
            "<CsInstruments>",
            "sr = 48000",
            "ksmps = 64",
            "nchnls = 2",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    start = worker.start(csd=csd, midi_input="unused", rtmidi_module="null")

    assert start.audio_mode == "browser_clock"
    assert worker.is_running is True

    observed_cursors: list[tuple[int, int]] = []

    def before_block(_block_index: int, block_start_sample: int) -> None:
        observed_cursors.append((block_start_sample, worker.render_sample_cursor))

    first = worker.render_blocks(
        block_count=3,
        target_sample_rate=48_000,
        before_block=before_block,
    )
    second = worker.render_blocks(block_count=1, target_sample_rate=48_000)

    assert first.engine_sample_start == 0
    assert first.engine_sample_end == 192
    assert first.block_count == 3
    assert first.target_frame_count == 192
    assert len(first.pcm_f32le) == 192 * 2 * 4
    assert observed_cursors == [(0, 0), (64, 64), (128, 128)]
    assert second.engine_sample_start == 192
    assert second.engine_sample_end == 256
    assert worker.render_sample_cursor == 256

    worker.stop()


def test_browser_clock_mock_runtime_resamples_to_requested_output_rate(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "browser_clock")
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")

    worker = CsoundWorker()
    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "</CsOptions>",
            "<CsInstruments>",
            "sr = 44100",
            "ksmps = 64",
            "nchnls = 2",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    worker.start(csd=csd, midi_input="unused", rtmidi_module="null")

    render = worker.render_blocks(block_count=2, target_sample_rate=48_000)

    assert render.engine_sample_rate == 44_100
    assert render.target_sample_rate == 48_000
    assert render.engine_sample_end - render.engine_sample_start == 128
    assert render.target_frame_count == 139
    assert len(render.pcm_f32le) == 139 * 2 * 4

    worker.stop()


@pytest.mark.parametrize("dtype", [np.float32, np.float64])
@pytest.mark.parametrize("channels", [1, 2, 4])
@pytest.mark.parametrize("target_sample_rate", [48_000, 44_100])
def test_browser_clock_reuses_pcm_storage_without_overwriting_returned_audio(
    monkeypatch, dtype, channels, target_sample_rate
) -> None:
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")

    class FakeCsound:
        def __init__(self):
            self.output = np.empty((16, channels), dtype=dtype)
            self.calls = 0

        def performKsmps(self):  # noqa: N802
            self.calls += 1
            self.output[:] = self.calls + np.arange(channels) / 8
            return 0

        def spout(self):
            return self.output

    worker = CsoundWorker()
    worker._backend = "ctcsound"
    worker._audio_output_mode = "browser_clock"
    worker._csound = FakeCsound()
    worker._running = True
    worker._runtime_sr = 48_000
    worker._runtime_nchnls = channels
    worker._runtime_ksmps = 16
    previous_results = []
    cursor = 0
    storage = None
    capacity = 0
    for blocks in (3, 1, 5, 2):
        first_call = worker._csound.calls + 1
        result = worker.render_blocks(block_count=blocks, target_sample_rate=target_sample_rate)
        expected = np.repeat(np.arange(first_call, first_call + blocks, dtype=np.float32), 16)
        expected = np.column_stack((expected, expected + (0 if channels == 1 else 1 / 8)))
        expected = resample_stereo_block_linear(
            expected, source_sample_rate=48_000, target_sample_rate=target_sample_rate
        )
        previous_results.append((result, expected))
        assert result.target_frame_count == len(expected)
        assert (result.engine_sample_start, result.engine_sample_end) == (cursor, cursor + blocks * 16)
        cursor = result.engine_sample_end
        if blocks <= capacity:
            assert worker._pcm_render_buffer is storage
        storage = worker._pcm_render_buffer
        capacity = max(capacity, blocks)
        for prior, samples in previous_results:
            np.testing.assert_array_equal(np.frombuffer(prior.pcm_f32le, dtype=np.float32).reshape(-1, 2), samples)


def test_browser_clock_ctcsound_runtime_resamples_merged_blocks_once_per_request(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "browser_clock")
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")

    class FakeCsound:
        def __init__(self) -> None:
            self.perform_calls = 0

        def performKsmps(self) -> int:  # noqa: N802
            self.perform_calls += 1
            return 0

        def spout(self) -> np.ndarray:
            base = float(self.perform_calls)
            return np.column_stack(
                (
                    np.linspace(base, base + 0.5, num=64, dtype=np.float32),
                    np.linspace(-base, -(base + 0.5), num=64, dtype=np.float32),
                )
            )

    worker = CsoundWorker()
    worker._backend = "ctcsound"
    worker._audio_output_mode = "browser_clock"
    worker._csound = FakeCsound()
    worker._running = True
    worker._runtime_sr = 44_100
    worker._runtime_nchnls = 2
    worker._runtime_ksmps = 64

    render = worker.render_blocks(block_count=2, target_sample_rate=48_000)
    pcm = np.frombuffer(render.pcm_f32le, dtype=np.float32).reshape(-1, 2)

    assert worker._csound.perform_calls == 2
    assert render.engine_sample_rate == 44_100
    assert render.target_sample_rate == 48_000
    assert render.engine_sample_end - render.engine_sample_start == 128
    assert render.target_frame_count == 139
    assert pcm.shape == (139, 2)
    assert np.isfinite(pcm).all()


@pytest.mark.parametrize("ksmps", [1, 64])
def test_browser_clock_ctcsound_cursor_tracks_each_completed_block_for_internal_midi(ksmps) -> None:
    class FakeCsound:
        def performKsmps(self) -> int:  # noqa: N802
            return 0

        def spout(self) -> np.ndarray:
            return np.zeros((ksmps, 2), dtype=np.float32)

    worker = CsoundWorker()
    worker._backend = "ctcsound"
    worker._audio_output_mode = "browser_clock"
    worker._csound = FakeCsound()
    worker._running = True
    worker._host_midi_enabled = True
    worker._runtime_sr = 48_000
    worker._runtime_nchnls = 2
    worker._runtime_ksmps = ksmps
    worker._midi_scheduler.set_engine_sample_rate(48_000)

    observed_cursors: list[tuple[int, int]] = []
    drained_events = []
    original_drain_block = worker._midi_scheduler.drain_block

    def capture_drain_block(*, block_start_sample: int, block_end_sample: int):
        events = original_drain_block(
            block_start_sample=block_start_sample,
            block_end_sample=block_end_sample,
        )
        drained_events.extend(events)
        return events

    worker._midi_scheduler.drain_block = capture_drain_block  # type: ignore[method-assign]

    def before_block(_block_index: int, block_start_sample: int) -> None:
        observed_cursors.append((block_start_sample, worker.render_sample_cursor))
        assert worker.midi_output.send_scheduled_message(
            "internal:loopback",
            [0x90, 60, 100],
            delivery_delay_seconds=None,
        ) == "engine:internal"

    render = worker.render_blocks(
        block_count=3,
        target_sample_rate=48_000,
        before_block=before_block,
    )

    assert observed_cursors == [(n * ksmps, n * ksmps) for n in range(3)]
    assert [event.target_engine_sample for event in drained_events] == [n * ksmps for n in range(3)]
    assert all(event.late is False for event in drained_events)
    assert render.engine_sample_start == 0
    assert render.engine_sample_end == 3 * ksmps
    assert worker.render_sample_cursor == 3 * ksmps


def test_mixer_queue_applies_only_on_render_thread_before_block_and_timestamps_meters(monkeypatch):
    import threading
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    calls = []
    class FakeCsound:
        def setControlChannel(self, name, value):
            calls.append(("set", name, value, threading.get_ident()))
        def performKsmps(self):
            calls.append(("render",threading.get_ident()))
            return 0
        def controlChannel(self,name):
            calls.append(("meter",threading.get_ident()))
            return (.5,0)
        def spout(self):
            return np.zeros((64,2))
    worker._backend = "ctcsound"
    worker._audio_output_mode = "browser_clock"
    worker._csound = FakeCsound()
    worker._running = True
    worker._runtime_sr = 48000
    worker._runtime_nchnls = 2
    worker._runtime_ksmps = 64
    worker.configure_mixer({"meters":{"one":{"peakL":"peak"}}},{"gain":1})
    for value in range(100):
        worker.queue_mixer_controls({"gain":value/100})
    assert calls == []
    thread = threading.Thread(target=lambda: worker.render_blocks(block_count=2,target_sample_rate=48000))
    thread.start()
    thread.join()
    assert calls[0] == ("set","gain",.99,thread.ident)
    assert [c[0] for c in calls] == ["set","render","meter","render"]
    assert worker.drain_mixer_meters() == [{"engineSample":64,"levels":{"one":{"peakL":.5}}}]
    assert worker.drain_mixer_meters() == []


def test_performance_and_mixer_controls_share_render_queue_without_losing_pending_updates(monkeypatch):
    monkeypatch.setenv("VISUALCSOUND_FORCE_MOCK_ENGINE", "true")
    worker = CsoundWorker()
    worker.start("", "0", "none")
    worker.queue_mixer_controls({"mixer": 0.5})
    worker.queue_control_channels({"performance": 0.2})
    worker.queue_control_channels({"performance": 0.7})
    worker.start("", "0", "none")  # Starting an already-running engine must preserve pending writes.
    observed = {}
    class Channels:
        def setControlChannel(self, name, value):
            observed[name] = value
    worker._apply_control_channels(Channels())
    assert observed == {"mixer": 0.5, "performance": 0.7}
    worker.queue_control_channels({"stale": 0.9})
    worker.stop()
    worker.start("", "0", "none")
    worker._apply_control_channels(Channels())
    assert "stale" not in observed
    worker.stop()
