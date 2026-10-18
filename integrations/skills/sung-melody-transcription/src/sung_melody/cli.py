"""Local CLI; no Orchestron services, imports or runtime state."""
import argparse
from collections import Counter
from dataclasses import asdict, replace
import json
import os
from pathlib import Path
import sys

import numpy as np

from .notes import acoustic_events, edit, refine, segment
from .output import render, write_midi
from .pitch import HOP, SAMPLE_RATE, fetch_model, infer_pitch, sha256
from .rhythm import beat_fit, parse_meter, quantize
from .scale import fit_scales


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def summary(document: dict) -> str:
    scales = document["scale"]["tied_candidates"]
    names = "; ".join(f"{c['name']} ({c['tuning_cents']:+.1f} cents)" for c in scales)
    counts = Counter(e["kind"] for e in document["edits"])
    lines = [f"{len(document['notes'])} notes; {document['rhythm']['tempo']:.2f} BPM; "
             f"{document['meter']}; {document['phrase_beats']:g} quarter-note beats.",
             f"Tied best pitch collections: {names}.",
             "Tuning is the recording's offset from concert pitch; the piano preview uses concert pitch.",
             "Edits: "+(", ".join(f"{kind}: {count}" for kind, count in counts.items()) or "none")+"."]
    if document["scale"]["ambiguous_pitch_mapping"]:
        lines.append("Tied fits disagree on notes; the preview uses the documented candidate. Review the alternatives.")
    lines.extend(document["warnings"])
    lines.append("Review the piano preview against the recording, especially attacks, short gestures and phrase ending.")
    return "\n".join(lines)+"\n"


def transcribe(args) -> dict:
    import librosa

    meter = parse_meter(args.meter)
    if not np.isfinite(args.voicing_threshold) or not 0 < args.voicing_threshold < 1:
        raise ValueError("Voicing threshold must be between 0 and 1")
    # Validate before loading an expensive model or creating an output directory.
    beat_fit(np.array([]), args.tempo, args.beat_zero)
    if args.bars is not None and not 1 <= args.bars <= 1024:
        raise ValueError("Bar count must be 1–1024")
    if not 0 <= args.piano_program <= 127 or not 0 <= args.piano_bank <= 16383:
        raise ValueError("Piano program must be 0–127 and bank 0–16383")
    if args.output.exists():
        raise ValueError("Output directory exists; choose a new directory to preserve the earlier transcription")
    if not args.model:
        raise ValueError("Supply --model or SUNG_MELODY_RMVPE_MODEL; see sung-melody fetch-model")
    if not args.soundfont:
        raise ValueError("Supply --soundfont or SUNG_MELODY_SOUNDFONT for the piano WAV preview")
    audio, _ = librosa.load(args.audio, sr=SAMPLE_RATE, mono=True, duration=601)
    if len(audio) > SAMPLE_RATE*600:
        raise ValueError("Use a phrase recording of at most 10 minutes")
    if len(audio) < 1024 or not np.all(np.isfinite(audio)) or np.max(np.abs(audio)) < 1e-7:
        raise ValueError("Recording is too short, silent or contains non-finite samples")
    f0, confidence = infer_pitch(audio, Path(args.model), args.device)
    claps, attacks = acoustic_events(audio, SAMPLE_RATE, HOP, detect_claps=args.claps != "none")
    edits = []
    detected = segment(f0, confidence, claps, attacks, edits, args.voicing_threshold)
    if not detected:
        raise ValueError("No voiced notes detected; check the recording and voicing threshold")
    refined = refine(detected, edits)
    # Recompute merged medians directly from continuous voiced frames, not medians of medians.
    for i, note in enumerate(refined):
        left, right = round(note.start*100), round(note.end*100)
        values = f0[left:right][(confidence[left:right] > args.voicing_threshold) & (f0[left:right] > 0)]
        pitch = float(np.median(69+12*np.log2(values/440)))
        if abs(pitch-note.pitch) > 1e-7:
            updated = replace(note, pitch=pitch)
            edit(edits, "robust_pitch_reestimate", [note], [updated], "Median over original voiced frames of merged note")
            refined[i] = updated
    scale = fit_scales([n.pitch for n in refined])
    selected = scale["selected_for_preview"]
    snapped = []
    for n, pitch in zip(refined, selected["midi_pitches"]):
        updated = replace(n, pitch=float(pitch))
        if abs(n.pitch-pitch) > 1e-7:
            edit(edits, "tuning_and_scale", [n], [updated],
                 f"Joint fit: recording tuning {selected['tuning_cents']:+.3f} cents; concert-pitch MIDI")
        snapped.append(updated)
    beat = beat_fit(claps, args.tempo, args.beat_zero)
    notes, length = quantize(snapped, beat, meter, args.bars, args.ending, edits, args.grid)
    duration = len(audio)/SAMPLE_RATE
    document = {"schema_version": 1, "source": {"path": str(args.audio.resolve()),
                "sha256": sha256(args.audio), "duration_seconds": duration},
                "detector": {"name": "RVC RMVPE / PyTorch", "model_sha256": sha256(Path(args.model)),
                             "frame_seconds": .01, "voicing_threshold": args.voicing_threshold,
                             "confidence": "maximum sigmoid salience; not a calibrated probability"},
                "meter": args.meter, "grid_denominator": args.grid, "requested_bars": args.bars,
                "ending": args.ending, "phrase_beats": length, "rhythm": beat, "scale": scale,
                "detected_notes": [asdict(n) for n in detected],
                "refined_notes": [asdict(n) for n in refined], "notes": notes, "edits": edits,
                "warnings": beat["warnings"], "preview": {"status": "pending",
                "soundfont": str(Path(args.soundfont).resolve()), "piano_program": args.piano_program,
                "piano_bank": args.piano_bank}}
    args.output.mkdir(parents=True)
    save_json(args.output/"notes.json", document)
    save_json(args.output/"pitch.json", {"frame_seconds": .01, "f0_hz": f0.tolist(),
              "voicing_confidence": confidence.tolist(), "vocal_attacks_seconds": attacks.tolist()})
    (args.output/"edits.txt").write_text(summary(document), encoding="utf-8")
    write_midi(notes, beat["tempo"], meter, length, args.output/"melody.mid", args.piano_program, args.piano_bank)
    try:
        render(args.output/"melody.mid", args.output/"preview.wav", Path(args.soundfont), args.fluidsynth)
    except (ValueError, OSError) as exc:
        document["preview"]["status"] = "failed"
        document["preview"]["error"] = str(exc)
        save_json(args.output/"notes.json", document)
        raise ValueError(f"{exc}. MIDI, notes and pitch data saved in {args.output}; retry with sung-melody render") from exc
    document["preview"]["status"] = "rendered"
    save_json(args.output/"notes.json", document)
    return {"output": str(args.output.resolve()), "summary": summary(document)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("fetch-model", help="Explicitly download and verify the RVC RMVPE checkpoint")
    fetch.add_argument("destination", type=Path)
    command = commands.add_parser("transcribe", help="Audio to reviewed-scale MIDI, note JSON and piano WAV")
    command.add_argument("audio", type=Path)
    command.add_argument("--output", type=Path, required=True)
    command.add_argument("--model", default=os.environ.get("SUNG_MELODY_RMVPE_MODEL"))
    command.add_argument("--soundfont", default=os.environ.get("SUNG_MELODY_SOUNDFONT"))
    command.add_argument("--fluidsynth", default="fluidsynth")
    command.add_argument("--piano-program", type=int, default=0, help="Zero-based piano preset in the SoundFont")
    command.add_argument("--piano-bank", type=int, default=0, help="MIDI bank of the piano preset")
    command.add_argument("--device", default="cpu")
    command.add_argument("--tempo", type=float, help="Quarter-note BPM; claps otherwise estimated")
    command.add_argument("--meter", default="4/4")
    command.add_argument("--bars", type=int)
    command.add_argument("--beat-zero", type=float, help="Recording time in seconds of phrase beat zero")
    command.add_argument("--ending", choices=["preserve", "hold", "rest"], default="preserve")
    command.add_argument("--grid", type=int, choices=[8, 16, 32], default=16)
    command.add_argument("--claps", choices=["auto", "none"], default="auto")
    command.add_argument("--voicing-threshold", type=float, default=.03)
    render_command = commands.add_parser("render", help="Retry FluidSynth preview from saved MIDI")
    render_command.add_argument("directory", type=Path)
    render_command.add_argument("--soundfont", default=os.environ.get("SUNG_MELODY_SOUNDFONT"))
    render_command.add_argument("--fluidsynth", default="fluidsynth")
    args = parser.parse_args()
    try:
        if args.command == "fetch-model":
            fetch_model(args.destination)
            result = {"model": str(args.destination.resolve()), "sha256": sha256(args.destination)}
        elif args.command == "render":
            if not args.soundfont:
                raise ValueError("Supply --soundfont or SUNG_MELODY_SOUNDFONT")
            document = json.loads((args.directory/"notes.json").read_text())
            render(args.directory/"melody.mid", args.directory/"preview.wav", Path(args.soundfont), args.fluidsynth)
            document["preview"].update({"status": "rendered", "soundfont": str(Path(args.soundfont).resolve())})
            document["preview"].pop("error", None)
            save_json(args.directory/"notes.json", document)
            result = {"preview": str((args.directory/"preview.wav").resolve())}
        else:
            result = transcribe(args)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (ValueError, OSError, RuntimeError) as exc:
        print(f"sung-melody: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
