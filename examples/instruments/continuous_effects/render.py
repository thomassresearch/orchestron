"""Render matching stereo probes at defaults and every controller endpoint."""

import json
from pathlib import Path

import numpy as np

from backend.tools.stereo_delay_audio import SAMPLE_RATE as SR, compile_probe, render_probe
from backend.tools.tube_overdrive_audio import load_patch, metrics, write_float_wav


def main():
    # Mono chord, distinct stereo tones, then transient/noise bursts.
    t = np.arange(2 * SR) / SR
    envelope = np.minimum(t / .02, 1) * np.minimum((2 - t) / .1, 1)
    chord = sum(np.sin(2 * np.pi * f * h * t) / h for f in (220, 277.18, 329.63)
                for h in range(1, 9)) * .018 * envelope
    stereo = np.column_stack([.1 * np.sin(2 * np.pi * 440 * t), .08 * np.sin(2 * np.pi * 660 * t)]) * envelope[:, None]
    noise = np.random.default_rng(89).uniform(-.12, .12, (len(t), 2))
    noise *= (np.exp(-20 * (t % .5)) * envelope)[:, None]
    source = np.concatenate([np.column_stack([chord, chord]), stereo, noise])
    root = Path('output/continuous-effects/audio')
    for name in ('stereo_widener', 'bit_crusher', 'harmonizer'):
        patch = load_patch(Path(__file__).with_name(name + '.patch.json'))
        output = root / name
        output.mkdir(parents=True, exist_ok=True)
        write_float_wav(output / 'source.wav', source)
        settings = {'default': {}}
        for node in patch.graph.nodes:
            if node.opcode == 'perf_controller':
                for endpoint in ('min', 'max'):
                    settings[f'{node.id}_{endpoint}'] = {node.id: node.params[endpoint]}
                    if node.id == 'sw_delay':
                        settings[f'{node.id}_{endpoint}']['sw_mono'] = 1
        # Explicitly audition the mono-widening feature with the full width range.
        if name == 'stereo_widener':
            settings['mono_wide'] = dict(sw_mono=1, sw_width=2)
        report = {}
        for label, values in settings.items():
            audio = render_probe(compile_probe(patch, values=values), source, 7)
            report[label] = dict(**metrics(audio), settings=values, tail_peak=float(np.max(abs(audio[-SR // 2:]))))
            assert np.isfinite(audio).all() and np.max(abs(audio)) < 1, (name, label)
            assert report[label]['tail_peak'] < 1e-6
            write_float_wav(output / (label + '.wav'), audio)
        (output / 'metrics.json').write_text(json.dumps(report, indent=2) + '\n')
        print(name, len(report), 'renders, max peak', max(r['peak'] for r in report.values()), flush=True)


if __name__ == '__main__':
    main()
