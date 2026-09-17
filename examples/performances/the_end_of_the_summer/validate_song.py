#!/usr/bin/env python3
"""Numerical and visual song checks; deliberately does not claim listening."""
from __future__ import annotations

import argparse
import json
import hashlib
from pathlib import Path
import shutil
import sys

import numpy as np
import soundfile as sf
import mido

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/scripts"))
from render_spectrograms import Settings, analyze_audio, render_images  # noqa: E402

BOUNDARIES = [0, 16, 48, 56, 88, 104, 136, 152, 168]
NAMES = ["Clouds", "Machinery", "First sunlight", "Clouds return", "Open sky",
         "Warmth within the machine", "Unwinding", "A little warmth survives"]


def db(value):
    return float(20 * np.log10(max(float(value), 1e-12)))


def metrics(path):
    samples, sr = sf.read(path, always_2d=True, dtype="float32")
    assert sr == 48000 and samples.shape[1] == 2
    assert np.isfinite(samples).all()
    report = {"sample_rate": sr, "channels": 2, "duration_seconds": len(samples) / sr,
              "peak_dbfs": db(np.max(np.abs(samples))),
              "peak_by_channel_dbfs": [db(v) for v in np.max(np.abs(samples), axis=0)],
              "rms_by_channel_dbfs": [db(v) for v in np.sqrt(np.mean(samples.astype(float)**2, axis=0))],
              "dc_by_channel": samples.mean(axis=0, dtype=float).tolist(),
              "final_second_peak_dbfs": db(np.max(np.abs(samples[-sr:]))),
              "clipped_samples": int(np.count_nonzero(np.abs(samples) >= 1)),
              "finite": True, "sections": []}
    for start, end, name in zip(BOUNDARIES[:-1], BOUNDARIES[1:], NAMES):
        a, b = round(start * 240 / 112 * sr), round(end * 240 / 112 * sr)
        block = samples[a:b]
        report["sections"].append({"name": name, "start_seconds": a / sr, "end_seconds": b / sr,
                                   "peak_dbfs": db(np.max(np.abs(block))),
                                   "rms_dbfs": db(np.sqrt(np.mean(block.astype(float)**2)))})
    assert report["peak_dbfs"] <= -6, report
    assert report["clipped_samples"] == 0
    assert max(abs(v) for v in report["dc_by_channel"]) < .001
    assert report["final_second_peak_dbfs"] < -65
    assert min(report["rms_by_channel_dbfs"]) > -60
    return samples, sr, report


def run(plots):
    reports = json.loads((HERE / "work/render_context.json").read_text())
    for mode in ("midiFile", "score"):
        folder = HERE / "work" / mode / "The_End_of_the_Summer"
        log = (folder / "render.log").read_text()
        assert "0 errors in performance" in log, log[-1000:]
        wav = folder / "The_End_of_the_Summer.wav"
        csd = folder / "The_End_of_the_Summer.csd"
        assert wav.stat().st_mtime >= csd.stat().st_mtime, "Render the current CSD first"
        samples, sr, reports[mode] = metrics(wav)
        reports[mode]["csd_sha256"] = hashlib.sha256(csd.read_bytes()).hexdigest()
        reports[mode]["wav_sha256"] = hashlib.sha256(wav.read_bytes()).hexdigest()
        print(mode, json.dumps(reports[mode]), flush=True)
    dest = HERE / "auditions"
    dest.mkdir(exist_ok=True)
    source = HERE / "work/midiFile/The_End_of_the_Summer"
    shutil.copy2(source / "The_End_of_the_Summer.wav", dest / "The_End_of_the_Summer.wav")
    shutil.copy2(source / "The_End_of_the_Summer.mid", HERE / "The_End_of_the_Summer.mid")
    notes, active, channels, timestamp = [], {}, set(), 0
    for message in mido.MidiFile(HERE / "The_End_of_the_Summer.mid"):
        timestamp += message.time
        if message.type == "note_on" and message.velocity:
            key = (message.channel, message.note)
            active[key] = active.get(key, 0) + 1
            channels.add(message.channel + 1)
            notes.append((timestamp, message.channel + 1, message.note, message.velocity))
        elif message.type == "note_off" or message.type == "note_on" and not message.velocity:
            key = (message.channel, message.note)
            active[key] = active.get(key, 0) - 1
            assert active[key] >= 0
    assert not any(active.values())
    assert channels == {1, 2, 3, 4, 5, 6, 7, 8, 10}
    assert notes[-1][0] < 164 * 240 / 112
    reports["midi_note_events"] = len(notes)
    reports["balanced_note_on_off"] = True
    samples, sr = sf.read(dest / "The_End_of_the_Summer.wav", dtype="float32", always_2d=True)
    # A short excerpt demonstrates the first change from machinery to sunlight.
    a, b = round(44 * 240 / 112 * sr), round(60 * 240 / 112 * sr)
    excerpt = samples[a:b].copy()
    ramp = np.linspace(0, 1, round(.03 * sr), dtype=np.float32)
    excerpt[:len(ramp)] *= ramp[:, None]
    excerpt[-len(ramp):] *= ramp[::-1, None]
    sf.write(dest / "First_sunlight_preview.wav", excerpt, sr, subtype="FLOAT")
    reports["actual_listening"] = "Not performed: no audio-listening tool available. Numerical and visual checks are separate."
    reports["visual_inspection"] = "Pending opening generated Mel and log-STFT images."
    if plots:
        settings = Settings(n_fft=4096, hop_length=4096, vmin=-95, vmax=-15)
        result = analyze_audio(samples, sr, settings)
        reports["overview_images"] = [str(p.relative_to(HERE)) for p in
             render_images(result, settings, dest / "The_End_of_the_Summer.wav", HERE / "validation")]
        detail_settings = Settings(n_fft=4096, hop_length=512, vmin=-95, vmax=-15)
        result = analyze_audio(excerpt, sr, detail_settings)
        reports["transition_images"] = [str(p.relative_to(HERE)) for p in
             render_images(result, detail_settings, dest / "First_sunlight_preview.wav", HERE / "validation")]
    (HERE / "validation/audio.json").write_text(json.dumps(reports, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--plots", action="store_true")
    run(parser.parse_args().plots)
