"""Deterministic CC-driven audio probes, using the actual MIDI/SCORE compiler."""
from pathlib import Path
from tempfile import TemporaryDirectory

import mido

from backend.tools.stereo_delay_audio import compile_probe, render_probe


def render_capture(patch, source, events=(), *, seconds=None, mode='midi', ksmps=32, values=None):
    """Events are (seconds, channel 1–16, CC, value); include explicit stop resets."""
    seconds = seconds or len(source) / 48000
    artifact = compile_probe(patch, values=values, ksmps=ksmps, mode=mode)
    if mode == 'score':
        score = '\n'.join(f'i 9000 {time:.9f} .001 {(channel-1)*128+cc} {value}'
                          for time, channel, cc, value in events)
        return render_probe(artifact, source, seconds, score_events=score)
    with TemporaryDirectory(prefix='orchestron-capture-midi-') as folder:
        path=Path(folder)/'controls.mid'
        midi=mido.MidiFile(ticks_per_beat=24000)
        track=mido.MidiTrack()
        midi.tracks.append(track)
        track.append(mido.MetaMessage('set_tempo',tempo=500000,time=0))
        previous=0
        for time, channel, cc, value in sorted(events, key=lambda event: event[0]):
            tick=round(time*48000)
            track.append(mido.Message('control_change',channel=channel-1,control=cc,value=value,time=tick-previous))
            previous=tick
        track.append(mido.MetaMessage('end_of_track',time=max(1,round(seconds*48000)-previous)))
        midi.save(path)
        return render_probe(artifact, source, seconds, midi_file=path)
