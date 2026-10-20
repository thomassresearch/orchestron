"""Compile and render an explicit HSB Mono patch; never loads developer examples."""

import re

import numpy as np

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService

SAMPLE_RATE = 48000


def compile_patch(patch, *, values=None, ksmps=32, mode="score", copies=1):
    targets, routes = [], []
    for index in range(copies):
        instance = f"hsb{index}"
        document = patch.model_copy(deep=True)
        document.graph.engine_config.ksmps = ksmps
        document.graph.engine_config.control_rate = SAMPLE_RATE / ksmps
        targets.append(PatchInstrumentTarget(document, index + 1, assignment_id=instance,
                                             performance_controller_values=values or {}))
        routes.extend(AudioRoute(id=f"{instance}-{side}", sourceId=instance, sourcePort=side,
                                 targetId="$master", targetPort=side, kind="main")
                      for side in ("left", "right"))
    return CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode=mode,
        profile=CompilationProfile.OFFLINE, audio_graph=AudioGraph(routes=routes, masterId="$master"),
        mixer=MixerState(),
    )


def render(artifact, *, score="", events=None, seconds=1.2):
    """Return stereo samples and measured controls for each synthesis voice."""
    names = ("glide_pitch", "recent_activity", "tone_value", "brightness_value", "glide_value")
    observed = []

    def instrument(match):
        body = match[0]
        if "VCS_LEGATO_PHRASE:" not in body:
            return body
        index = len(observed)
        channels = []
        for name in names:
            variable = re.search(rf"\b(k_{name}_kout_\d+) portk", body)[1]
            if name == "brightness_value":
                variable = f"({variable} - 2)"
            channels.append(f'chnset {variable}, "hsb_probe_{index}_{name}"')
        observed.append(index)
        return body.replace("rireturn", "\n".join(channels) + "\nrireturn")

    orchestra = re.sub(r"(?m)^instr .*?^endin", instrument, artifact.orc, flags=re.S | re.M)
    cs = load_ctcsound_module().Csound()
    worker = CsoundWorker() if events is not None else None
    if worker:
        worker._configure_host_midi_callbacks(cs)
    options = "-n -d -m0" + (" -M0" if worker else "")
    csd = (f"<CsoundSynthesizer>\n<CsOptions>\n{options}\n</CsOptions>\n<CsInstruments>\n"
           f"{orchestra}\n</CsInstruments>\n<CsScore>\nf 0 {seconds + 0.1}\n{score}\n"
           "</CsScore>\n</CsoundSynthesizer>")
    try:
        if cs.compileCsdText(csd) != 0 or cs.start() != 0:
            raise RuntimeError("HSB Mono Csound compilation failed")
        if worker:
            for time, message in events:
                worker._midi_scheduler.enqueue(message, source="hsb-probe",
                                               target_engine_sample=round(time * SAMPLE_RATE))
        audio, states = [], []
        for start in range(0, round(seconds * SAMPLE_RATE), cs.ksmps()):
            if worker:
                worker._prepare_host_midi_block(block_start_sample=start,
                                               block_end_sample=start + cs.ksmps())
            if cs.performKsmps() != 0:
                raise RuntimeError("HSB Mono rendering ended early")
            audio.append(cs.spout().copy().reshape(-1, 2))
            states.append([[cs.controlChannel(f"hsb_probe_{i}_{name}")[0]
                            for name in names] for i in observed])
        samples = np.concatenate(audio)[:round(seconds * SAMPLE_RATE)]
        if not np.isfinite(samples).all():
            raise RuntimeError("HSB Mono produced non-finite audio")
        return samples, np.asarray(states)
    finally:
        cs.cleanup()
        cs.reset()
