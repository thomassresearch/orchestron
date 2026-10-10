"""Render and measure the authored effect; does not edit the running library."""

import argparse
import json
from pathlib import Path

import numpy as np

from build import CONTROLS, build_patch
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute, MixerState
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.tools.tube_overdrive_audio import compile_probe, load_patch, metrics, render_probe, write_float_wav


SR = 48000
BYPASS = dict(chorus_mix=0, flanger_mix=0, delay_mix=0, output_level=0)


def guitar_audition(source, effect, values, seconds=22):
    """Render the provided guitar through the actual stereo mixer insert path."""
    source = source.model_copy(deep=True)
    source.graph.engine_config.ksmps = 32
    source.graph.engine_config.control_rate = SR / 32
    routes = []
    for side in ("left", "right"):
        for identity, origin, dest, kwargs in [
            ("send", "source", "effect", dict(kind="insert", sourceStage="raw")),
            ("return", "effect", "source", dict(kind="insert", targetStage="strip")),
            ("master", "source", "$master", dict(kind="main")),
        ]:
            routes.append(AudioRoute(id=f"{identity}-{side}", sourceId=origin, sourcePort=side,
                                     targetId=dest, targetPort=side, **kwargs))
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        [PatchInstrumentTarget(source, 1, assignment_id="source"),
         PatchInstrumentTarget(effect, 0, assignment_id="effect", always_on=True,
                               performance_controller_values=values)],
        midi_input="0", rtmidi_module="none", performance_input_mode="score",
        profile=CompilationProfile.LIVE,
        audio_graph=AudioGraph(routes=routes, masterId="$master", insertOwners={"effect": "source"}),
        mixer=MixerState(),
    )
    ref = artifact.manifest["instrumentReferences"]["source"]
    # Original minor-key arpeggio, bass-register notes, retriggers and a chord.
    notes = [(0.15 + i * 0.35, n, [85, 103, 92, 112][i % 4], 0.6)
             for i, n in enumerate([40, 52, 55, 59, 50, 54, 57, 62, 40, 52, 55, 59])]
    notes += [(4.8 + i * 0.012, n, 92, 0.8) for i, n in enumerate([45, 52, 57, 60, 64])]
    notes += [(6 + i * 0.22, 59, 90, 0.16) for i in range(4)]
    score = "\n".join(f"i {ref} {t} {d} {n} {v}" for t, n, v, d in notes)
    csd = (f"<CsoundSynthesizer>\n<CsOptions>\n-n -d -m0\n</CsOptions>\n<CsInstruments>\n{artifact.orc}"
           f"\n</CsInstruments>\n<CsScore>\n{score}\nf 0 {seconds + 1}\n</CsScore>\n</CsoundSynthesizer>")
    cs = load_ctcsound_module().Csound()
    try:
        assert cs.compileCsdText(csd) == 0 and cs.start() == 0
        frames = []
        for _ in range(round(seconds * SR / cs.ksmps())):
            assert cs.performKsmps() == 0
            frames.append(cs.spout().copy().reshape(-1, 2))
        return np.concatenate(frames), notes
    finally:
        cs.cleanup()
        cs.reset()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path("output/cure-guitar-fx"))
    parser.add_argument("--guitar", type=Path, help="Optional existing native guitar bundle for a musical audition.")
    parser.add_argument("--reuse-renders", action="store_true",
                        help="Reuse this unchanged patch's existing chord WAVs after a validation-script-only edit.")
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    patch = build_patch()
    settings = {"default": {}, "bypass": BYPASS,
                "minimum": {c[0]: c[2] for c in CONTROLS},
                "maximum": {c[0]: c[3] for c in CONTROLS}}
    for identity, _, low, high, _, _ in CONTROLS:
        settings[f"{identity}_min"] = {identity: low}
        settings[f"{identity}_max"] = {identity: high}
    report, retained = {}, {}
    # Same input and 50-second window for all comparisons, including maximum
    # feedback at a one-second delay; no per-render normalization.
    for label, values in settings.items():
        path = args.out_dir / f"chord_{label}.wav"
        if args.reuse_renders and path.exists():
            samples = np.frombuffer(path.read_bytes(), dtype="<f4", offset=44).reshape(-1, 2).astype(float)
            assert samples.shape == (50 * SR, 2)
        else:
            samples = render_probe(compile_probe(patch, values=values, scenario="chord"), seconds=50)
        measure = metrics(samples)
        measure.update(settings=values, channel_peaks=np.max(abs(samples), axis=0).tolist(),
                       tail_peak=float(np.max(abs(samples[-SR:]))))
        assert measure["finite"] and min(measure["channel_peaks"]) > 1e-5, label
        assert measure["tail_peak"] < 1e-6, (label, measure)
        assert measure["peak"] < 1, (label, measure)
        write_float_wav(args.out_dir / f"chord_{label}.wav", samples)
        retained[label] = samples[:SR * 5].copy()
        report[label] = measure
        print(label, measure["peak"], flush=True)
    differences = {}
    for identity, *_ in CONTROLS:
        low, high = retained[f"{identity}_min"], retained[f"{identity}_max"]
        differences[identity] = float(np.linalg.norm(high - low) / max(np.linalg.norm(low), np.linalg.norm(high)))
        assert differences[identity] > 0.005, (identity, differences[identity])

    dry = retained["bypass"]
    for side in (0, 1):
        np.testing.assert_allclose(dry[:, side], dry[:, 1 - side], atol=1e-12)
    # At unity bypass, change every otherwise bypassed control: output must be identical.
    altered = {c[0]: c[3] for c in CONTROLS} | BYPASS
    other = render_probe(compile_probe(patch, values=altered, scenario="chord"), seconds=5)
    np.testing.assert_allclose(dry, other, atol=3e-8)
    # A plain inlet-to-outlet wire in the same insert path is the unity reference.
    passthrough = patch.model_copy(deep=True)
    graph = passthrough.graph.model_dump(mode="json")
    graph["nodes"] = [n for n in graph["nodes"] if n["opcode"] in ("inleta", "outleta")]
    graph["connections"] = [dict(from_node_id=f"input_{side}", from_port_id="asignal",
                                  to_node_id=f"output_{side}", to_port_id="asignal")
                             for side in ("left", "right")]
    graph["ui_layout"]["input_formulas"] = {}
    passthrough.graph = type(passthrough.graph).model_validate(graph)
    direct = render_probe(compile_probe(passthrough, scenario="chord"), seconds=5)
    bypass_error = float(np.max(abs(dry - direct)))
    assert bypass_error < 3e-8, bypass_error

    silence = render_probe(compile_probe(patch, scenario="silence"), seconds=5)
    isolated = render_probe(compile_probe(patch, right=False), seconds=5)
    assert np.max(abs(silence)) < 1e-12
    assert np.max(abs(isolated[:, 1])) < 1e-12

    # A short burst makes repeats separable: first arrival must be 350 ms,
    # with successive peaks following the requested 35% feedback ratio.
    echoes = render_probe(compile_probe(patch, values=BYPASS | dict(delay_mix=100)),
                          seconds=5, note_seconds=0.03)
    peaks = [float(np.max(abs(echoes[round(t * SR):round((t + .085) * SR)])))
             for t in (.35, .7, 1.05)]
    assert np.max(abs(echoes[:round(.349 * SR)])) < 1e-12
    np.testing.assert_allclose([peaks[1] / peaks[0], peaks[2] / peaks[1]], [.35, .35], atol=.003)
    write_float_wav(args.out_dir / "echo_timing.wav", echoes)

    modes = {}
    for mode in ("midi", "score"):
        audio = render_probe(compile_probe(patch, mode=mode, ksmps=1, scenario="chord"), seconds=8)
        assert np.isfinite(audio).all() and min(np.max(abs(audio), axis=0)) > 1e-5
        modes[mode] = metrics(audio)
    montage = np.concatenate([retained[key] for key in ("bypass", "default", "chorus_mix_max", "flanger_mix_max", "delay_mix_max", "maximum")])
    write_float_wav(args.out_dir / "control_comparison.wav", montage)
    summary = dict(passed=True, sample_rate=SR, runs=report, controller_relative_differences=differences,
                   bypass_null_error=bypass_error, silence_peak=float(np.max(abs(silence))),
                   isolated_right_peak=float(np.max(abs(isolated[:, 1]))), echo_peaks=peaks,
                   offline_modes=modes, listening_performed=False,
                   montage_segments=["bypass", "default", "chorus_mix_max", "flanger_mix_max", "delay_mix_max", "maximum"])
    if args.guitar:
        guitar = load_patch(args.guitar)
        dry, notes = guitar_audition(guitar, patch, BYPASS)
        wet, _ = guitar_audition(guitar, patch, {})
        for label, samples in [("guitar_dry", dry), ("guitar_effect", wet)]:
            assert np.isfinite(samples).all() and np.max(abs(samples)) < 1
            assert np.max(abs(samples[-SR:])) < 1e-6
            write_float_wav(args.out_dir / f"{label}.wav", samples)
            summary[label] = metrics(samples)
        summary["guitar_notes"] = notes
        summary["guitar_source"] = str(args.guitar)
        # Same output gain on both passages for a useful dry/effect comparison.
        comparison = np.concatenate([dry * 10 ** (-3 / 20), np.zeros((SR, 2)), wet])
        write_float_wav(args.out_dir / "guitar_dry_then_effect.wav", comparison)
    (args.out_dir / "metrics.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"passed": True, "runs": len(report), "output": str(args.out_dir)}, indent=2))


if __name__ == "__main__":
    main()
