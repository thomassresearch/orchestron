"""Compare audio and time real concurrent notes through the production mixer and host MIDI."""

import argparse
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from time import perf_counter
import wave

import numpy as np

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.dx7 import describe_voice, read_sysex
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.guitar_audio_support import compile_guitars, note_events, render

SR = 48000
FIXTURES = Path(__file__).resolve().parents[2] / "backend/tests/fixtures/dx7"


def instrument(path):
    patch = load_patch_fixture("dx7")
    (voice,) = read_sysex(path.read_bytes())
    next(n for n in patch.graph.nodes if n.opcode == "fm_dx7").params["voice"] = describe_voice(voice)["voice"]
    return patch


def level(signal):
    return 10 * np.log10(max(1e-20, np.mean(signal**2)))


def spectrum(signal):
    frames = np.lib.stride_tricks.sliding_window_view(signal, 1024)[::512]
    amplitude = np.mean(abs(np.fft.rfft(frames * np.hanning(1024))), axis=0)
    return amplitude / max(1e-20, np.linalg.norm(amplitude))


def compare(path, reference, out):
    patch = instrument(path)
    artifact, targets = compile_guitars([patch], mode="host", ksmps=32)
    cases, examples = [], []
    with TemporaryDirectory() as tmp:
        raw = Path(tmp) / "ref.f32"
        for key in [48, 60, 84]:
            for velocity in [40, 112]:
                for gate in [3072, 30720]:  # exact Mark I 64-sample boundaries
                    samples = gate + 18432
                    start = 3072
                    event = note_events([(start / SR, key, velocity, gate / SR)])
                    audio, _ = render(artifact, targets, event, (samples + start) / SR, mode="host")
                    udo = audio[start : start + samples, 0]
                    subprocess.run([reference, path, str(key), str(velocity), str(gate), str(samples), raw], check=True)
                    dex = np.fromfile(raw, "<f4").astype(float)
                    # Remove the known graph gain and equal-power pan only. Preserve dynamics.
                    dex *= 10 ** (-12 / 20) / (6 * np.sqrt(2))
                    if len(dex) != samples or min(max(abs(dex)), max(abs(udo))) < 1e-6:
                        raise ValueError("Missing or silent audio")
                    attack = slice(0, 3072)
                    tail = slice(gate, gate + 6144)
                    body = slice(gate // 2, gate)
                    cases.append(
                        dict(
                            key=key,
                            velocity=velocity,
                            gate_ms=gate / SR * 1000,
                            attack_cosine=float(spectrum(udo[attack]) @ spectrum(dex[attack])),
                            body_cosine=float(spectrum(udo[body]) @ spectrum(dex[body])),
                            body_db_delta=level(udo[body]) - level(dex[body]),
                            release_db_delta=(level(udo[tail]) - level(udo[body]))
                            - (level(dex[tail]) - level(dex[body])),
                        )
                    )
                    if key == 60 and gate == 30720:
                        examples.extend([udo, np.zeros(SR // 5), dex, np.zeros(SR // 2)])
    audio = np.concatenate(examples)
    with wave.open(str(out / (path.stem + ".wav")), "wb") as wav:
        wav.setparams((1, 2, SR, 0, "NONE", "PCM"))
        wav.writeframes(np.round(audio / max(abs(audio)) * 0.85 * 32767).astype("<i2").tobytes())
    return cases


def polyphony(path, count):
    artifact, _ = compile_guitars([instrument(path)], mode="host", ksmps=32)
    # massign 1, 1 maps MIDI channel one to the compiled patch instrument.
    observer = 'instr dx7_probe\nkCount active 1\nchnset kCount, "dx7_count"\nendin\nalwayson "dx7_probe"'
    csd = f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0 -M0\n</CsOptions>\n<CsInstruments>\n{artifact.orc}\n{observer}\n</CsInstruments>\n<CsScore>\nf 0 10\n</CsScore>\n</CsoundSynthesizer>"
    module = load_ctcsound_module()
    cs = module.Csound()
    worker = CsoundWorker()
    worker._ctcsound = module
    worker._configure_host_midi_callbacks(cs)
    durations = []
    peaks = []
    try:
        if cs.compileCsdText(csd) or cs.start():
            raise RuntimeError("Csound benchmark failed to start")
        for note in range(48, 48 + count):
            worker._midi_scheduler.enqueue(bytes((0x90, note, 96)), source="dx7-bench", target_engine_sample=0)
        for chunk in range(385):
            before = perf_counter()
            for block in range(16):
                start = chunk * 512 + block * 32
                worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + 32)
                if cs.performKsmps():
                    raise RuntimeError("Unexpected end of performance")
            durations.append(perf_counter() - before)
            active = cs.controlChannel("dx7_count")[0]
            if active != count:
                raise AssertionError(f"Only {active} of {count} voices active")
            peaks.append(np.max(abs(cs.spout())))
        if max(peaks) < 1e-5:
            raise AssertionError("Silent chord")
    finally:
        cs.cleanup()
        cs.reset()
    return dict(
        voices=count,
        rendered_seconds=len(durations) * 512 / SR,
        realtime_factor=len(durations) * 512 / SR / sum(durations),
        p99_ms=float(np.percentile(durations, 99) * 1000),
        max_ms=max(durations) * 1000,
        attack_ms=durations[0] * 1000,
        late_chunks=sum(t > 512 / SR for t in durations),
        late_after_attack=sum(t > 512 / SR for t in durations[1:]),
        peak=float(max(peaks)),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(exist_ok=True, parents=True)
    result = {}
    for path in sorted(FIXTURES.glob("*.syx")):
        result[path.stem] = dict(
            comparison=compare(path, args.reference.resolve(), args.output),
            timing=[polyphony(path, n) for n in (8, 16)],
        )
    (args.output / "results.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
