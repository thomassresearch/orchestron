from __future__ import annotations

import os
import sys

import pytest

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module


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
    assert worker._thread is None

    first = worker.render_blocks(block_count=3, target_sample_rate=48_000)
    second = worker.render_blocks(block_count=1, target_sample_rate=48_000)

    assert first.engine_sample_start == 0
    assert first.engine_sample_end == 192
    assert first.block_count == 3
    assert first.target_frame_count == 192
    assert len(first.pcm_f32le) == 192 * 2 * 4
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
