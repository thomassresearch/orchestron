"""Standard MIDI and actual SoundFont piano rendering."""
from pathlib import Path
import shutil
import subprocess

import mido


def write_midi(notes: list[dict], tempo: float, meter: tuple[int, int], length: float, path: Path,
               piano_program: int = 0, piano_bank: int = 0) -> None:
    if not 0 <= piano_program <= 127 or not 0 <= piano_bank <= 16383:
        raise ValueError("Piano program must be 0–127 and bank 0–16383")
    midi = mido.MidiFile(type=0, ticks_per_beat=960)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo)))
    track.append(mido.MetaMessage("time_signature", numerator=meter[0], denominator=meter[1]))
    track.append(mido.Message("control_change", channel=0, control=0, value=piano_bank//128))
    track.append(mido.Message("control_change", channel=0, control=32, value=piano_bank % 128))
    track.append(mido.Message("program_change", channel=0, program=piano_program))
    events = []
    for n in notes:
        if not 0 <= n["midi_pitch"] <= 127:
            raise ValueError(f"Pitch outside MIDI range: {n['midi_pitch']}")
        for key, kind, priority in (("start_beat", "note_on", 1), ("end_beat", "note_off", 0)):
            events.append((round(n[key]*960), priority,
                           mido.Message(kind, channel=0, note=n["midi_pitch"],
                                        velocity=n["velocity"] if kind == "note_on" else 0)))
    last = 0
    for tick, _, event in sorted(events, key=lambda event: event[:2]):
        event.time = tick-last
        track.append(event)
        last = tick
    track.append(mido.MetaMessage("end_of_track", time=max(0, round(length*960)-last)))
    midi.save(path)


def render(midi: Path, wav: Path, soundfont: Path, executable: str = "fluidsynth") -> None:
    import soundfile as sf

    binary = shutil.which(executable)
    if not binary:
        raise ValueError("FluidSynth is missing; install it, then run sung-melody render")
    if not soundfont.is_file():
        raise ValueError(f"Piano SoundFont is missing: {soundfont}")
    # Paths are individual arguments, including fonts with spaces. No shell or device playback.
    command = [binary, "-ni", "-F", str(wav.resolve()), "-T", "wav", "-O", "s16", "-r", "44100",
               "-g", "0.6", "-R", "0", "-C", "0", str(soundfont.resolve()), str(midi.resolve())]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("FluidSynth rendering timed out after 180 seconds") from exc
    if result.returncode or not wav.is_file():
        raise ValueError(f"FluidSynth render failed: {(result.stderr+result.stdout)[-2000:]}")
    audio, sr = sf.read(wav)
    if sr != 44100 or not len(audio) or abs(audio).max() < 1e-7:
        raise ValueError("FluidSynth produced empty or silent audio; verify the MIDI bank/program exists in the piano SoundFont")
