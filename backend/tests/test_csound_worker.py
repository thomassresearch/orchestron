from __future__ import annotations

import os
import sys
import time

import pytest

from backend.app.engine.csound_worker import CsoundWorker


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


def test_streaming_runtime_options_disable_realtime_audio_output() -> None:
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

    sanitized = CsoundWorker._apply_streaming_runtime_options(
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


def test_start_ctcsound_falls_back_to_supported_rtmidi_module(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "darwin")

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
    assert len(instances) >= 2
    assert instances[0].selected_module == "coremidi"
    assert instances[1].selected_module == "portmidi"
    assert "-b 128" in instances[0].last_csd
    assert "-B512" in instances[0].last_csd
    assert "-b 128" in instances[1].last_csd
    assert "-B512" in instances[1].last_csd
    assert "-+rtmidi=coremidi" in instances[0].last_csd
    assert "-+rtmidi=portmidi" in instances[1].last_csd
    assert "-+rtaudio=auhal" in instances[0].last_csd
    assert "-+rtaudio=auhal" in instances[1].last_csd
    assert "-b128" in instances[0].options
    assert "-B512" in instances[0].options
    assert "-b128" in instances[1].options
    assert "-B512" in instances[1].options
    assert "-+rtaudio=auhal" in instances[0].options
    assert "-+rtaudio=auhal" in instances[1].options


def test_start_ctcsound_sets_ssdir_option_for_gen_audio_assets(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "linux")

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


def test_queue_midi_message_honors_delivery_delay(monkeypatch) -> None:
    current_time = {"value": 10.0}
    monkeypatch.setattr("backend.app.engine.csound_worker.time.perf_counter", lambda: current_time["value"])

    worker = CsoundWorker()
    worker._backend = "ctcsound"
    worker._running = True
    worker._host_midi_enabled = True

    assert worker.queue_midi_message([0x90, 60, 100], delivery_delay_seconds=0.05) is True

    with worker._host_midi_lock:
        assert worker._host_midi_buffer == bytearray()
        assert len(worker._host_midi_pending) == 1
        worker._drain_due_host_midi_locked(10.04)
        assert worker._host_midi_buffer == bytearray()
        worker._drain_due_host_midi_locked(10.051)
        assert worker._host_midi_buffer == bytearray([0x90, 60, 100])
        assert worker._host_midi_pending == []


@pytest.mark.skipif(sys.platform != "win32", reason="Windows-only integration test")
@pytest.mark.skipif(
    os.getenv("VISUALCSOUND_RUN_WINDOWS_LOCAL_MIDI") != "1",
    reason="Set VISUALCSOUND_RUN_WINDOWS_LOCAL_MIDI=1 to enable this integration test",
)
def test_windows_local_mode_consumes_host_midi_callbacks(monkeypatch) -> None:
    monkeypatch.setenv("VISUALCSOUND_AUDIO_OUTPUT_MODE", "local")
    monkeypatch.delenv("VISUALCSOUND_FORCE_MOCK_ENGINE", raising=False)

    worker = CsoundWorker()
    assert worker.backend == "ctcsound", "ctcsound is required for the Windows local MIDI integration test"

    csd = "\n".join(
        [
            "<CsoundSynthesizer>",
            "<CsOptions>",
            "</CsOptions>",
            "<CsInstruments>",
            "sr = 48000",
            "ksmps = 32",
            "nchnls = 2",
            "0dbfs = 1",
            "",
            "massign 0, 1",
            "",
            "instr 1",
            "  iNote notnum",
            '  chnset iNote, "last_note"',
            "  outs 0, 0",
            "endin",
            "</CsInstruments>",
            "<CsScore>",
            "f0 z",
            "</CsScore>",
            "</CsoundSynthesizer>",
        ]
    )

    worker.start(csd=csd, midi_input="unused-host-midi", rtmidi_module="winmme")

    try:
        assert worker.accepts_direct_midi, "Windows local mode did not enable direct host MIDI injection"
        assert worker.queue_midi_message([0x90, 60, 100], delivery_delay_seconds=0.02) is True

        deadline = time.time() + 2.0
        observed_note = None
        observed_error = None
        while time.time() < deadline:
            observed_note, observed_error = worker._csound.controlChannel("last_note")
            if observed_error == 0 and int(round(float(observed_note))) == 60:
                break
            time.sleep(0.01)

        assert observed_error == 0, "Control channel 'last_note' was not readable"
        assert int(round(float(observed_note))) == 60
        assert worker.queue_midi_message([0x80, 60, 0], delivery_delay_seconds=0.0) is True
    finally:
        worker.stop()
