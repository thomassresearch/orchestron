"""Render a supplied Vocoder graph with independent stereo speech/carrier WAVs."""
import re
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tools.stereo_delay_audio import probe_source
from backend.tools.tube_overdrive_audio import SAMPLE_RATE, write_float_wav


def render(patch, speech, sound, *, values=None, ksmps=32, mode='midi'):
    targets, routes = [], []
    for name in ('speech', 'sound'):
        source = probe_source(ksmps)
        source.id = name
        for node in source.graph.nodes:
            node.id = name + '_' + node.id
        for edge in source.graph.connections:
            edge.from_node_id = name + '_' + edge.from_node_id
            edge.to_node_id = name + '_' + edge.to_node_id
        targets.append(PatchInstrumentTarget(source, 0, assignment_id=name, always_on=True))
        for side in ('left', 'right'):
            routes.append(AudioRoute(id=f'{name}-{side}', sourceId=name, sourcePort=side,
                                     targetId='vocoder', targetPort=f'{name}_{side}', kind='custom'))
    for side in ('left', 'right'):
        routes.append(AudioRoute(id=f'out-{side}', sourceId='vocoder', sourcePort=side,
                                 targetId='$master', targetPort=side, kind='main'))
    patch = patch.model_copy(deep=True)
    patch.graph.engine_config.ksmps = ksmps
    targets.append(PatchInstrumentTarget(patch, 0, assignment_id='vocoder', always_on=True,
                                        performance_controller_values=values or {}))
    artifact = CompilerService(OpcodeService('/static/icons')).compile_patch_bundle(
        targets, midi_input='0', rtmidi_module='none', performance_input_mode=mode,
        profile=CompilationProfile.OFFLINE if ksmps == 1 else CompilationProfile.LIVE,
        audio_graph=AudioGraph(routes=routes, masterId='$master'), mixer=MixerState())
    with TemporaryDirectory(prefix='vocoder-audio-') as directory:
        orc = artifact.orc
        for name, audio in (('speech', speech), ('sound', sound)):
            path = Path(directory) / f'{name}.wav'
            write_float_wav(path, audio)
            for side in ('left', 'right'):
                prefix = f'a_{name}_wav_left, a_{name}_wav_right diskin2 "{path}", 1, 0, 0\n' if side == 'left' else ''
                orc, count = re.subn(
                    rf'(?m)^(\s*)(a_{name}_probe_{side}_aout_\d+) = 0(?:\.0)?\s*$',
                    lambda m: f'{m[1]}{prefix}{m[2]} = a_{name}_wav_{side}', orc)
                assert count == 1
        length = max(len(speech), len(sound)) + SAMPLE_RATE // 4
        csd = (f'<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n'
               f'<CsInstruments>\n{orc}\n</CsInstruments>\n<CsScore>\nf 0 {length / SAMPLE_RATE + .1}\n'
               '</CsScore>\n</CsoundSynthesizer>')
        cs = load_ctcsound_module().Csound()
        try:
            assert cs.compileCsdText(csd) == 0 and cs.start() == 0
            result = np.empty((length, 2))
            for start in range(0, length, cs.ksmps()):
                assert cs.performKsmps() == 0
                count = min(cs.ksmps(), length - start)
                result[start:start + count] = cs.spout().reshape(-1, 2)[:count]
            return result
        finally:
            cs.cleanup()
            cs.reset()


def signals(seconds=1):
    """Deterministic vowel-like modulator and bright carrier, each peaking at 0.9."""
    t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    speech, sound = [], []
    for fundamental, carrier in ((125, 110), (160, 165)):
        voice = np.zeros_like(t)
        for harmonic in range(1, 65):
            frequency = harmonic * fundamental
            weight = np.exp(-((frequency - 700) / 200) ** 2) + .6 * np.exp(-((frequency - 1800) / 300) ** 2)
            voice += weight * np.sin(2 * np.pi * frequency * t)
        voice *= np.sin(np.pi * np.minimum(t * 4, 1) / 2) ** 2 * (.6 + .4 * np.sin(2 * np.pi * 3 * t) ** 2)
        wave = sum(np.sin(2 * np.pi * carrier * h * t) / h for h in range(1, 65))
        speech.append(.9 * voice / np.max(abs(voice)))
        sound.append(.9 * wave / np.max(abs(wave)))
    return np.column_stack(speech), np.column_stack(sound)
