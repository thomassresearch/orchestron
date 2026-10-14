"""Offline percussion validation helpers; callers supply independent patch data."""
from __future__ import annotations

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService


def compile_kit(patch: PatchDocument, settings=None, mode="score", deterministic=True):
    patch = patch.model_copy(deep=True)
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch=patch, midi_channel=10, assignment_id="kit",
                               performance_controller_values=settings or {})],
        audio_graph=AudioGraph(routes=[
            AudioRoute(id=side, sourceId="kit", sourcePort=side,
                       targetId="$output", targetPort=side) for side in ("left", "right")
        ]), midi_input="0", rtmidi_module="none", performance_input_mode=mode,
    )
    if deterministic:
        # Seed the render, never the saved graph. Legacy noise has no seed input.
        artifact.orc = "seed 12345\n" + artifact.orc
    return artifact


def render(artifact, events, duration, midi_file=None):
    """Events are (start seconds, MIDI note, velocity, held seconds)."""
    reference = artifact.manifest["instrumentReferences"]["kit"]
    score = "\n".join(f"i {reference} {start} {held} {note} {velocity}"
                      for start, note, velocity, held in events)
    score += f"\nf 0 {duration + .1}\ne\n"
    csound = load_ctcsound_module().Csound()
    try:
        if midi_file is not None:
            assert csound.setOption(f"-F{midi_file}") == 0
        csd = ("<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n"
               f"<CsInstruments>\n{artifact.orc}\n</CsInstruments>\n<CsScore>\n"
               f"{score}\n</CsScore>\n</CsoundSynthesizer>")
        if csound.compileCsdText(csd) != 0 or csound.start() != 0:
            raise RuntimeError("Csound compilation/start failed")
        count = round(duration * csound.sr() / csound.ksmps())
        output = []
        for _ in range(count):
            if csound.performKsmps() != 0:
                raise RuntimeError("Csound stopped before the requested render duration")
            output.append(csound.spout().copy().reshape(-1, 2))
        return np.concatenate(output)
    finally:
        csound.cleanup()
        csound.reset()
