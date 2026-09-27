"""Numerical checks for validate_audio.py output (requires the skill's audio extra)."""
import json, sys
from pathlib import Path
import numpy as np
import soundfile as sf
out=Path(sys.argv[1]);spec=json.loads((Path(__file__).resolve().parent/'World_Drumkit.spec.json').read_text())
runs=json.loads((out/'auditions.json').read_text()); audio={}; result={'renders':{},'voices':[],'velocity_rms':{},'controller_checks':{}}
def rms(a): return float(np.sqrt(np.mean(a*a)))
def window(name,start,length):
 a,sr=audio[name];return a[round(start*sr):round((start+length)*sr)]
for r in runs:
 a,sr=sf.read(out/(r['name']+'.wav'));audio[r['name']]=(a,sr)
 assert sr==48000 and a.ndim==2 and a.shape[1]==2
 assert np.isfinite(a).all()
 peak=float(np.max(np.abs(a)))
 assert peak<1,(r['name'],peak)
 assert np.max(np.abs(a[-sr:]))<1e-6,r['name']
 if r['name']!='unmapped': assert np.all(np.sqrt(np.mean(a*a,axis=0))>1e-6)
 # Centre pan intentionally produces identical channels.
 assert np.max(np.abs(a[:,0]-a[:,1]))<1e-7
 result['renders'][r['name']]={'peak':peak,'peak_dbfs':20*np.log10(max(peak,1e-12)),'rms':rms(a),'finite':True,'tail_peak':float(np.max(np.abs(a[-sr:])))}
for i,v in enumerate(spec['voices']):
 a=window('all_strokes',.1+i*1.75,1.6)
 assert rms(a)>0.0001,v['name']
 result['voices'].append({'note':v['note'],'name':v['name'],'rms':rms(a),'peak':float(np.max(np.abs(a)))})
assert not np.any(audio['unmapped'][0])
velrun=next(r for r in runs if r['name']=='velocity')
for start,note,vel,_ in velrun['events']:
 result['velocity_rms'].setdefault(note,[]).append(rms(window('velocity',start,1.6)))
for note,values in result['velocity_rms'].items(): assert values[0]<values[1]<values[2],(note,values)
# Short MIDI note-offs must not truncate ringing bodies.
for start in [.1,3]:
 ratio=rms(window('short_trigger',start+.06,.55))/rms(window('held_trigger',start+.06,.55))
 assert ratio>.85,ratio
result['short_trigger_tail_preserved']=True
# Confirm all controls affect the intended signal and tabla tuning is independent.
ref=audio['controllers_default'][0]
for c in spec['controllers']:
 lo=audio[c['id']+'_min'][0];hi=audio[c['id']+'_max'][0]
 assert rms(lo-ref)>1e-5 and rms(hi-ref)>1e-5,c['id']
 result['controller_checks'][c['id']]={'min_difference_rms':rms(lo-ref),'max_difference_rms':rms(hi-ref)}
for name in ['world_tabla_tuning_min','world_tabla_tuning_max']:
 assert np.max(np.abs(window(name,.1,1.5)-window('controllers_default',.1,1.5)))<1e-8
# Decay changes the energy-weighted duration of a low drum in the expected direction.
def centroid(name):
 a=window(name,.1,1.5)[:,0];e=a*a;t=np.arange(len(a))/48000;return float(np.sum(t*e)/np.sum(e))
c=[centroid(n) for n in ['world_decay_min','controllers_default','world_decay_max']]
assert c[0]<c[1]<c[2],c
result['decay_energy_centroid_seconds']=c
result['status']='passed';result['listening']='Not performed; numerical and visual inspection only.'
(out/'measurements.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':'passed','renders':len(runs),'mapped_notes':len(spec['voices']),'max_peak':max(r['peak'] for r in result['renders'].values()),'decay_centroid_seconds':c}))
