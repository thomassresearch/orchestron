"""Frozen live rack snapshot; tests never read the developer library."""
import json
from pathlib import Path

from backend.app.models.audio import AudioGraph, MixerState
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import PatchInstrumentTarget


def grain_inputs():
    data = json.loads((Path(__file__).parent / 'fixtures/parallel_render/grain_of_salt.json').read_text())
    targets = [PatchInstrumentTarget(
        PatchDocument.model_validate(data['patches'][item['patch_id']]), item['midi_channel'], item['id'],
        item['midi_channel'] == 0, performance_controller_values=item['performance_controller_values'],
        performance_controller_midi_ccs=item['performance_controller_midi_ccs']) for item in data['instruments']]
    return targets, AudioGraph.model_validate(data['audio_graph']), MixerState.model_validate(data['mixer'])


def grain_events():
    events = []
    for beat in range(6):
        for channel in (*range(7), 9):
            note = (36 if channel == 9 else 48 + channel * 3) + beat % 3
            events.extend([(beat * 8000, [0x90 + channel, note, 80]),
                           (beat * 8000 + 14000, [0x80 + channel, note, 0]),
                           (beat * 8000 + 3001, [0xB0 + channel, 1, 30 + beat * 10])])
    return sorted(events, key=lambda event: event[0])
