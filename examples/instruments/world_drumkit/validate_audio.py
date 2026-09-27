"""Render the backend-compiled World Drumkit orchestra using actual MIDI events.

Usage: .venv/bin/python examples/instruments/world_drumkit/validate_audio.py OUTPUT_DIR
Requires mido, Csound, and world.orc plus compile.json in OUTPUT_DIR.
Output is floating-point stereo WAV. No playback/session/library state is changed.
"""
import json, re, subprocess, sys
from pathlib import Path
import mido

HERE=Path(__file__).resolve().parent
spec=json.loads((HERE/'World_Drumkit.spec.json').read_text())
out=Path(sys.argv[1]); orc=(out/'world.orc').read_text()
channels={key:re.search(r'i_'+key+r'_iout_\d+ chnget "([^"]+)"',orc)[1] for key in [c['id'] for c in spec['controllers']]}

def render(name,events,duration,settings=None):
    midi=mido.MidiFile(ticks_per_beat=480);track=mido.MidiTrack();midi.tracks.append(track)
    track.append(mido.MetaMessage('set_tempo',tempo=500000,time=0))
    seq=[]
    for start,note,velocity,length in events:
        seq.extend([(round(start*960),1,note,velocity),(round((start+length)*960),0,note,0)])
    last=0
    for time,on,note,vel in sorted(seq):
        track.append(mido.Message('note_on' if on else 'note_off',note=note,velocity=vel,channel=0,time=time-last));last=time
    track.append(mido.MetaMessage('end_of_track',time=max(0,round(duration*960)-last)))
    mid=out/(name+'.mid');midi.save(mid)
    code=orc
    for key,value in (settings or {}).items():
        code=re.sub(r'chnset [^,]+, "'+channels[key]+'"',f'chnset {value}, "{channels[key]}"',code)
    # Keep the authored outleta paths intact and route them to a test mixer.
    code+='\nconnect "1", "left", "999", "left"\nconnect "1", "right", "999", "right"\ninstr 999\naL inleta "left"\naR inleta "right"\nouts aL, aR\nendin\n'
    csd=out/(name+'.csd');wav=out/(name+'.wav')
    csd.write_text(f'<CsoundSynthesizer>\n<CsOptions>\n-d -m0 -W -f -o{wav} -F{mid}\n</CsOptions>\n<CsInstruments>\n{code}\n</CsInstruments>\n<CsScore>\ni 999 0 {duration}\nf 0 {duration}\ne\n</CsScore>\n</CsoundSynthesizer>\n')
    result=subprocess.run(['csound',str(csd)],capture_output=True,text=True)
    (out/(name+'.log')).write_text(result.stdout+result.stderr)
    if result.returncode: raise RuntimeError((result.stdout+result.stderr)[-5000:])
    print(name, 'rendered',flush=True)
    return dict(name=name,settings=settings or {},duration=duration,events=events)

runs=[]
runs.append(render('all_strokes',[(.1+i*1.75,v['note'],100,.04) for i,v in enumerate(spec['voices'])],101))
runs.append(render('all_strokes_hard',[(.1+i*1.75,v['note'],127,.04) for i,v in enumerate(spec['voices'])],101))
# Unassigned keys, adjacent repeated notes, and eight-way polyphony.
runs.append(render('unmapped',[(.1+i*.3,n,127,.03) for i,n in enumerate([0,35,59,69,73,94,127])],8))
runs.append(render('velocity',[(.1+i*1.8,n,vel,.04) for i,(n,vel) in enumerate((n,vel) for n in [36,42,60,64,84,85,86,87,91] for vel in [32,80,127])],54))
runs.append(render('short_trigger',[(.1,61,100,.015), (3,64,100,.015),(6,92,100,.015)],13))
runs.append(render('held_trigger',[(.1,61,100,1.5), (3,64,100,1.5),(6,92,100,1.5)],16))
runs.append(render('retrigger_polyphony',[(.1+i*.075,60 if i%2==0 else 64,110,.025) for i in range(16)]+[(2.5,n,127,.05) for n in [36,40,42,60,64,75,80,91]],11))
selection=[36,41,42,60,64,66,80,84,85,86,87,89,91,92]
events=[(.1+i*2.3,n,100,.04) for i,n in enumerate(selection)]
runs.append(render('controllers_default',events,40))
for c in spec['controllers']:
 for bound in ['min','max']:
  runs.append(render(c['id']+'_'+bound,events,40,{c['id']:c[bound]}))
# Worst practical setting combination and velocity.
runs.append(render('all_controls_max',[(.1,n,127,.04) for n in [36,40,42,60,64,75,80,91]],10,{c['id']:c['max'] for c in spec['controllers']}))
# A short musical demonstration, without changing the user's performance.
events=[]
pattern=[67,63,61,65,64,63,60,65,68,63,61,65,66,60,63,65]
for bar in range(4):
 for step,n in enumerate(pattern):
  events.append((.1+bar*3.2+step*.2,n,105 if step%4==0 else 76,.055))
 for step in range(8): events.append((.1+bar*3.2+step*.4,84,70,.04))
 for step in [0,4]: events.append((.1+bar*3.2+step*.4,36,85,.04))
 if bar%2==1: events.append((.1+bar*3.2,82,70,.04))
runs.append(render('World_Drumkit_demo',events,18))
(out/'auditions.json').write_text(json.dumps(runs,indent=2)+'\n')
