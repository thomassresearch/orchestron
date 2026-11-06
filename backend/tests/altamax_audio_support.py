"""Native source reference, independent of the graph builder and examples."""

from pathlib import Path

import numpy as np

from backend.app.engine.ctcsound_loader import load_ctcsound_module


def reference(name, notes, seconds, ksmps=1):
    source = (Path(__file__).parent / "fixtures/csound/altamax.orc").read_text()
    number = {"enough": 1, "logan": 2}[name]
    score = "\n".join(f'i {number} {t} {duration} {440 * 2 ** ((note - 69) / 12)} {velocity / 127}'
                      for t, note, velocity, duration in notes)
    cs = load_ctcsound_module().Csound()
    buffered = hasattr(cs, "createMessageBuffer")
    if buffered:
        cs.createMessageBuffer(False)
    csd = ("<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n<CsInstruments>\n"
           f"sr=48000\nksmps={ksmps}\nnchnls=2\n0dbfs=1\n{source}\n</CsInstruments>\n"
           f"<CsScore>\nf 0 {seconds + 1}\n{score}\n</CsScore>\n</CsoundSynthesizer>")
    try:
        assert cs.compileCsdText(csd) == 0
        assert cs.start() == 0
        blocks = []
        for _ in range(0, round(seconds * 48000), cs.ksmps()):
            assert cs.performKsmps() == 0
            blocks.append(cs.spout().copy().reshape(-1, 2))
        return np.concatenate(blocks)
    finally:
        cs.cleanup()
        if buffered:
            cs.destroyMessageBuffer()
        cs.reset()
