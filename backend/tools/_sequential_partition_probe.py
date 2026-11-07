"""T04 test harness, never a session renderer. No children, threads or IPC.

Runs canonical and partition native instances at the same block boundary. The
caller supplies an already ordered event/control script; no sequencer, controller
revision owner, lane gate or resampler lives inside an instance.
"""
from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass

import numpy as np

from backend.app.engine.partition_native import NativeCsoundPartition as NativeProbe
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.services.compiler_partitioned import validate_realtime_partition_compilation




@dataclass(frozen=True)
class PartitionParityResult:
    canonical: np.ndarray
    partitioned: np.ndarray
    canonical_meters: np.ndarray
    partitioned_meters: np.ndarray
    event_blocks: tuple
    binding: str
    sample_bytes: int


def compare_sequential(compilation, plan, *, frames, events=(), controls=(), module=None):
    """Events: (sample, MIDI bytes); controls: (sample, name, value), both ordered.

    Input samples within [block start, block end) follow the existing worker's
    block acceptance rule. This harness proves DSP/block parity, not concurrent
    event acceptance, realtime latency or process performance.
    """
    validate_realtime_partition_compilation(compilation, plan)
    if not compilation.programs:
        raise ValueError("A matching coarse partition compilation is required.")
    if frames <= 0 or frames % plan.graph.engine.ksmps:
        raise ValueError("Probe frames must be positive whole engine blocks.")
    if any(a[0] > b[0] for rows in (events, controls) for a, b in zip(rows, rows[1:])):
        raise ValueError("Probe input must be ordered.")
    module = module or load_ctcsound_module()
    engine = plan.graph.engine
    meters = tuple(m for s in plan.graph.stages for m in s.meters)
    audio, split_audio, metering, split_metering, trace = [], [], [], [], []
    with ExitStack() as stack:
        def start(csd):
            probe = NativeProbe(module, csd, engine, plan.sample_bytes)
            stack.callback(probe.close)
            return probe

        canonical = start(compilation.canonical.csd)
        instances = {p.id: start(p.csd) for p in compilation.programs}
        buffers = {b.id: np.zeros(engine.ksmps, dtype=canonical.dtype) for b in plan.buses}
        event_index, control_index = 0, 0
        for sample in range(0, frames, engine.ksmps):
            midi, writes = [], []
            while event_index < len(events) and events[event_index][0] < sample + engine.ksmps:
                midi.append(events[event_index][1])
                event_index += 1
            while control_index < len(controls) and controls[control_index][0] < sample + engine.ksmps:
                writes.append(controls[control_index][1:])
                control_index += 1
            if midi or writes:
                trace.append((sample, tuple(tuple(m) for m in midi), tuple(writes)))
            canonical.perform(midi, writes)
            audio.append(canonical.cs.spout().copy())
            metering.append([canonical.cs.controlChannel(m)[0] for m in meters])
            split_values = {}
            for program in compilation.programs:
                instance = instances[program.id]
                for bus, name in program.inputs:
                    instance.cs.setAudioChannel(name, buffers[bus])
                instance.perform(midi, [(name, value) for name, value in writes if name in program.controls])
                for bus, name in program.outputs:
                    instance.cs.audioChannel(name, buffers[bus])
                split_values.update((m, instance.cs.controlChannel(m)[0]) for m in program.meters)
                if program.owns_output:
                    split_audio.append(instance.cs.spout().copy())
            split_metering.append([split_values[m] for m in meters])
        result = PartitionParityResult(np.concatenate(audio), np.concatenate(split_audio),
            np.asarray(metering), np.asarray(split_metering), tuple(trace),
            type(canonical.cs).__name__, plan.sample_bytes)
        # Equal NaNs are not audio parity. Check both audio and meter streams.
        if not all(np.isfinite(values).all() for values in (
            result.canonical, result.partitioned, result.canonical_meters, result.partitioned_meters,
        )):
            raise RuntimeError("Native parity probe produced nonfinite audio or meters.")
        return result
