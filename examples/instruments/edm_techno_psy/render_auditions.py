#!/usr/bin/env python3
"""Render the compiled graphs with real MIDI and check audio/controller behavior.

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

from build_pack import HERE, build, fingerprint, write_json

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


def pattern(slug, bpm=144, velocity=110):
    beat = 60 / bpm
    if slug in ("psy_rotor_bass", "rubber_core_fm_bass"):
        # Two bars at each of 138 and 150 BPM, including the characteristic kick gap.
        notes, cursor = [], .2
        for tempo in (bpm, 150):
            step = 60 / tempo / 4
            for index in range(32):
                if index % 4:
                    pitch = [40, 40, 43, 38][index // 8]
                    notes.append((cursor + index * step, step * .65, pitch,
                                  velocity if index % 4 == 1 else max(1, velocity - 16)))
            cursor += 32 * step
        return notes
    if slug == "undertow_motion_pad":
        return [(start, 3.5, note, velocity) for start, chord in
                ((.2, (48, 55, 58, 62)), (5, (43, 50, 53, 57))) for note in chord]
    if slug == "furnace_techno_stab":
        return [(.2 + index * beat * .75, beat * .28, note, velocity)
                for index in range(12) for note in ((48, 55, 58, 62) if index < 6 else (43, 50, 53, 57))]
    pitches = [64, 71, 67, 74, 64, 76, 67, 71] if slug == "prism_fm_pluck" else [52, 64, 59, 67, 52, 71, 55, 64]
    return [(.2 + index * beat * .5, beat * .3, pitches[index % 8],
             velocity if index % 4 == 0 else max(1, velocity - 18)) for index in range(24)]


def check_instrument(item):
    slug, payload = item
    orc = (HERE / "validation" / f"{slug}.orc").read_text()
    controls = [n for n in payload["graph"]["nodes"] if n["opcode"] == "perf_controller"]
    max_release = max([.1] + [n["params"]["max"] for n in controls if "release" in n["id"]])
    notes = pattern(slug, bpm=138)
    end = max(start + duration for start, duration, _, _ in notes) + max_release + 1
    result = dict(payload_sha256=fingerprint(payload), cases={}, controller_effects={})
    variants = {"default": {}}
    for control in controls:
        for extreme in ("min", "max"):
            variants[f"{control['id']}_{extreme}"] = {control["id"]: control["params"][extreme]}
    for extremes in itertools.product(("min", "max"), repeat=3):
        variants["corner_" + "_".join(extremes)] = {
            c["id"]: c["params"][extreme] for c, extreme in zip(controls, extremes)}
    with tempfile.TemporaryDirectory(prefix=f"orchestron_{slug}_") as folder_name:
        folder = Path(folder_name)
        minimum_samples = {}
        for name, overrides in variants.items():
            samples, metrics, csd_path, midi_path = render(orc, controls, overrides, notes, end, folder)
            result["cases"][name] = metrics
            if len(overrides) == 1 and name.endswith("_min"):
                minimum_samples[next(iter(overrides))] = samples
            if len(overrides) == 1 and name.endswith("_max"):
                id = next(iter(overrides))
                difference = float(np.max(np.abs(samples - minimum_samples.pop(id))))
                result["controller_effects"][id] = dict(max_difference=difference, passed=difference > 1e-4)
            if name == "default":
                audition_dir = HERE / "auditions"
                audition_dir.mkdir(exist_ok=True)
                pcm_wave(audition_dir / f"{slug}.wav", samples)
                shutil.copyfile(csd_path, audition_dir / f"{slug}.csd")
                shutil.copyfile(midi_path, audition_dir / f"{slug}.mid")

        # Three registers, velocity response, short and sustained note-off.
        low, middle, high = (28, 40, 55) if "bass" in slug else (48, 64, 84)
        for note in (low, middle, high):
            for velocity in (40, 80, 127):
                duration = 3 if slug == "undertow_motion_pad" else .4
                test_notes = [(.2, duration, note, velocity)]
                _, metrics, _, _ = render(orc, controls, {}, test_notes,
                    duration + max_release + 1.2, folder)
                result["cases"][f"note_{note}_velocity_{velocity}"] = metrics
            assert result["cases"][f"note_{note}_velocity_40"]["rms"] < result["cases"][f"note_{note}_velocity_80"]["rms"] < result["cases"][f"note_{note}_velocity_127"]["rms"]

        for duration in (.015, 4):
            _, metrics, _, _ = render(orc, controls, {}, [(.2, duration, middle, 110)],
                duration + max_release + 1.2, folder)
            result["cases"][f"note_off_{duration}s"] = metrics

        if slug in ("rubber_core_fm_bass", "prism_fm_pluck", "alloy_sequence_voice"):
            for name, overrides in variants.items():
                if not name.startswith("corner_"):
                    continue
                _, metrics, _, _ = render(orc, controls, overrides, [(.2, .5, high, 127)],
                    .7 + max_release + 1, folder)
                result["cases"][f"high_register_{name}"] = metrics

        if slug == "psy_rotor_bass":
            repeated, metrics, _, _ = render(orc, controls, {},
                [(.2, .06, 40, 110), (.4, .06, 40, 110)], 1, folder)
            difference = float(np.max(np.abs(repeated[9600:14400] - repeated[19200:24000])))
            result["phase_reset"] = dict(max_difference=difference, passed=difference < 1e-6)
            result["cases"]["phase_reset"] = metrics

        # A timbre change mid-note must leave the held voice intact and affect the next note.
        timbre = next(c for c in controls if any(s in c["id"] for s in ("tone", "color", "clang")))
        duration, second = (3, 7) if slug == "undertow_motion_pad" else (.5, 2)
        test_notes = [(.2, duration, middle, 110), (second, duration, middle, 110)]
        end = second + duration + max_release + 1
        reference, _, _, _ = render(orc, controls, {}, test_notes, end, folder)
        changed, metrics, _, _ = render(orc, controls, {}, test_notes, end, folder,
            changes=[(.3, timbre["id"], timbre["params"]["max"])])
        first_error = float(np.max(np.abs(reference[:int(second * SR)] - changed[:int(second * SR)])))
        new_error = float(np.max(np.abs(reference[int(second * SR):] - changed[int(second * SR):])))
        result["note_initialization"] = dict(held_note_max_difference=first_error,
            new_note_max_difference=new_error, passed=first_error < 1e-9 and new_error > 1e-5)
        result["cases"]["channel_change"] = metrics
    result["passed"] = (all(c["passed"] for c in result["cases"].values())
                        and all(c["passed"] for c in result["controller_effects"].values())
                        and result.get("phase_reset", {"passed": True})["passed"]
                        and result["note_initialization"]["passed"])
    print(f"{slug}: {'PASS' if result['passed'] else 'FAIL'}, {len(result['cases'])} renders, "
          f"default peak {result['cases']['default']['peak_dbfs']:.1f} dBFS, "
          f"worst peak {max(c['peak'] for c in result['cases'].values()):.3f}", flush=True)
    return slug, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", help="Only validate this instrument slug")
    args = parser.parse_args()
    payloads = build()
    if args.instrument:
        payloads = {args.instrument: payloads[args.instrument]}
    compiled = json.loads((HERE / "validation" / "compile_results.json").read_text())
    for slug, payload in payloads.items():
        if compiled[slug]["payload_sha256"] != fingerprint(payload):
            raise SystemExit(f"Recompile changed graph before rendering: {slug}")
    with ThreadPoolExecutor(max_workers=3) as pool:
        report = dict(pool.map(check_instrument, payloads.items()))
    report_path = HERE / "validation" / "audio_report.json"
    previous = json.loads(report_path.read_text()) if args.instrument and report_path.exists() else {}
    write_json(report_path, {**previous, **report})
    if not all(r["passed"] for r in report.values()):
        raise SystemExit("Audio checks failed; inspect validation/audio_report.json")


if __name__ == "__main__":
    main()
