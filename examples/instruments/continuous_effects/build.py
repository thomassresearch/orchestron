"""Reproduce three continuous stereo effects and their native exports."""

import json
from pathlib import Path

from backend.app.models.export import ExportedPatchDefinition
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService

# 20*log10(2): ampdb converts a power of two without extending formula syntax.
OCTAVE_DB = '6.020599913279624'


class Effect:
    def __init__(self, name, prefix, controls, description):
        self.name, self.prefix, self.description = name, prefix, description
        self.nodes, self.connections, self.formulas = [], [], {}
        for index, (key, label, low, high, default) in enumerate(controls):
            self.node(key, 'perf_controller', index * 300, -500, label=label,
                      min=low, max=high, default=default,
                      scale='logarithmic' if key == 'downsample' else 'linear')
        for side, y in [('left', 200), ('right', 800)]:
            self.node('in_' + side, 'inleta', 0, y, sname=side)

    def identity(self, key):
        return f'{self.prefix}_{key}'

    def node(self, key, opcode, x=0, y=0, **params):
        self.nodes.append(dict(id=self.identity(key), opcode=opcode, params=params, position=dict(x=x, y=y)))
        return key, {'inleta': 'asignal', 'pvsanal': 'fsig', 'pvscale': 'fsig',
                     'perf_controller': 'iout'}.get(opcode, 'aout')

    def wire(self, source, target, port):
        key, outlet = source
        self.connections.append(dict(from_node_id=self.identity(key), from_port_id=outlet,
                                     to_node_id=self.identity(target), to_port_id=port))

    def formula(self, target, port, expression, **bindings):
        inputs = []
        for token, source in bindings.items():
            self.wire(source, target, port)
            inputs.append(dict(token=token, from_node_id=self.identity(source[0]), from_port_id=source[1]))
        self.formulas[f'{self.identity(target)}::{port}'] = dict(expression=expression, inputs=inputs)

    def setting(self, key, expression, **controls):
        result = self.node(key, 'upsamp', len(self.nodes) * 40, -100)
        self.formula(key, 'ksig', expression, **{token: (control, 'iout') for token, control in controls.items()})
        return result

    def audio(self, key, expression, x=500, y=400, **bindings):
        result = self.node(key, 'mix2', x, y, b=0)
        self.formula(key, 'a', expression, **bindings)
        return result

    def finish(self, left, right):
        for source, side, y in [(left, 'left', 200), (right, 'right', 800)]:
            self.node('out_' + side, 'outleta', 2000, y, sname=side)
            self.wire(source, 'out_' + side, 'asignal')
        return PatchDocument.model_validate(dict(
            id=self.name.lower().replace(' ', '-') + '-v1', name=self.name,
            always_on=True, instrument_type='continuous',
            description=self.description + ' Restart the rack after changing performance controllers.',
            graph=dict(nodes=self.nodes, connections=self.connections,
                       engine_config=dict(sr=48000, ksmps=32, nchnls=2),
                       ui_layout=dict(input_formulas=self.formulas,
                                      audio_blocks={self.identity('input'): True, self.identity('output'): True}),
                       audio_interface=dict(role='effect', guided=False, mainInput=self.identity('input'),
                                            mainOutput=self.identity('output'), groups=[
                                                dict(id=self.identity(d), name=f'Stereo {d.title()}', direction=d,
                                                     layout='stereo', ports=['left', 'right'], purpose='main')
                                                for d in ('input', 'output')]))))


def widener():
    e = Effect('Stereo Widener', 'sw', [
        ('width', 'Width', 0, 2, 1.5), ('mono', 'Mono Widening', 0, 1, 0),
        ('delay', 'Delay (ms)', 1, 30, 12), ('output', 'Output (dB)', -24, 0, -6),
    ], 'Mid/side width with optional mono widening. Synthetic side information cancels in mono. '
       'Width 1 and Mono Widening 0 preserve the stereo input before Output gain. Allow headroom at high width.')
    mid = e.audio('mid', '(left + right) / 2', left=('in_left', 'asignal'), right=('in_right', 'asignal'))
    side = e.audio('side', '(left - right) / 2', y=700, left=('in_left', 'asignal'), right=('in_right', 'asignal'))
    delayed = e.node('delayed_mid', 'delay', 800, 200)
    e.wire(mid, 'delayed_mid', 'asig')
    e.formula('delayed_mid', 'idlt', 'time / 1000', time=('delay', 'iout'))
    width = e.setting('width_audio', 'width', width='width')
    mono = e.setting('mono_audio', 'mono', mono='mono')
    gain = e.setting('gain', 'ampdb(db)', db='output')
    spread = e.audio('spread', '(side + amount * (mid - delayed) / 2) * width', x=1100,
                     side=side, amount=mono, mid=mid, delayed=delayed, width=width)
    return e.finish(e.audio('left', '(mid + side) * gain', x=1600, y=200, mid=mid, side=spread, gain=gain),
                    e.audio('right', '(mid - side) * gain', x=1600, y=800, mid=mid, side=spread, gain=gain))


def crusher():
    e = Effect('Bit Crusher', 'bc', [
        ('bits', 'Bit Depth', 2, 16, 8), ('downsample', 'Downsample Factor', 1, 64, 4),
        ('drive', 'Drive (dB)', 0, 24, 0), ('mix', 'Mix', 0, 1, 1), ('output', 'Output (dB)', -24, 0, -6),
    ], 'Independent stereo sample-rate reduction and signed bit quantization. Bit Depth rounds to an integer. '
       'Drive clips before reduction; aliasing is intentional. Mix 0 is dry before Output gain. No dither.')
    drive = e.setting('drive_gain', 'ampdb(db)', db='drive')
    q = e.setting('steps', f'floor(ampdb({OCTAVE_DB} * (floor(bits + 0.5) - 1)) + 0.5)', bits='bits')
    mix = e.setting('mix_audio', 'mix', mix='mix')
    gain = e.setting('gain', 'ampdb(db)', db='output')
    outputs = []
    for side, y in [('left', 200), ('right', 800)]:
        source = ('in_' + side, 'asignal')
        clipped = e.audio('clip_' + side, '(abs(input * drive + 1) - abs(input * drive - 1)) / 2',
                          x=300, y=y, input=source, drive=drive)
        held = e.node('hold_' + side, 'fold', 650, y)
        e.wire(clipped, held[0], 'asig')
        e.wire(('downsample', 'iout'), held[0], 'kincr')
        quant = e.audio('quant_' + side, 'floor(input * q + 0.5) / q', x=1000, y=y, input=held, q=q)
        # Clamp positive full scale to the largest signed B-bit code, 1 - 1/Q.
        limited = e.audio('limit_' + side, '(input + 1 - 1 / q - abs(input - (1 - 1 / q))) / 2',
                          x=1300, y=y, input=quant, q=q)
        outputs.append(e.audio('mix_' + side, '(dry * (1 - mix) + wet * mix) * gain',
                               x=1650, y=y, dry=source, wet=limited, mix=mix, gain=gain))
    return e.finish(*outputs)


def harmonizer():
    e = Effect('Harmonizer', 'hz', [
        ('interval1', 'Voice 1 Interval (semitones)', -24, 24, 7),
        ('interval2', 'Voice 2 Interval (semitones)', -24, 24, 12),
        ('level1', 'Voice 1 Level', 0, 1, 0.7), ('level2', 'Voice 2 Level', 0, 1, 0.5),
        ('mix', 'Mix', 0, 1, 0.5), ('output', 'Output (dB)', -24, 0, -6),
    ], 'Two fixed spectral harmony voices, independently processing each stereo channel. '
       'Intervals round to semitones; no key detection or formant preservation. '
       'Dry and wet paths have 1536-sample latency (32 ms at 48 kHz), including Mix 0. '
       'Voice levels are normalized when their sum exceeds 1. Mix 1 is a wet send return.')
    levels = [e.setting(f'weight{v}', f'{numerator} / ((1 + a + b + abs(1 - a - b)) / 2)',
                        a='level1', b='level2') for v, numerator in [(1, 'a'), (2, 'b')]]
    mix = e.setting('mix_audio', 'mix', mix='mix')
    gain = e.setting('gain', 'ampdb(db)', db='output')
    outputs = []
    for side, y in [('left', 200), ('right', 1000)]:
        source = ('in_' + side, 'asignal')
        analysis = e.node('analysis_' + side, 'pvsanal', 300, y, ifftsize=1024, ioverlap=256, iwinsize=1024, iwintype=1)
        e.wire(source, analysis[0], 'ain')
        voices = []
        for v in (1, 2):
            shifted = e.node(f'shift{v}_{side}', 'pvscale', 650, y + (v - 1) * 300, kkeepform=0, kgain=1, kcoefs=80)
            e.wire(analysis, shifted[0], 'fsigin')
            e.formula(shifted[0], 'kscal', f'ampdb({OCTAVE_DB} * floor(interval + 0.5) / 12)',
                      interval=(f'interval{v}', 'iout'))
            voice = e.node(f'voice{v}_{side}', 'pvsynth', 950, y + (v - 1) * 300)
            e.wire(shifted, voice[0], 'fsrc')
            voices.append(voice)
        dry = e.node('dry_' + side, 'delay', 950, y - 150)
        e.wire(source, dry[0], 'asig')
        e.formula(dry[0], 'idlt', '1536 / sr')
        outputs.append(e.audio('mix_' + side, '(dry * (1 - mix) + (v1 * w1 + v2 * w2) * mix) * gain',
                               x=1600, y=y, dry=dry, v1=voices[0], v2=voices[1],
                               w1=levels[0], w2=levels[1], mix=mix, gain=gain))
    return e.finish(*outputs)


if __name__ == '__main__':
    folder = Path(__file__).resolve().parent
    for build in (widener, crusher, harmonizer):
        patch = build()
        CompilerService(OpcodeService('/static/icons')).compile_patch(patch, '0', 'none')
        raw = patch.model_dump(mode='json', by_alias=True, exclude={'created_at', 'updated_at'})
        stem = patch.name.lower().replace(' ', '_')
        (folder / f'{stem}.patch.json').write_text(json.dumps(raw, indent=2, ensure_ascii=False) + '\n')
        native = ExportedPatchDefinition(sourcePatchId=patch.id, **patch.model_dump(exclude={'id'}))
        (folder.parent / (patch.name.replace(' ', '_') + '.orch.instrument.json')).write_text(
            json.dumps(native.model_dump(mode='json', by_alias=True), indent=2, ensure_ascii=False) + '\n')
        print('Compiled and exported', patch.name)
