"""Native MIDI/SCORE audio probes for an explicit Goa lead patch document.

No developer examples are loaded here; tests supply independent fixtures.
"""

import re

import numpy as np

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService

Q_ID = "354bfb51-e700-4955-9141-b93bbe325c72"
CUTOFF_ID = "97626757-30a0-4ff8-8db1-09d7665a5e56"
SAVED_VALUES = {
    Q_ID: 5,
    CUTOFF_ID: 5.0395263882509385,
    "899fecbf-f5a9-4223-bb62-a660a78bcc8e": 1.048483393387869,
    "b29b4aef-fe1b-46ac-87fc-4383f638f714": 3.7679225695319474,
    "355ece54-e1bb-439a-807d-ebbf44d462f2": 0.25,
}


def render(patch, notes, *, values=None, sr=48000, ksmps=32, mode="midi", seconds=None):
    """notes: (start seconds, duration seconds, MIDI pitch, velocity).

    The native internal MIDI scheduler and production mixer/compiler are used.
    Return raw, unnormalized stereo float64 samples, including invalid values
    when deliberately reproducing the original fault.
    """
    patch = patch.model_copy(deep=True)
    patch.graph.engine_config.sr = sr
    patch.graph.engine_config.ksmps = ksmps
    patch.graph.engine_config.control_rate = sr / ksmps
    routes = [AudioRoute(id=side, sourceId="lead", sourcePort=side, targetId="$master", targetPort=side)
              for side in ("left", "right")]
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch, 5, assignment_id="lead", performance_controller_values=values or {})],
        "0", "none", performance_input_mode=mode,
        profile=CompilationProfile.OFFLINE if ksmps == 1 else CompilationProfile.LIVE,
        audio_graph=AudioGraph(routes=routes, masterId="$master"), mixer=MixerState(),
    )
    seconds = seconds or max(start + duration for start, duration, _, _ in notes) + 0.4
    score = "\n".join(f"i 1 {start} {duration} {pitch} {velocity}"
                      for start, duration, pitch, velocity in notes) if mode == "score" else ""
    csd = re.sub(r"<CsOptions>.*?</CsOptions>",
                 "<CsOptions>\n-n -d -m0" + (" -M0" if mode == "midi" else "") + "\n</CsOptions>",
                 artifact.csd, flags=re.S)
    csd = csd.replace("f 0 z", f"f 0 {seconds + 0.1}\n{score}")
    cs = load_ctcsound_module().Csound()
    worker = CsoundWorker() if mode == "midi" else None
    if worker:
        worker._configure_host_midi_callbacks(cs)
    try:
        if cs.compileCsdText(csd) != 0 or cs.start() != 0:
            raise RuntimeError("Goa lead probe could not start")
        if worker:
            events = [(start, [0x94, pitch, velocity]) for start, _, pitch, velocity in notes]
            events.extend((start + duration, [0x84, pitch, 0]) for start, duration, pitch, _ in notes)
            for time, message in sorted(events, key=lambda event: (event[0], event[1][0])):
                worker._midi_scheduler.enqueue(message, source="goa-probe", target_engine_sample=round(time * sr))
        audio = []
        for start in range(0, round(seconds * sr), cs.ksmps()):
            if worker:
                worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + cs.ksmps())
            if cs.performKsmps() != 0:
                raise RuntimeError("Goa lead probe ended early")
            audio.append(cs.spout().copy().reshape(-1, 2))
        return np.concatenate(audio)[:round(seconds * sr)]
    finally:
        cs.cleanup()
        cs.reset()
