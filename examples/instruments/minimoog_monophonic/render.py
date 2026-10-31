"""Reproducible audio and control-boundary validation for Minimoog Monophonic.

Run from the repository root: .venv/bin/python -m examples.instruments.minimoog_monophonic.render
Outputs are generated under output/minimoog_monophonic/; no library is changed.
"""

import argparse
import json
import re
from pathlib import Path

import numpy as np

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tools.tube_overdrive_audio import metrics, write_float_wav

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parents[2] / "output" / "minimoog_monophonic"
SR = 48000
PROBES = {"pitch": ("glide_pitch", "kout"), "amp": ("amp_envelope", "kenv"),
          "filter": ("filter_envelope", "kenv"), "velocity": ("legato", "kvelocity")}
EVENTS = [(.1, .65, 48, 90), (.55, .65, 55, 110), (.95, .55, 60, 100),
          (1.75, .35, 51, 70), (2.25, .5, 48, 100), (2.75, .55, 60, 100),
          (3.65, 1.2, 48, 95), (3.95, .45, 67, 115)]


def compile_patch(patch, values=None, ksmps=32, mode="score"):
    patch = patch.model_copy(deep=True)
    patch.graph.engine_config.ksmps = ksmps
    patch.graph.engine_config.control_rate = SR / ksmps
    return CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(patch, 1, assignment_id="minimoog", performance_controller_values=values or {})],
        midi_input="0", rtmidi_module="none", performance_input_mode=mode,
        profile=CompilationProfile.OFFLINE,
        audio_graph=AudioGraph(masterId="$master", routes=[
            AudioRoute(id=side, sourceId="minimoog", sourcePort=side, targetId="$master", targetPort=side, kind="main")
            for side in ("left", "right")]), mixer=MixerState())


def render(patch, values=None, *, events=EVENTS, seconds=6, ksmps=32, mode="score"):
    artifact = compile_patch(patch, values, ksmps, mode)
    orchestra = artifact.orc
    probes = []
    for name, (node, port) in PROBES.items():
        matches = re.findall(rf"\b(k_{node}_{port}_\d+)\b", orchestra)
        variable = matches[0]
        probes.append(f'chnset {variable}, "minimoog_{name}"')
    # The marker belongs to the legato synthesis voice, not MIDI collectors.
    orchestra = orchestra.replace("rireturn", "\n".join(probes) + "\nrireturn")
    score = "\n".join(f"i 1 {t} {duration} {pitch} {velocity} {index} 1"
                      for index, (t, duration, pitch, velocity) in enumerate(events, 1)) if mode == "score" else ""
    cs = load_ctcsound_module().Csound()
    worker = CsoundWorker() if mode == "midi" else None
    if worker:
        worker._configure_host_midi_callbacks(cs)
    options = "-n -d -m0" + (" -M0" if worker else "")
    csd = (f"<CsoundSynthesizer>\n<CsOptions>\n{options}\n</CsOptions>\n<CsInstruments>\n{orchestra}\n"
           f"</CsInstruments>\n<CsScore>\nf 0 {seconds + .1}\n{score}\n</CsScore>\n</CsoundSynthesizer>")
    try:
        if cs.compileCsdText(csd) != 0 or cs.start() != 0:
            raise RuntimeError("Minimoog Csound compilation failed")
        if worker:
            messages = []
            for time, duration, pitch, velocity in events:
                messages.extend([(time, [0x90, pitch, velocity]), (time + duration, [0x80, pitch, 0])])
            for time, message in sorted(messages):
                worker._midi_scheduler.enqueue(message, source="minimoog-validation", target_engine_sample=round(time * SR))
        frames, states = [], []
        for start in range(0, round(seconds * SR), cs.ksmps()):
            if worker:
                worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + cs.ksmps())
            if cs.performKsmps() != 0:
                raise RuntimeError("Minimoog rendering ended early")
            frames.append(cs.spout().copy().reshape(-1, 2))
            states.append([cs.controlChannel(f"minimoog_{name}")[0] for name in PROBES])
        audio = np.concatenate(frames)[:round(seconds * SR)]
        assert np.isfinite(audio).all(), "Non-finite output"
        assert np.max(np.abs(audio)) < 1, "Output clips"
        return audio, np.asarray(states)
    finally:
        cs.cleanup()
        cs.reset()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="Render only the default sound")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    payload = json.loads((ROOT / "minimoog_monophonic.patch.json").read_text())
    patch = PatchDocument.model_validate(dict(id="minimoog-audition", **payload))
    report = {}

    def audition(name, values=None, **kwargs):
        audio, states = render(patch, values, **kwargs)
        write_float_wav(OUT / f"{name}.wav", audio)
        report[name] = dict(**metrics(audio), settings=values or {},
                            channel_rms=np.sqrt(np.mean(audio ** 2, axis=0)).tolist(),
                            tail_peak=float(np.max(np.abs(audio[-4800:]))))
        return audio, states

    default, _ = audition("minimoog_monophonic")
    assert np.min(np.sqrt(np.mean(default ** 2, axis=0))) > .001, "Missing output channel"
    assert np.max(np.abs(default[-4800:])) < 1e-6, "Default release did not end"
    if not args.quick:
        audition("contour_timing_default", seconds=16)
        for node in payload["graph"]["nodes"]:
            if node["opcode"] != "perf_controller":
                continue
            for boundary in ("min", "max"):
                values = {node["id"]: node["params"][boundary]}
                # Activate dependent controls so endpoint auditions exercise them.
                if node["id"].startswith("noise_"):
                    values.setdefault("noise_enabled", 1)
                    values.setdefault("noise_level", .7)
                if node["id"] in ("mod_amount", "mod_mix", "osc_mod", "filter_mod"):
                    values.update(osc3_range=0, osc3_keyboard=0, osc3_enabled=0)
                    values.setdefault("mod_amount", .5)
                    values.setdefault("osc_mod", 1)
                    values.setdefault("filter_mod", 1)
                # Ten seconds of release are allowed after the final note.
                seconds = 16 if node["id"].endswith(("attack", "decay")) else 6
                audition(f"{node['id']}_{boundary}", values, seconds=seconds)
        for number in (1, 2, 3):
            for wave in range(1, 7):
                audition(f"osc{number}_wave_{wave}", {
                    **{f"osc{i}_enabled": int(i == number) for i in (1, 2, 3)},
                    f"osc{number}_wave": wave, f"osc{number}_level": .8,
                    "cutoff": 8000, "contour": 0, "resonance": 0,
                })
        for label, values in {
            "vibrato": dict(osc3_range=0, osc3_keyboard=0, osc3_enabled=0, osc_mod=1, mod_amount=.06),
            "filter_wah": dict(osc3_range=0, osc3_keyboard=0, osc3_enabled=0, filter_mod=1, mod_amount=.4),
            "maximum_drive": dict(mixer_drive=5, osc1_level=1, osc2_level=1, osc3_level=1,
                                  noise_enabled=1, noise_level=1, output_volume=1, resonance=1),
            "mixer_silence": dict(osc1_enabled=0, osc2_enabled=0, osc3_enabled=0, noise_enabled=0),
        }.items():
            audio, _ = audition(label, values)
            if label == "mixer_silence":
                assert np.max(np.abs(audio)) < 1e-10

        for cutoff in (20, 900, 8000, 20000):
            for resonance in (0, 1):
                audition(f"stress_{cutoff}_{resonance}", dict(
                    cutoff=cutoff, resonance=resonance, contour=0, mixer_drive=5,
                    osc1_level=1, osc2_level=1, osc3_level=1, noise_enabled=1,
                    noise_level=1, output_volume=1, velocity_amount=0, amp_sustain=1,
                    osc1_wave=6, osc2_wave=6, osc3_wave=6),
                    events=[(.1, .6, 24, 127), (.8, .6, 84, 127)], seconds=2)

        # One sustained phrase, an overlapping upper note, held-note fallback,
        # then a separate phrase. Check both event delivery paths/control rates.
        phrase_events = [(.1, 1.8, 48, 100), (.6, .6, 60, 100), (2.2, .5, 55, 100)]
        for mode in ("score", "midi"):
            for ksmps in (1, 32):
                _, states = audition(f"legato_{mode}_{ksmps}", {"legato_time": .1},
                                     events=phrase_events, seconds=3.2, ksmps=ksmps, mode=mode)
                at = lambda time: states[round(time * SR / ksmps)]
                # Absolute octaves: MIDI 48 -> 7, MIDI 60 -> 8.
                assert abs(at(.3)[0] - 7) < .001, "First note swoops from an unrelated pitch"
                assert abs(at(.7)[0] - 7.5) < .02, "Legato half-time does not match control"
                assert abs(at(1.3)[0] - 7.5) < .03, "Held-note fallback did not glide back"
                assert abs(at(2.21)[0] - (7 + 7/12)) < .001, "Separate phrase retained old pitch"
                for name, column in (("loudness", 1), ("filter", 2)):
                    assert abs(at(.59)[column] - at(.61)[column]) < .01, f"{name} retriggered on overlap"
                assert at(2.201)[1] < .6, "Gap failed to retrigger envelope"
        velocity_rms = []
        for velocity in (35, 120):
            audio, _ = audition(f"velocity_{velocity}", {"velocity_amount": 1},
                                events=[(.1, 1, 48, velocity)], seconds=1.6)
            velocity_rms.append(float(np.sqrt(np.mean(audio ** 2))))
        assert velocity_rms[1] > velocity_rms[0] * 2.5, "Velocity sensitivity ineffective"
        report["verification"] = dict(controller_endpoint_renders=80, isolated_waveform_renders=18,
                                      legato_paths=["score/1", "score/32", "midi/1", "midi/32"],
                                      velocity_rms=velocity_rms, listened=False)
    (OUT / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    (OUT / "events.json").write_text(json.dumps(EVENTS, indent=2) + "\n")
    print(json.dumps(dict(renders=len(report) - int("verification" in report),
                         default=report["minimoog_monophonic"], output=str(OUT)), indent=2))


if __name__ == "__main__":
    main()
