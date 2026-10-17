"""Build the continuous Granular Capture effect and native instrument export."""
import json
from pathlib import Path

from backend.app.models.export import ExportedPatchDefinition
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from examples.instruments.continuous_effects.build import Effect


def build():
    effect = Effect('Granular Capture', 'gc', [
        ('channel', 'MIDI Control Channel', 1, 16, 16),
        ('cc_stutter', 'Stutter CC', 0, 95, 20),
        ('cc_freeze', 'Freeze CC', 0, 95, 21),
        ('cc_capture', 'Capture CC', 0, 95, 22),
        ('cc_granular', 'Granular CC', 0, 95, 23),
        ('slice', 'Slice (ms)', 20, 1000, 125),
        ('grain', 'Grain Size (ms)', 5, 200, 50),
        ('density', 'Grains / Second', 1, 80, 40),
        ('pitch', 'Grain Pitch (semitones)', -24, 24, 0),
        ('spread', 'Position Spread', 0, 1, .5),
        ('mix', 'Mix', 0, 1, 1),
        ('output', 'Output (dB)', -24, 0, -6),
    ], 'Stereo stutter/freeze and granular playback. MIDI channel 16: CC20 Stutter, CC21 Freeze, '
       'CC22 Capture, CC23 Granular. Switches use 0=off and 127=on. Capture needs a 0 between triggers. '
       'All switches off passes dry. Reset all four CCs to 0 on sequencer stop. '
       'Freeze holds audio indefinitely until released; rack restart clears the buffer.')
    effect.node('processor', 'stereo_capture', 1300, 500)
    for side in ('left', 'right'):
        effect.wire(('in_'+side,'asignal'), 'processor', 'a'+side)
    for index, name in enumerate(('stutter','freeze','capture','granular')):
        effect.node('midi_'+name, 'ctrl7', index * 320, 0)
        effect.formula('midi_'+name, 'ichan', 'floor(channel + 0.5)', channel=('channel','iout'))
        effect.formula('midi_'+name, 'ictlno', 'floor(cc + 0.5)', cc=('cc_'+name,'iout'))
        effect.wire(('midi_'+name,'kout'), 'processor', 'k'+name)
    for setting,port in [('slice','islice'),('grain','igrain'),('density','idensity'),('pitch','ipitch'),('spread','ispread'),('mix','imix'),('output','igain')]:
        effect.formula('processor',port,'value / 1000' if setting in ('slice','grain') else 'value', value=(setting,'iout'))
    return effect.finish(('processor','aleftout'),('processor','arightout'))


if __name__ == '__main__':
    patch = build()
    CompilerService(OpcodeService('/static/icons')).compile_patch(patch,'0','none')
    folder=Path(__file__).resolve().parent
    (folder/'granular_capture.patch.json').write_text(json.dumps(patch.model_dump(mode='json',by_alias=True,exclude={'created_at','updated_at'}),indent=2)+'\n')
    native=ExportedPatchDefinition(sourcePatchId=patch.id,**patch.model_dump(exclude={'id'}))
    (folder.parent/'Granular_Capture.orch.instrument.json').write_text(json.dumps(native.model_dump(mode='json',by_alias=True),indent=2)+'\n')
    print('Compiled and exported Granular Capture')
