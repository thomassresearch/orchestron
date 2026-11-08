"""Versioned real performance snapshot; never read a developer library or examples."""
import json
from pathlib import Path

from backend.app.models.audio import AudioGraph, MixerState
from backend.app.models.patch import PatchDocument
from backend.app.services.compiler_common import PatchInstrumentTarget


def lake_inputs():
    data = json.loads((Path(__file__).parent / 'fixtures/parallel_render/evening_at_the_lake.json').read_text())
    targets = [PatchInstrumentTarget(
        PatchDocument.model_validate(data['patches'][item['patch_id']]), item['midi_channel'], item['id'],
        item['midi_channel'] == 0, performance_controller_values=item['performance_controller_values'],
        performance_controller_midi_ccs=item['performance_controller_midi_ccs']) for item in data['instruments']]
    return targets, AudioGraph.model_validate(data['audio_graph']), MixerState.model_validate(data['mixer'])


def lake_events():
    """All nine MIDI channels, retriggers/releases and cross-channel CC fan-out."""
    targets, _, _ = lake_inputs()
    events = []
    for beat in range(4):
        for target in targets:
            if not target.midi_channel:
                continue
            channel = target.midi_channel - 1
            note = 36 + beat if channel >= 9 else 55 + beat
            events.extend([(beat * 12000, [0x90 + channel, note, 75]),
                           (beat * 12000 + 8000, [0x80 + channel, note, 0]),
                           (beat * 12000 + 4001, [0xB0 + channel, 1, 30 + beat * 20])])
    return sorted(events, key=lambda event: event[0])
