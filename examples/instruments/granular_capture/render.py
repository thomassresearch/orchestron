"""Render every setting endpoint with reproducible MIDI capture gestures."""
import json
from pathlib import Path

import numpy as np

from backend.tools.granular_capture_audio import render_capture
from backend.tools.tube_overdrive_audio import metrics, write_float_wav
from examples.instruments.granular_capture.build import build


def main():
    patch = build()
    sr = 48000
    t = np.arange(4 * sr) / sr
    chord = sum(np.sin(2*np.pi*f*t) for f in (220, 277.18, 329.63)) * .025
    signal = np.column_stack([.1*np.sin(2*np.pi*440*t), .08*np.sin(2*np.pi*660*t)])
    signal[:sr] = np.column_stack([chord[:sr], chord[:sr]])
    noise = np.random.default_rng(24).uniform(-.1, .1, (sr, 2))
    signal[2*sr:3*sr] = noise * np.exp(-20*(t[:sr] % .25))[:, None]
    signal[int(3.75*sr):] = 0
    settings = {'default': {}}
    for n in patch.graph.nodes:
        if n.opcode == 'perf_controller':
            for end in ('min', 'max'):
                settings[n.id+'_'+end] = {n.id: n.params[end]}
    output = Path('output/granular-capture')
    output.mkdir(parents=True, exist_ok=True)
    write_float_wav(output/'source.wav', signal)
    report = {}
    for name, overrides in settings.items():
        values = {n.id: n.params['default'] for n in patch.graph.nodes if n.opcode == 'perf_controller'} | overrides
        channel = round(values['gc_channel'])
        events = []
        for key, gestures in [('stutter',[(.75,127),(1.25,0)]), ('freeze',[(1.5,127),(3.5,0)]),
                              ('capture',[(2.75,127),(3,0)]), ('granular',[(2,127),(4,0)])]:
            cc = round(values['gc_cc_'+key])
            events += [(0,channel,cc,0)] + [(time,channel,cc,value) for time,value in gestures]
        audio = render_capture(patch, signal, sorted(events), seconds=4.5, values=overrides)
        assert np.isfinite(audio).all() and np.max(abs(audio)) < 1
        assert np.max(abs(audio[-sr//4:])) == 0
        write_float_wav(output/(name+'.wav'), audio)
        report[name] = dict(**metrics(audio), settings=overrides)
    (output/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(len(report), 'renders; maximum peak', max(r['peak'] for r in report.values()))


if __name__ == '__main__':
    main()
