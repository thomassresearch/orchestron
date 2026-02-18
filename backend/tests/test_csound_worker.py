from __future__ import annotations

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
            "-d -odac -M1 -+rtmidi=cmidi",
            "</CsOptions>",
            "<CsInstruments>",
            "instr 1",
            "endin",
            "</CsInstruments>",
            "</CsoundSynthesizer>",
        ]
    )

    sanitized = CsoundWorker._apply_runtime_midi_options(csd, midi_input="2", rtmidi_module="portmidi")

    assert "-M1" not in sanitized
    assert "-+rtmidi=cmidi" not in sanitized
    assert "-M2" in sanitized
    assert "-+rtmidi=portmidi" in sanitized
    assert "-odac" in sanitized
    assert "<CsOptions>" in sanitized
    assert "</CsOptions>" in sanitized


def test_start_ctcsound_falls_back_to_supported_rtmidi_module(monkeypatch) -> None:
    monkeypatch.setattr("backend.app.engine.csound_worker.sys.platform", "darwin")

    class FakeCsound:
        def __init__(self, failing_modules: set[str]) -> None:
            self._failing_modules = failing_modules
            self.selected_module = ""
            self.last_csd = ""

        def setOption(self, option: str) -> None:  # noqa: N802
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
            instance = FakeCsound({"cmidi"})
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
    assert instances[0].selected_module == "cmidi"
    assert instances[1].selected_module == "portmidi"
    assert "-+rtmidi=cmidi" in instances[0].last_csd
    assert "-+rtmidi=portmidi" in instances[1].last_csd
