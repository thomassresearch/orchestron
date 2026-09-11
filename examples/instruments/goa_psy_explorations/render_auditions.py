#!/usr/bin/env python3
"""Render the new Goa/Psy graphs in isolation and verify internal effects and tails.

Requires Csound, NumPy and mido (available in the repository .venv).
The only extra orchestra instruments route named outlets to stereo output and
change performance channels for the note-initialization regression check.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import argparse
import itertools
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import wave

import mido
import numpy as np

from build_pack import HERE, build, designs, fingerprint, write_json

SR = 48000


def midi_file(path, notes, end):
    midi = mido.MidiFile(ticks_per_beat=960)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000))
    events = []
    for start, duration, note, velocity in notes:
        events.extend([(round(start * 1920), 1, note, velocity),
                       (round((start + duration) * 1920), 0, note, 0)])
    previous = 0
    for tick, on, note, velocity in sorted(events):
        track.append(mido.Message("note_on" if on else "note_off", channel=0,
                                  note=note, velocity=velocity, time=tick - previous))
        previous = tick
    track.append(mido.MetaMessage("end_of_track", time=max(0, round(end * 1920) - previous)))
    midi.save(path)


def read_float_wave(path):
    raw = path.read_bytes()
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"
    offset, fmt, data = 12, None, None
    while offset + 8 <= len(raw):
        tag, size = struct.unpack_from("<4sI", raw, offset)
        chunk = raw[offset + 8:offset + 8 + size]
        if tag == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", chunk)
        elif tag == b"data":
            data = chunk
        offset += 8 + size + size % 2
    assert fmt and fmt[0] in (3, 65534) and fmt[1] == 2 and fmt[2] == SR and fmt[5] == 32, fmt
    return np.frombuffer(data, dtype="<f4").reshape(-1, 2).astype(np.float64)


def pcm_wave(path, samples):
    assert np.max(np.abs(samples)) < 1
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes(np.rint(samples * 32767).astype("<i2").tobytes())


def channel_for(orc, id):
    match = re.search(r'\bi_' + re.escape(id) + r'_iout_\d+ chnget "([^"]+)"', orc)
    if not match:
        raise ValueError(f"Missing compiled controller {id}")
    return match.group(1)


def render(orc, controls, overrides, notes, end, folder, changes=None):
    for id, value in overrides.items():
        channel = channel_for(orc, id)
        orc, count = re.subn(r'chnset [^,\n]+, "' + re.escape(channel) + '"',
                            f'chnset {value:.17g}, "{channel}"', orc)
        assert count == 1
    # Numeric source instrument remains identical to the backend's MIDI compiler.
    routing = '\nconnect 1, "left", 999, "left"\nconnect 1, "right", 999, "right"\nalwayson 999\n'
    master = '\ninstr 999\naLeft inleta "left"\naRight inleta "right"\nouts aLeft, aRight\nendin\n'
    score = ["f 1 0 16384 10 1", f"f 0 {end}"]
    setters = ""
    for index, (when, id, value) in enumerate(changes or []):
        number = 900 + index
        setters += f'\ninstr {number}\nchnset p4, "{channel_for(orc, id)}"\nendin\n'
        score.append(f"i {number} {when} 0.001 {value}")
    midi_path, csd_path, wav_path = folder / "input.mid", folder / "render.csd", folder / "render.wav"
    midi_file(midi_path, notes, end)
    csd = "\n".join(["<CsoundSynthesizer>", "<CsOptions>", "-d -m0", "</CsOptions>",
        "<CsInstruments>", orc + routing + master + setters, "</CsInstruments>",
        "<CsScore>", *score, "e", "</CsScore>", "</CsoundSynthesizer>"])
    csd_path.write_text(csd)
    proc = subprocess.run(["csound", "-W", "-f", "-F", str(midi_path), "-o", str(wav_path), str(csd_path)],
                          capture_output=True, text=True, timeout=60)
    if proc.returncode:
        raise RuntimeError(proc.stderr)
    samples = read_float_wave(wav_path)
    metrics = dict(peak=float(np.max(np.abs(samples))),
        peak_dbfs=float(20 * np.log10(max(1e-15, np.max(np.abs(samples))))),
        rms=float(np.sqrt(np.mean(samples * samples))),
        channel_rms=np.sqrt(np.mean(samples * samples, axis=0)).tolist(),
        tail_peak=float(np.max(np.abs(samples[-4800:]))),
        max_sample_step=float(np.max(np.abs(np.diff(samples, axis=0)))),
        dc=float(np.max(np.abs(np.mean(samples, axis=0)))),
        finite=bool(np.all(np.isfinite(samples))))
    metrics["passed"] = (metrics["finite"] and .00001 < metrics["peak"] < .9
                         and min(metrics["channel_rms"]) > .000001 and metrics["tail_peak"] < .0001)
    return samples, metrics, csd_path, midi_path


def pattern(slug):
    if slug == "mandala_acid_lead":
        pitches = [52, 59, 55, 64, 53, 60, 56, 65]
        return [(.2 + index * 60 / 145 / 4, .075, pitches[index % 8], 110 if index % 4 == 0 else 90)
                for index in range(32)]
    if slug == "orbit_fm_bleeps":
        return [(start, .055, pitch, 110) for start, pitch in ((.2, 64), (1, 71), (1.65, 67), (3.1, 76), (4.3, 62))]
    if slug == "chakra_vowel_talker":
        return [(.2, 1.7, 52, 105), (2.6, 1.4, 55, 110), (4.8, .65, 59, 100)]
    if slug == "astral_laser_zaps":
        return [(start, .16, pitch, 112) for start, pitch in ((.2, 48), (1.35, 60), (2.65, 55), (4.15, 67))]
    if slug == "mycelium_stepped_bubbles":
        return [(.2, 2.2, 48, 108), (3.3, 1.8, 55, 103)]
    return [(.2, 3.1, 43, 108), (7.2, 2.7, 50, 112)]


def rms(samples):
    return float(np.sqrt(np.mean(samples * samples)))


def check_instrument(item):
    slug, payload = item
    design = designs()[slug]
    orc = (HERE / "validation" / f"{slug}.orc").read_text()
    controls = [n for n in payload["graph"]["nodes"] if n["opcode"] == "perf_controller"]
    space = next(n["id"] for n in controls if n["id"].endswith("_space"))
    tail = design["tail"]
    notes = pattern(slug)
    end = max(t + d for t, d, _, _ in notes) + tail + .7
    result = dict(payload_sha256=fingerprint(payload), cases={}, controller_effects={})
    variants = {"default": {}}
    for c in controls:
        for extreme in ("min", "max"):
            variants[f"{c['id']}_{extreme}"] = {c["id"]: c["params"][extreme]}
    for extremes in itertools.product(("min", "max"), repeat=3):
        variants["corner_" + "_".join(extremes)] = {
            c["id"]: c["params"][extreme] for c, extreme in zip(controls, extremes)}

    with tempfile.TemporaryDirectory(prefix=f"goa_psy_{slug}_") as folder_name:
        folder = Path(folder_name)
        minimum = {}
        for name, overrides in variants.items():
            samples, metrics, csd, midi = render(orc, controls, overrides, notes, end, folder)
            result["cases"][name] = metrics
            if len(overrides) == 1 and name.endswith("_min"):
                minimum[next(iter(overrides))] = samples
            elif len(overrides) == 1 and name.endswith("_max"):
                id = next(iter(overrides))
                difference = float(np.max(np.abs(samples - minimum.pop(id))))
                result["controller_effects"][id] = dict(max_difference=difference, passed=difference > 1e-4)
            if name == "default":
                destination = HERE / "auditions"
                destination.mkdir(exist_ok=True)
                pcm_wave(destination / f"{slug}.wav", samples)
                shutil.copyfile(csd, destination / f"{slug}.csd")
                shutil.copyfile(midi, destination / f"{slug}.mid")
                result["stereo_motion"] = float(np.max(np.abs(samples[:, 0] - samples[:, 1])))

        pitches = (43, 60, 79)
        if slug == "orbit_fm_bleeps":
            pitches = (48, 64, 84)
        elif slug in ("astral_laser_zaps", "mycelium_stepped_bubbles"):
            pitches = (36, 55, 76)
        elif slug == "event_horizon_riser":
            pitches = (36, 55, 72)
        duration = 2.8 if slug == "event_horizon_riser" else .6
        for note in pitches:
            for velocity in (40, 80, 127):
                _, metrics, _, _ = render(orc, controls, {}, [(.2, duration, note, velocity)],
                                          .2 + duration + tail + .7, folder)
                result["cases"][f"note_{note}_velocity_{velocity}"] = metrics
            assert result["cases"][f"note_{note}_velocity_40"]["rms"] < result["cases"][f"note_{note}_velocity_80"]["rms"] < result["cases"][f"note_{note}_velocity_127"]["rms"]

        # The dry excitation must stop quickly; local FX must continue audibly.
        short_duration = .35 if slug == "event_horizon_riser" else .045
        short_notes = [(.2, short_duration, pitches[1], 115)]
        dry, dry_metrics, _, _ = render(orc, controls, {space: 0}, short_notes,
            .2 + short_duration + tail + .7, folder)
        wet, wet_metrics, _, _ = render(orc, controls, {space: 1}, short_notes,
            .2 + short_duration + tail + .7, folder)
        late_start = .2 + short_duration + design["spec"]["envelope"]["release"] + .12
        late_end = min(.2 + short_duration + tail - .3, late_start + 1.1)
        late = slice(round(late_start * SR), round(late_end * SR))
        dry_rms, wet_rms = rms(dry[late]), rms(wet[late])
        result["internal_tail"] = dict(dry_late_rms=dry_rms, wet_late_rms=wet_rms,
            passed=dry_rms < 1e-6 and wet_rms > 1e-5 and wet_rms > dry_rms * 100)
        result["cases"].update(short_dry=dry_metrics, short_with_fx=wet_metrics)

        # Four simultaneous notes at maximum velocity and maximum internal FX.
        chord = [(.2, .25 if slug != "event_horizon_riser" else 3, n, 127) for n in (48, 55, 58, 62)]
        _, metrics, _, _ = render(orc, controls, {space: 1}, chord,
                                  max(t+d for t,d,_,_ in chord) + tail + .7, folder)
        result["cases"]["four_voice_fx"] = metrics
        _, metrics, _, _ = render(orc, controls, {c["id"]: c["params"]["max"] for c in controls}, chord,
                                  max(t+d for t,d,_,_ in chord) + tail + .7, folder)
        result["cases"]["four_voice_all_max"] = metrics
        # Full low/high controller corners in the upper playing register.
        for extreme in ("min", "max"):
            overrides = {c["id"]: c["params"][extreme] for c in controls}
            _, metrics, _, _ = render(orc, controls, overrides, [(.2, duration, pitches[-1], 127)],
                                      .2 + duration + tail + .7, folder)
            result["cases"][f"high_register_{extreme}"] = metrics

        # Changing an initialized parameter must preserve the current note and its tail.
        changing = controls[0]
        second = 1.2 + tail
        test_notes = [(.2, .75, pitches[1], 110), (second, .75, pitches[1], 110)]
        end = second + .75 + tail + .7
        reference, _, _, _ = render(orc, controls, {}, test_notes, end, folder)
        changed, metrics, _, _ = render(orc, controls, {}, test_notes, end, folder,
            changes=[(.3, changing["id"], changing["params"]["max"])])
        boundary = round(second * SR)
        first_error = float(np.max(np.abs(reference[:boundary] - changed[:boundary])))
        second_error = float(np.max(np.abs(reference[boundary:] - changed[boundary:])))
        result["note_initialization"] = dict(held_note_and_tail_difference=first_error,
            new_note_difference=second_error, passed=first_error < 1e-9 and second_error > 1e-5)
        result["cases"]["channel_change"] = metrics

    result["passed"] = (all(c["passed"] for c in result["cases"].values())
        and all(c["passed"] for c in result["controller_effects"].values())
        and result["internal_tail"]["passed"] and result["note_initialization"]["passed"]
        and result["stereo_motion"] > 1e-4)
    print(f"{slug}: {'PASS' if result['passed'] else 'FAIL'}; {len(result['cases'])} cases; "
          f"default {result['cases']['default']['peak_dbfs']:.1f} dBFS; "
          f"wet/dry late RMS {wet_rms:.6f}/{dry_rms:.6f}", flush=True)
    return slug, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument")
    args = parser.parse_args()
    payloads = build()
    if args.instrument:
        payloads = {args.instrument: payloads[args.instrument]}
    compiled = json.loads((HERE / "validation/compile_results.json").read_text())
    for slug, payload in payloads.items():
        assert compiled[slug]["payload_sha256"] == fingerprint(payload), f"Recompile changed graph: {slug}"
    with ThreadPoolExecutor(max_workers=3) as pool:
        report = dict(pool.map(check_instrument, payloads.items()))
    path = HERE / "validation/audio_report.json"
    previous = json.loads(path.read_text()) if args.instrument and path.exists() else {}
    write_json(path, {**previous, **report})
    if not all(r["passed"] for r in report.values()):
        raise SystemExit("Audio checks failed; inspect validation/audio_report.json")


if __name__ == "__main__":
    main()
