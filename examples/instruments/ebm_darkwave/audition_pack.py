#!/usr/bin/env python3
"""Render real MIDI auditions and control extrema; write measured acceptance reports."""

from __future__ import annotations
import argparse
import copy
import json
import math
import struct
import subprocess

import mido
import numpy as np

from build_pack import PACK, CompilerService, OpcodeService, PatchDocument, digest, specifications, write_json

SR = 48000
COMPILER = CompilerService(OpcodeService("/static/icons"))


def read_float_wav(path):
    raw = path.read_bytes()
    if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("Expected a RIFF WAV")
    offset = 12
    fmt = None
    audio = None
    while offset + 8 <= len(raw):
        chunk, size = struct.unpack_from("<4sI", raw, offset)
        offset += 8
        if chunk == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", raw, offset)
        elif chunk == b"data":
            audio = raw[offset : offset + size]
        offset += size + (size % 2)
    if fmt is None or audio is None or fmt[0] != 3 or fmt[1] != 2 or fmt[2] != SR or fmt[5] != 32:
        raise ValueError(f"Expected stereo 48 kHz IEEE float WAV, got {fmt}")
    return np.frombuffer(audio, dtype="<f4").reshape(-1, 2)


def midi_file(path, notes, duration):
    events = []
    for start, length, note, velocity in notes:
        events.extend([(round(start * 960), 1, note, velocity), (round((start + length) * 960), 0, note, 0)])
    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    previous = 0
    for tick, on, note, velocity in sorted(events):
        track.append(
            mido.Message("note_on" if on else "note_off", channel=0, note=note, velocity=velocity, time=tick - previous)
        )
        previous = tick
    track.append(mido.MetaMessage("end_of_track", time=max(0, round(duration * 960) - previous)))
    mid.save(path)


def render(payload, name, notes, duration, overrides=None, directory=None):
    directory = directory or PACK / "validation" / "renders" / name.split("__")[0]
    directory.mkdir(parents=True, exist_ok=True)
    wav = directory / (name + ".wav")
    midi = directory / (name + ".mid")
    csd = directory / (name + ".csd")
    midi_file(midi, notes, duration)
    temporary = copy.deepcopy(payload)
    for node in temporary["graph"]["nodes"]:
        if node["opcode"] == "perf_controller" and node["id"] in (overrides or {}):
            node["params"]["default"] = overrides[node["id"]]
    artifact = COMPILER.compile_patch(PatchDocument.model_validate(temporary), "internal:loopback", "null")
    # Route the unchanged compiled outlets into an offline monitor. Unconnected
    # outleta sinks suspend processing in Csound 6.18, so merely appending outs
    # inside the voice is not a valid audition of this graph.
    orchestra = artifact.orc.replace("massign 0, 1", 'massign 0, "PackVoice"')
    orchestra = orchestra.replace("instr 1\n", "instr PackVoice\n")
    orchestra = orchestra.replace(
        "instr PackVoice\n",
        'connect "PackVoice", "left", "PackMonitor", "left"\n'
        'connect "PackVoice", "right", "PackMonitor", "right"\n'
        'alwayson "PackMonitor"\ninstr PackVoice\n',
    )
    orchestra += '\ninstr PackMonitor\n  aleft inleta "left"\n  aright inleta "right"\n  outs aleft, aright\nendin\n'
    csd.write_text(
        "<CsoundSynthesizer>\n<CsOptions>\n-d -m0\n</CsOptions>\n<CsInstruments>\n"
        + orchestra
        + "\n</CsInstruments>\n<CsScore>\nf 1 0 16384 10 1\nf 0 "
        + str(duration)
        + "\n</CsScore>\n</CsoundSynthesizer>\n"
    )
    result = subprocess.run(
        ["csound", "-W", "-f", "-o", str(wav), "-F", str(midi), str(csd)], capture_output=True, text=True
    )
    (directory / (name + ".log")).write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(name + ": " + result.stderr[-3500:])
    audio = read_float_wav(wav).astype(np.float64)
    if not np.isfinite(audio).all():
        raise RuntimeError(name + ": nonfinite output")
    peak = float(np.max(np.abs(audio)))
    rms = np.sqrt(np.mean(audio**2, axis=0))
    tail = float(np.max(np.abs(audio[-SR:])))
    mean = np.mean(audio, axis=0)
    active = audio[np.max(np.abs(audio), axis=1) > 1e-5]
    corr = float(np.corrcoef(active.T)[0, 1]) if len(active) > 1 else 1.0
    result = {
        "file": str(wav.relative_to(PACK)),
        "peak": peak,
        "peak_dbfs": 20 * math.log10(max(peak, 1e-15)),
        "rms": rms.tolist(),
        "dc": mean.tolist(),
        "last_second_peak": tail,
        "stereo_correlation": corr,
        "duration": len(audio) / SR,
        "finite": True,
        "overrides": overrides or {},
    }
    result["passed"] = bool(peak < 1 and min(rms) > 1e-7 and tail < 1e-4 and max(abs(mean)) < 0.001)
    return result, audio


def audition(spec, payload, controls=True):
    slug = spec["design"]["slug"]
    lo, hi = spec["design"]["register"]
    long = slug in ("choir_drone", "dark_pwm_pad", "string_ensemble", "noise_metal_fx")
    base = 36 if spec["design"]["instrument_type"] == "bass" else 60
    hold = 5 if long else (3 if slug == "glass_bell" else 1)
    default_release = spec["envelope"]["release"]
    maxrelease = spec["design"]["controls"]["release"]["max"]
    tail = 12 if long else 10
    probes = [(0.25, 6, base, 100)]
    probe_duration = 6.25 + maxrelease + tail + 1
    if spec["envelope"]["sustain"] == 0:
        # Test release before a percussive envelope has already decayed to silence,
        # alongside a held note for decay/attack comparisons.
        probes = [(0.25, 0.12, base, 100), (2.25, 6, base, 100)]
        probe_duration += 2
    notes = [(0.25, hold, lo, 80), (hold + 1, hold, base, 100), (2 * hold + 2, hold, hi, 100)]
    onset = 3 * hold + 3
    if long:
        for n in [48, 55, 60, 63]:
            notes.append((onset, 5, n, 80))
        for n in [46, 53, 58, 62]:
            notes.append((onset + 3, 5, n, 80))
        end = onset + 8
    else:
        for step in range(16):
            notes.append(
                (onset + step * 0.125, 0.08, base + [0, 0, 7, 0, 12, 0, 3, 7][step % 8], 120 if step % 4 == 0 else 80)
            )
        end = onset + 2
    results = {}
    results["audition"], _ = render(payload, slug, notes, end + default_release + tail, directory=PACK / "auditions")
    velocities = []
    for vel in (40, 80, 120):
        result, audio = render(
            payload, f"{slug}__velocity_{vel}", [(0.25, hold, base, vel)], 0.25 + hold + maxrelease + tail + 1
        )
        results["velocity_" + str(vel)] = result
        start = int(0.25 * SR)
        stop = int((0.25 + hold) * SR)
        velocities.append(float(np.sqrt(np.mean(audio[start:stop] ** 2))))
    if controls:
        results["probe_default"], default_audio = render(payload, slug + "__probe_default", probes, probe_duration)
        for key, controller in spec["design"]["controls"].items():
            for boundary in ("min", "max"):
                variant = f"{slug}__{key}_{boundary}"
                result, audio = render(payload, variant, probes, probe_duration, {"ctl_" + key: controller[boundary]})
                result["difference_rms"] = float(np.sqrt(np.mean((audio - default_audio) ** 2)))
                # The sample must change when a knob is set away from its default.
                result["control_audible_change"] = bool(
                    result["difference_rms"] > 1e-7 or controller[boundary] == controller["default"]
                )
                result["passed"] &= result["control_audible_change"]
                results[key + "_" + boundary] = result
        high = {
            "ctl_" + k: c["max"]
            for k, c in spec["design"]["controls"].items()
            if k
            in (
                "drive",
                "resonance",
                "release",
                "filter_envelope",
                "fm_depth",
                "clang",
                "echo",
                "space",
                "reverb",
                "sub",
            )
        }
        stress_notes = (
            probes
            if spec["design"]["instrument_type"] == "bass"
            else [(0.25, 6, n, 120) for n in [48, 55, 60, 63]] + [(3, 6, n, 120) for n in [46, 53, 58, 62]]
        )
        results["stress"], _ = render(payload, slug + "__stress", stress_notes, 9 + maxrelease + tail + 1, high)
    report = {
        "name": payload["name"],
        "graph_sha256": digest(payload),
        "sample_rate": SR,
        "channels": 2,
        "format": "32-bit float WAV",
        "velocity_rms_40_80_120": velocities,
        "velocity_response": bool(velocities[0] < velocities[1] < velocities[2]),
        "default_headroom_6db": results["audition"]["peak"] <= 0.501187,
        "results": results,
        "spectrograms_inspected": False,
        "listened": False,
    }
    report["passed"] = bool(
        all(r["passed"] for r in results.values())
        and report["velocity_response"]
        and report["default_headroom_6db"]
        and controls
    )
    write_json(PACK / "validation" / f"{slug}.json", report)
    failures = [k for k, r in results.items() if not r["passed"]]
    print(
        f"{slug}: peak {results['audition']['peak_dbfs']:.1f} dBFS; velocities {velocities}; failures {failures}; accepted {report['passed']}",
        flush=True,
    )
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--only", nargs="+")
    p.add_argument("--quick", action="store_true")
    args = p.parse_args()
    for spec in specifications(args.only):
        payload = json.loads((PACK / "graphs" / (spec["design"]["slug"] + ".patch.json")).read_text())
        audition(spec, payload, not args.quick)


if __name__ == "__main__":
    main()
