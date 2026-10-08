"""Parity and startup/failure contracts for the optional native playback kernel."""

from __future__ import annotations

from itertools import product
import importlib
from types import SimpleNamespace

import pytest

from backend.app.models.session import SessionSequencerTimingConfig, _SEQUENCER_BEAT_RATE_OPTIONS
from backend.app.services import sequencer_playback as playback
from backend.app.services.sequencer_runtime_models import SequencerTimingRuntime
from backend.tests.test_sequencer_note_timing import make_runtime


@pytest.fixture(params=["python", "cython"])
def kernel(request):
    if request.param == "python":
        return playback.python_kernel()
    module = importlib.import_module("backend.app.services._sequencer_playback")
    if not playback.is_compiled(module):
        pytest.skip("Optional Cython extension is not installed")
    return module


def test_all_valid_timing_combinations_match_reference(kernel):
    for unit, denominator, grid, ratio in product(
        ("quarter", "meter"),
        (4, 8),
        (1, 2, 3, 4, 6, 8),
        _SEQUENCER_BEAT_RATE_OPTIONS,
    ):
        validated = SessionSequencerTimingConfig(
            beat_unit=unit,
            meter_denominator=denominator,
            steps_per_beat=grid,
            beat_rate_numerator=ratio[0],
            beat_rate_denominator=ratio[1],
        )
        timing = SequencerTimingRuntime(**validated.model_dump())
        assert kernel.timing_span(timing) == timing.transport_subunits_per_local_step


def test_timing_helpers_preserve_arbitrary_signed_positions(kernel):
    runtime, _, _ = make_runtime([60, {"hold": True}, 67, None])
    track = runtime._config.tracks["lead"]
    duration = track.transport_subunit_count
    span = track.timing.transport_subunits_per_local_step
    for anchor, position in product((-(2**100), -1, 0, 2**100), (-(2**120), -1, 0, 1, 2**120)):
        track.phase_offset_subunit = anchor
        offset = (position - anchor) % duration
        assert kernel._local_transport_offset_for(track, position) == offset
        assert kernel._local_step_for(track, position) == offset // span
        assert kernel._next_track_cycle_boundary_subunit(runtime, track, position) == position - offset + duration
        assert (
            kernel._next_local_step_boundary_subunit(runtime, track, position)
            == position - offset + (offset // span + 1) * span
        )


@pytest.mark.parametrize("error", [ImportError("missing binary"), OSError("wrong architecture")])
def test_auto_falls_back_on_extension_loading_failure(monkeypatch, error):
    def broken(_name):
        raise error

    monkeypatch.setattr(playback.importlib, "import_module", broken)
    module, reason = playback.load_kernel("auto")
    assert module is playback.python_kernel()
    assert str(error) in reason
    with pytest.raises(RuntimeError, match="Cython sequencer requested"):
        playback.load_kernel("cython")


def test_absent_extension_and_forced_python(monkeypatch):
    monkeypatch.setattr(playback.importlib, "import_module", lambda _: playback.python_kernel())
    module, reason = playback.load_kernel("auto")
    assert not playback.is_compiled(module)
    assert "not installed" in reason
    with pytest.raises(RuntimeError, match="not installed"):
        playback.load_kernel("cython")
    assert playback.load_kernel("python") == (module, None)
    with pytest.raises(ValueError, match="must be auto, python or cython"):
        playback.load_kernel("invalid")


def test_render_failure_is_not_retried_in_another_implementation(kernel):
    runtime, _, _ = make_runtime([{"note": 60, "ratchets": 4}, None, None, None])
    calls = []

    def failed_delivery(*args, **kwargs):
        calls.append((args, kwargs))
        raise OSError("delivery failed after partial processing")

    runtime._send_messages_locked = failed_delivery
    with pytest.raises(OSError, match="partial processing"):
        kernel.advance_render_block(runtime, sample_rate=48000, ksmps=32, block_start_sample=0)
    assert len(calls) == 1


def test_unexpected_extension_errors_are_not_silenced(monkeypatch):
    def broken(_name):
        raise RuntimeError("module initialization bug")

    monkeypatch.setattr(playback.importlib, "import_module", broken)
    with pytest.raises(RuntimeError, match="initialization bug"):
        playback.load_kernel("auto")


def test_explicit_python_does_not_attempt_native_import(monkeypatch):
    def forbidden(_name):
        pytest.fail("Forced Python must not import the native extension")

    monkeypatch.setattr(playback.importlib, "import_module", forbidden)
    assert playback.load_kernel("python")[0] is playback.python_kernel()


def test_stale_extension_selects_current_source_or_fails_strict_mode(monkeypatch):
    module = SimpleNamespace(__file__="old.so")
    monkeypatch.setattr(playback.importlib, "import_module", lambda _: module)
    monkeypatch.setattr(playback, "is_compiled", lambda _: True)
    monkeypatch.setattr(playback, "source_matches", lambda _: False)
    selected, reason = playback.load_kernel("auto")
    assert selected is playback.python_kernel()
    assert "stale" in reason
    with pytest.raises(RuntimeError, match="stale"):
        playback.load_kernel("cython")


def test_invalid_timing_divisors_raise_in_both_implementations(kernel):
    timing = SimpleNamespace(
        beat_unit="meter", meter_denominator=0, beat_rate_numerator=1, beat_rate_denominator=1, steps_per_beat=4
    )
    with pytest.raises(ZeroDivisionError):
        kernel.timing_span(timing)
