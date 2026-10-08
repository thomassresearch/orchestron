"""Native DSP harness shared by fixture tests and the guitar authoring audition.

This module accepts patch documents; it never reads developer examples.
"""

from pathlib import Path
import re
from tempfile import TemporaryDirectory

import mido
import numpy as np

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.ctcsound_loader import load_ctcsound_module
from backend.app.models.audio import AudioGraph, AudioRoute
from backend.app.services.compiler_common import CompilationProfile, PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_export_service import CapturedMidiEvent, PerformanceExportService


def note_events(notes, channel=0):
    """Notes are (start seconds, MIDI note, velocity, duration seconds)."""
    events = []
    for start, note, velocity, duration in notes:
        events.extend([(start, bytes([0x90 + channel, note, velocity])),
                       (round(start + duration, 9), bytes([0x80 + channel, note, 0]))])
    # Balanced off/on at a boundary; same-time note-ons retain authored order.
    return sorted(events, key=lambda e: (e[0], bool(e[1][0] & 0x10)))


def compile_guitars(patches, *, mode="score", settings=None, ksmps=None):
    settings = settings or [{} for _ in patches]
    targets, routes = [], []
    for index, (patch, values) in enumerate(zip(patches, settings, strict=True)):
        patch = patch.model_copy(deep=True)
        block = ksmps if ksmps is not None else (16 if mode == "host" else 1)
        patch.graph.engine_config.ksmps = block
        patch.graph.engine_config.control_rate = 48000 / block
        identity = f"guitar{index}"
        targets.append(PatchInstrumentTarget(patch=patch, midi_channel=index + 1, assignment_id=identity,
                                             performance_controller_values=values))
        for side in ("left", "right"):
            routes.append(AudioRoute(id=f"{identity}_{side}", sourceId=identity, sourcePort=side,
                                     targetId="$output", targetPort=side))
    artifact = CompilerService(OpcodeService("/static/icons")).compile_patch_bundle(
        targets, midi_input="0", rtmidi_module="none", performance_input_mode="score" if mode == "score" else "midi",
        profile=CompilationProfile.LIVE if mode == "host" else CompilationProfile.OFFLINE,
        audio_graph=AudioGraph(routes=routes),
    )
    return artifact, targets


def observed_orchestra(orc):
    index = 0

    def observe(match):
        nonlocal index
        body = match.group(0)
        if "k_guitar_pitch_kout_" not in body:
            return body
        pitch = re.search(r"\b(k_guitar_pitch_kout_\d+) =", body)[1]
        contact = re.search(r"\b(k_guitar_contact_env_kenv_\d+) linseg", body)[1]
        velocity = re.search(r"\b(i_velocity_ampmidi_iamp_\d+) =|\b(i_velocity_ampmidi_iamp_\d+) ampmidi", body)
        velocity = next(v for v in velocity.groups() if v)
        phrase = "k_vcs_legato_phrase" if "VCS_LEGATO_PHRASE:" in body else "0"
        controls = re.findall(r'\b(i_guitar_\w+_iout_\d+) chnget "[^"]+"', body)
        values = {"pitch": pitch, "phrase": phrase, "contact": contact, "velocity": f"k({velocity})"}
        for control in controls:
            key = re.match(r"i_(guitar_\w+)_iout_\d+", control)[1]
            values[key] = f"k({control})"
        trace = "\n".join(f'chnset {value}, "guitar_test_{index}_{key}"' for key, value in values.items())
        marker = "rireturn" if "VCS_LEGATO_PHRASE:" in body else "endin"
        body = body.replace(marker, trace + "\n" + marker)
        index += 1
        return body

    return re.sub(r"(?ms)^instr .*?^endin", observe, orc)


def render(artifact, targets, events, seconds, *, mode="score", trace=False, controller_updates=()):
    events = sorted(events, key=lambda e: e[0])
    orc = observed_orchestra(artifact.orc) if trace else artifact.orc
    if mode == "score":
        exporter = PerformanceExportService(compiler_service=None, gen_asset_service=None)
        lines, warnings = exporter._build_score_lines(
            events=[CapturedMidiEvent(t, msg, i) for i, (t, msg) in enumerate(events)],
            targets=targets, duration_seconds=seconds, manifest=artifact.manifest,
        )
        assert not warnings, warnings
        score = "\n".join(lines) + f"\nf 0 {seconds + 1}"
    else:
        score = f"f 0 {seconds + 1}"
    with TemporaryDirectory(prefix="orchestron-guitar-") as temporary:
        options = "-n -d -m0"
        if mode == "midi":
            midi = mido.MidiFile(ticks_per_beat=24000)
            track = mido.MidiTrack()
            midi.tracks.append(track)
            previous = 0
            for time, data in events:
                tick = round(time * 48000)
                message = mido.Message.from_bytes(data)
                message.time = tick - previous
                track.append(message)
                previous = tick
            path = Path(temporary) / "audition.mid"
            midi.save(path)
            options += f" --midifile={path}"
        elif mode == "host":
            options += " -M0"
        cs = load_ctcsound_module().Csound()
        buffered_messages = hasattr(cs, "createMessageBuffer")
        if buffered_messages:
            cs.createMessageBuffer(False)
        worker = CsoundWorker() if mode == "host" else None
        if worker:
            worker._configure_host_midi_callbacks(cs)
        csd = (f"<CsoundSynthesizer>\n<CsOptions>\n{options}\n</CsOptions>\n<CsInstruments>\n{orc}"
               f"\n</CsInstruments>\n<CsScore>\n{score}\n</CsScore>\n</CsoundSynthesizer>")
        audio, observations = [], []
        pending = list(controller_updates)
        try:
            result = cs.compileCsdText(csd)
            if result:
                messages = []
                while buffered_messages and cs.messageCnt():
                    messages.append(cs.firstMessage())
                    cs.popFirstMessage()
                raise AssertionError("".join(messages) or "Csound compilation failed; see engine diagnostics.")
            assert cs.start() == 0
            if worker:
                for t, msg in events:
                    worker._midi_scheduler.enqueue(msg, source="guitar-audition", target_engine_sample=round(t * 48000))
            block = cs.ksmps()
            names = ["pitch", "phrase", "contact", "velocity", "guitar_pick", "guitar_slide"]
            for start in range(0, round(seconds * 48000), block):
                while pending and pending[0][0] * 48000 <= start:
                    _, channel, value = pending.pop(0)
                    cs.setControlChannel(channel, value)
                if worker:
                    worker._prepare_host_midi_block(block_start_sample=start, block_end_sample=start + block)
                assert cs.performKsmps() == 0
                audio.append(cs.spout().copy().reshape(-1, 2))
                if trace:
                    observations.append([[cs.controlChannel(f"guitar_test_{i}_{key}")[0] for key in names]
                                         for i in range(len(targets))])
            return np.concatenate(audio), np.asarray(observations)
        finally:
            cs.cleanup()
            if buffered_messages:
                cs.destroyMessageBuffer()
            cs.reset()


def rms(audio):
    return float(np.sqrt(np.mean(audio ** 2)))


def db(value):
    return float(20 * np.log10(max(float(value), 1e-15)))


def fundamental(audio, expected, sr=48000):
    """Windowed peak with log-parabolic interpolation, in a band around the fundamental."""
    spectrum = np.abs(np.fft.rfft(audio * np.hanning(len(audio)))) ** 2
    frequencies = np.fft.rfftfreq(len(audio), 1 / sr)
    indices = np.flatnonzero(abs(frequencies - expected) < expected * .1)
    index = indices[np.argmax(spectrum[indices])]
    a, b, c = np.log(np.maximum(spectrum[index - 1:index + 2], 1e-30))
    peak = (index + .5 * (a - c) / (a - 2 * b + c)) * sr / len(audio)
    return float(peak)


def periodic_pitch(audio, expected, sr=48000):
    """Estimate a short fret plateau's period, without FFT bin-width limitations."""
    signal = audio - audio.mean()
    period = sr / expected
    assert len(signal) > 3 * period, "Need at least three cycles inside a stationary fret plateau."
    lags = np.arange(int(period * .9), int(period * 1.1) + 1)
    correlations = [np.dot(signal[:-lag], signal[lag:]) /
                    max(np.linalg.norm(signal[:-lag]) * np.linalg.norm(signal[lag:]), 1e-20) for lag in lags]
    index = int(np.argmax(correlations))
    assert 0 < index < len(lags) - 1, "Pitch is outside the expected semitone neighborhood."
    a, b, c = correlations[index - 1:index + 2]
    lag = lags[index] + .5 * (a - c) / (a - 2 * b + c)
    return float(sr / lag)
