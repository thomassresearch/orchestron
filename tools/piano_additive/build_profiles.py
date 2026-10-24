"""Synthesize portable HETRO profiles from the saved analytic piano, never recordings."""
import copy
import json
import sys
from pathlib import Path

import numpy as np

# Run from any directory; --out-dir receives raw authoring JSON and generated HETRO files.
import argparse
import hashlib
ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out-dir', type=Path, default=ROOT/'output/prepiano/additive_rebuild')
OUT = parser.parse_args().out_dir.resolve()
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT))
from backend.app.services.adsyn_analysis import validate_adsyn_analysis

def node(g,id,op,params,x=40,y=2400):g['nodes'].append(dict(id=id,opcode=op,params=params,position=dict(x=x,y=y)))


def ramp(x,a,b):return f'(0.5 + (abs({x} - {a:g}) - abs({x} - {b:g})) / {2*(b-a):g})'


def formula(g,target,expression,**sources):
    node,port=target.split('.')
    edges=g['connections'];edges[:]=[e for e in edges if (e['to_node_id'],e['to_port_id'])!=(node,port)]
    inputs=[]
    for token,source in sources.items():
        src,out=source.split('.');inputs.append(dict(token=token,from_node_id=src,from_port_id=out))
        edges.append(dict(from_node_id=src,from_port_id=out,to_node_id=node,to_port_id=port))
    g['ui_layout']['input_formulas'][node+'::'+port]=dict(expression=expression,inputs=inputs)
    next(n for n in g['nodes'] if n['id']==node)['params'].pop(port,None)


def interp(x,keys,values):
    # A clamped linear spline as one weighted sum of absolute values.
    # Algebraically identical to the old repeated nested clamping expression.
    values=np.asarray(values);slopes=np.diff(values)/np.diff(keys)/2
    coef=np.r_[slopes[0],np.diff(slopes),-slopes[-1]]
    return '('+f'{(values[0]+values[-1])/2:.9f}'+''.join(f' + ({c:.9f}) * abs({x} - {k:g})' for k,c in zip(keys,coef) if abs(c)>1e-10)+')'

SOURCE = json.loads((ROOT/'examples/instruments/Piano_prepiano.orch.instrument.json').read_text())
assert hashlib.sha256(json.dumps(SOURCE['graph'],sort_keys=True).encode()).hexdigest() == '18fbe56aa5a2102701674c83f6f7f6abdc4973e693f560f7a8146e69ebe2b6cf', 'The source piano changed; restore the documented source revision before rebuilding.'
SOURCE = dict(name=SOURCE['name'], description=SOURCE['description'], is_template=False,
              always_on=False, instrument_type='melody', schema_version=SOURCE['schema_version'], graph=SOURCE['graph'])
SOURCE_NODES = {n['id']: n for n in SOURCE['graph']['nodes']}
SOURCE_FORMULAS = SOURCE['graph']['ui_layout']['input_formulas']
KEYS = [24, 30, 36, 48, 57, 60, 63, 66, 69, 72, 75, 78, 81, 83]
VELOCITIES = [40, 60, 92, 124]
PARTIALS = sorted(int(n.rsplit('_', 1)[1]) for n in SOURCE_NODES
                  if SOURCE_NODES[n]['opcode'] == 'oscil3')
REFERENCE_HZ = 250.0
RETAIN = {2, 4}
FIT = json.loads((Path(__file__).resolve().parent/'fit.json').read_text())
FIT_PARTIALS = {p['partial']:p for p in FIT['partials']}
BASS_ENRICHMENT = json.loads((Path(__file__).resolve().parent/'bass_enrichment.json').read_text())
BASS_PROFILES = {(p['key'], p['velocity']): p['tracks'] for p in BASS_ENRICHMENT['profiles']}


def evaluate(target, note, velocity, **extra):
    ident, port = target.split('.')
    entry = SOURCE_FORMULAS.get(ident + '::' + port)
    if not entry:
        return SOURCE_NODES[ident]['params'][port]
    values = dict(note=note, velocity=velocity/127, hz=440*2**((note-69)/12),
                  stiffness=1, hardness=3500, strike=.09, decay=4, loss=.002,
                  env=1, abs=abs, ampdb=lambda x: 10**(x/20),
                  dbamp=lambda x: 20*np.log10(x)) | extra
    return float(eval(entry['expression'], {'__builtins__': {}}, values))


def profile(note, velocity):
    result = []
    for partial in PARTIALS:
        ident = f'piano_partial_{partial}'
        env = next(i['from_node_id'] for i in SOURCE_FORMULAS[ident+'::amp']['inputs']
                   if i['token'] == 'env')
        levels = np.array([evaluate(env+'.'+p, note, velocity) for p in ['ia','ib','ic','id','ie']])
        times = np.r_[0, np.cumsum([evaluate(env+'.'+p, note, velocity)
                                    for p in ['idur1','idur2','idur3','idur4']])]
        levels *= evaluate(ident+'.amp', note, velocity)
        # The compact patch shares four envelopes across weak upper partials.
        # HETRO can restore their individually fitted decay with no extra DSP nodes.
        # Keep the approved bass trajectory unchanged; blend into/out of the middle.
        restore = min(max((note-57)/3, 0), 1) - min(max((note-79)/4, 0), 1)
        if partial >= 12 and restore > 0:
            data = np.asarray(FIT_PARTIALS[partial]['levels_db'])
            fit_db = [np.interp(velocity, FIT['velocities'],
                               [np.interp(note,FIT['keys'],data[:,j,t]) for j in range(4)])
                      for t in range(4)]
            # Retain the current anti-alias rolloff (and velocity scale below 40).
            target = 10**(np.asarray(fit_db)/20)
            target *= levels[0]/target[0]
            levels[:4] = np.exp((1-restore)*np.log(np.maximum(levels[:4],1e-30)) +
                                restore*np.log(np.maximum(target,1e-30)))
        frequency = evaluate(ident+'.freq', note, velocity)
        ratio = frequency / (440*2**((note-69)/12))
        result.append(dict(partial=partial, times=times, levels=levels, ratio=ratio))
    return result


def breakpoints(times, levels, normalization):
    """Adaptive linear approximation of exponential curves, <=0.03 dB above floor."""
    points = {}
    def amplitude(t):
        return float(np.exp(np.interp(t/1000, times, np.log(np.maximum(levels, 1e-30)))) * normalization)
    def segment(a, b):
        va, vb = amplitude(a), amplitude(b)
        if b-a > 1:
            candidates = sorted(set(round(a+(b-a)*f) for f in [.25,.5,.75]))
            worst = max(candidates, key=lambda t: abs(amplitude(t) - (va+(vb-va)*(t-a)/(b-a))))
            actual = amplitude(worst)
            error = abs(actual - (va+(vb-va)*(worst-a)/(b-a)))
            if error > max(1.0, actual*.0034):
                segment(a, worst); segment(worst, b); return
        points[a], points[b] = round(va), round(vb)
    boundaries = [round(t*1000) for t in times]
    for a,b in zip(boundaries, boundaries[1:]):
        segment(a,b)
    points[boundaries[-1]] = 0
    return sorted(points.items())


def make_file(key, velocity):
    tracks = [t for t in profile(key, velocity) if t['partial'] not in RETAIN and max(t['levels']) > 1e-10]
    norm = 30000 / max(float(max(t['levels'])) for t in tracks)
    lines = [f'HETRO {len(tracks)}']
    for track in tracks:
        points = breakpoints(track['times'], track['levels'], norm)
        lines.append('-1,' + ','.join(f'{t},{a}' for t,a in points) + ',32767')
        frequency = round(REFERENCE_HZ*track['ratio'])
        assert 0 <= frequency <= 32767
        lines.append(f'-2,0,{frequency},13000,{frequency},32767')
    # Append only the measured missing bass components. Keep original tracks,
    # normalization and velocity-basis fitting unchanged so approved notes retain
    # their exact synthesis. C1/F#1/C2 enrichment fades to zero at the C3 anchor.
    # Use the emitted gain's precision, as in the validated offline experiment.
    extra_norm = 65536 / float(f'{65536/norm:.12f}')
    added = 0
    for track in sorted(BASS_PROFILES.get((key, velocity), []), key=lambda t: t['partial']):
        assert key <= 36 and track['partial'] <= 48 and track['partial'] not in PARTIALS
        points = breakpoints(track['times'], track['levels'], extra_norm)
        if max(amplitude for _, amplitude in points) == 0:
            continue
        frequency = round(REFERENCE_HZ * track['ratio'])
        assert 0 <= frequency <= 32767
        lines.append('-1,' + ','.join(f'{t},{a}' for t,a in points) + ',32767')
        lines.append(f'-2,0,{frequency},13000,{frequency},32767')
        added += 1
    lines[0] = f'HETRO {len(tracks) + added}'
    filename = f'piano_k{key}_v{velocity}.het'
    path = OUT/'assets'/filename
    path.write_text('\n'.join(lines)+'\n', encoding='ascii')
    validate_adsyn_analysis(path)
    return dict(asset_id=filename[:-4], original_name=filename, stored_name=filename,
                content_type='application/octet-stream', size_bytes=path.stat().st_size), 65536/norm


def weight(x, anchors, index):
    if index == 0:
        return f'(1 - {ramp(x, anchors[0], anchors[1])})'
    if index == len(anchors)-1:
        return ramp(x, anchors[-2], anchors[-1])
    return f'({ramp(x, anchors[index-1], anchors[index])} - {ramp(x, anchors[index], anchors[index+1])})'


def velocity_basis(key):
    """Keep the fewest stored velocity profiles meeting a 0.5 dB bank-error bound.

    The original four velocity calibration points remain in the gain curves.
    Dominant partials 2/4 and the physical core are excluded from this approximation.
    """
    profiles=np.array([[t['levels'][:4] for t in profile(key,v) if t['partial'] not in RETAIN]
                       for v in VELOCITIES])
    vectors=profiles.reshape(4,-1)
    for selected in [[0,3],[0,2,3],[0,1,2,3]]:
        coeff=np.zeros((4,len(selected)))
        errors=[]
        for j in range(4):
            if j in selected:
                coeff[j,selected.index(j)]=1
                errors.append(0.0)
                continue
            weights=np.tile(1/np.maximum(np.linalg.norm(profiles[j],axis=0),1e-9),profiles.shape[1])
            # Enumerate nonnegative least-squares faces; at most three columns.
            candidates=[]
            for mask in range(1,1<<len(selected)):
                active=[i for i in range(len(selected)) if mask & (1<<i)]
                cols=[selected[i] for i in active]
                c=np.linalg.lstsq(vectors[cols].T*weights[:,None],vectors[j]*weights,rcond=None)[0]
                if np.any(c<0):continue
                result=np.zeros(len(selected));result[active]=c
                distance=np.linalg.norm((vectors[selected].T@result-vectors[j])*weights)
                candidates.append((distance,result))
            coeff[j]=min(candidates,key=lambda p:p[0])[1]
            predicted=vectors[selected].T@coeff[j]
            error=np.average(abs(20*np.log10(np.maximum(predicted,1e-12)/np.maximum(vectors[j],1e-12))),weights=(vectors[j]*weights)**2)
            errors.append(float(error))
        if max(errors)<=.5:
            return [VELOCITIES[i] for i in selected],coeff,errors
    raise AssertionError('Four original profiles must reproduce their calibration points')


def build():
    (OUT/'assets').mkdir(exist_ok=True)
    p = copy.deepcopy(SOURCE)
    p['name'] = 'Piano Addiitive Synthesis'
    p['schema_version'] = 2
    p['description'] = ('Physical prepiano strings with synthetic HETRO harmonic profiles by register and velocity. '
                        'MIDI pitch/velocity and all ten original performance controls. No recordings, rubbers or rattles. '
                        'Numeric spectral reference: Alexander Holm, Salamander Grand Piano V3 (CC BY 3.0).')
    g = p['graph']
    retained_ids = {f'piano_partial_{n}' for n in RETAIN} | {f'piano_spectral_env_{n-2}' for n in RETAIN}
    remove = {n['id'] for n in g['nodes'] if (n['opcode']=='oscil3' or
              n['id'].startswith(('piano_spectral_env_', 'piano_partial_sum_'))) and n['id'] not in retained_ids}
    g['nodes'] = [n for n in g['nodes'] if n['id'] not in remove]
    g['connections'] = [e for e in g['connections'] if not {e['from_node_id'],e['to_node_id']} & remove]
    g['ui_layout']['input_formulas'] = {k:v for k,v in g['ui_layout']['input_formulas'].items()
                                      if k.split('::')[0] not in remove}
    g['control_flow'] = {}
    g['ui_layout']['control_flow_blocks'] = {}
    g['ui_layout']['adsyn_nodes'] = {}
    banks = {}
    assets = []
    audit=[]
    for ki,key in enumerate(KEYS):
        block = f'hetro_register_{key}'
        x,y = 100 + (ki%3)*1500, 3000 + (ki//3)*2000
        node(g, block, 'If', dict(rhs=1e-7), x,y)
        w = weight('note', KEYS, ki)
        formula(g, block+'.lhs', w+f' * (1 - {ramp("note",83,84)})', note='piano_note.inote')
        ids = []
        outputs = {}
        selected,coeff,errors=velocity_basis(key)
        audit.append(dict(key=key,stored_velocities=selected,gain_coefficients=coeff.tolist(),bank_error_db=errors))
        for vi,velocity in enumerate(selected):
            ident = block+f'_v{velocity}'
            asset,scale = make_file(key,velocity)
            assets.append(asset)
            node(g,ident,'adsyn',{},x+50+(vi%2)*600,y+200+(vi//2)*350)
            g['ui_layout']['adsyn_nodes'][ident] = dict(sampleAsset=asset,samplePath='')
            under='(velocity * 127 + 40 - abs(velocity * 127 - 40)) / 80'
            vgain=interp('velocity * 127',VELOCITIES,coeff[:,vi])
            formula(g,ident+'.kamod',f'{scale:.12f} * {vgain} * {w} * ({under}) * ampdb(dbamp(hardness / 3500) * 0.25 + (0.09 - strike) * 6)',
                    velocity='velocity_ampmidi.iamp',note='piano_note.inote',hardness='piano_hardness.iout',strike='piano_strike.iout')
            formula(g,ident+'.kfmod',f'hz / {REFERENCE_HZ:g}',hz='pitch_cpsmidi.kfreq')
            formula(g,ident+'.ksmod','4 / decay * (1 + loss / 0.002 * 0.25) / 1.25',
                    decay='piano_decay.iout',loss='piano_loss.iout')
            outputs[f'v{velocity}'] = ident+'.ares'
            ids.append(ident)
        result = block+'_result'
        silent = block+'_silent'
        node(g,result,'CaseResult',{},x+750,y+1050)
        node(g,silent,'CaseResult',{},x+750,y+1500)
        formula(g,result+'.left',' + '.join(outputs),**outputs)
        g['control_flow'][block] = dict(kind='if',output_format='mono',operator='>',cases=[
            dict(id=block+'_active',name=f'MIDI {key} profile',value=None,node_ids=ids+[result],result_node_id=result,silence=False),
            dict(id=block+'_off',name='Outside register',value=None,node_ids=[silent],result_node_id=silent,silence=True)])
        g['ui_layout']['control_flow_blocks'][block] = True
        banks[f'r{key}'] = block+'.left'
    node(g,'hetro_tone','pareq',dict(kq=.707,imode=2),1700,2400)
    formula(g,'hetro_tone.asig',' + '.join(banks),**banks)
    formula(g,'hetro_tone.kc','hz * 8',hz='pitch_cpsmidi.kfreq')
    formula(g,'hetro_tone.kv','ampdb(dbamp(hardness / 3500) * 1.75 + (0.09 - strike) * 64)',
            hardness='piano_hardness.iout',strike='piano_strike.iout')
    entry = g['ui_layout']['input_formulas']['output_pan2::asig']
    retained_outputs = {f'partial{n}': f'piano_partial_{n}.asig' for n in sorted(RETAIN)}
    formula(g,'output_pan2.asig',entry['expression'].replace('bank0 + bank1 + bank2 + bank3','bank + '+' + '.join(retained_outputs)),
            **{i['token']:i['from_node_id']+'.'+i['from_port_id'] for i in entry['inputs']
               if i['from_node_id'] not in remove},bank='hetro_tone.ares',**retained_outputs)
    from refine_middle import apply_middle_refinement
    middle_data = json.loads((Path(__file__).resolve().parent/'middle_refinement.json').read_text())
    middle_audit = apply_middle_refinement(p, middle_data, OUT, sys.modules[__name__])
    original_assets = assets
    assets = [cfg['sampleAsset'] for cfg in g['ui_layout']['adsyn_nodes'].values()]
    used = {asset['stored_name'] for asset in assets}
    for asset in original_assets:
        if asset['stored_name'] not in used:
            (OUT/'assets'/asset['stored_name']).unlink()
    (OUT/'middle_velocity_basis.json').write_text(json.dumps(middle_audit,indent=2)+'\n')
    (OUT/'assets.json').write_text(json.dumps(assets,indent=2)+'\n')
    (OUT/'velocity_basis.json').write_text(json.dumps(audit,indent=2)+'\n')
    (OUT/'revised.json').write_text(json.dumps(p,indent=2)+'\n')
    return p


if __name__ == '__main__':
    p=build()
    print('nodes',len(p['graph']['nodes']),'edges',len(p['graph']['connections']),
          'graph bytes',len(json.dumps(p)),'assets',sum(a['size_bytes'] for a in json.loads((OUT/'assets.json').read_text())))
