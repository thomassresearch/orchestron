"""Reproduce a warm, breathy additive flute using the patch CLI's graph spine.

No samples or new application opcodes. Build/preflight first, audition with
validate_audio.py, then publish. API writes never touch other library patches.
"""
import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / 'integrations/skills/orchestron-patch-creator/src'))
sys.path.insert(0, str(ROOT))
from orchestron_patch.cli.orchestron_patch_cli import (
    ApiClient, DEFAULT_API_URL, build_patch_payload, compile_payload_preflight,
    validate_graph_invariants,
)

CONTROLS = [
    ('flute_attack', 'Attack (s)', .015, .18, .06, 'logarithmic'),
    ('flute_release', 'Release (s)', .08, 1.2, .38, 'logarithmic'),
    ('flute_breath', 'Breath', 0, 1, .38, 'linear'),
    ('flute_tone', 'Tone (Hz)', 1000, 7500, 3600, 'logarithmic'),
    ('flute_vibrato', 'Vibrato (cents)', 0, 15, 7, 'linear'),
]
SPEC = {
    'name': 'Lake Bamboo Flute',
    'description': 'Soft, sample-free bamboo-flute-inspired voice: sine-dominant bore, '
        'gentle upper harmonics, filtered breath and delayed 5.1 Hz vibrato. Velocity '
        'shapes loudness and harmonic colour. Best A3–D6. Five per-instance controls; '
        'stereo outlet pair, no internal reverb. Designed for Evening at the Lake.',
    'family': 'simple_osc',
    'envelope': {'attack': .06, 'decay': .22, 'sustain': .84, 'release': .38},
    'layers': [{'id': 'seed', 'opcode': 'oscili', 'gain': .4, 'table': -1}],
    'output': {'pan': .5},
}


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + '\n')


def build():
    from backend.app.models.patch import PatchCreateRequest
    payload = build_patch_payload(SPEC)
    graph = payload['graph']
    graph['engine_config'].update(sr=48000, ksmps=32, control_rate=1500)
    graph['nodes'] = [n for n in graph['nodes'] if not n['id'].startswith('seed_')]
    graph['connections'] = [e for e in graph['connections']
        if not e['from_node_id'].startswith('seed_') and not e['to_node_id'].startswith('seed_')]
    nodes, edges = graph['nodes'], graph['connections']
    formulas = graph['ui_layout'].setdefault('input_formulas', {})
    def node(id, opcode, params, x, y):
        nodes.append(dict(id=id, opcode=opcode, params=params, position=dict(x=x, y=y)))
    def formula(dst, expression, **inputs):
        target, port = dst.split('.')
        edges[:] = [e for e in edges if (e['to_node_id'], e['to_port_id']) != (target, port)]
        bindings = []
        for token, source in inputs.items():
            n, p = source.split('.')
            edges.append(dict(from_node_id=n, from_port_id=p, to_node_id=target, to_port_id=port))
            bindings.append(dict(token=token, from_node_id=n, from_port_id=p))
        formulas[target+'::'+port] = dict(expression=expression, inputs=bindings)
        next(n for n in nodes if n['id'] == target)['params'].pop(port, None)
    for i, (id, label, lo, hi, default, scale) in enumerate(CONTROLS):
        node(id, 'perf_controller', dict(label=label, min=lo, max=hi, default=default, scale=scale), -320, 600+i*260)
    formula('amp_madsr.iatt', 'attack', attack='flute_attack.iout')
    formula('amp_madsr.irel', 'release', release='flute_release.iout')
    node('vibrato_delay', 'linseg', dict(ia=0, idur1=.28, ib=0, idur2=.65, ic=1, idur3=3600, id=1), 450, 650)
    node('vibrato', 'lfo', dict(kcps=5.1, itype=0), 700, 650)
    formula('vibrato.kamp', 'depth * 0.00057762265 * fade', depth='flute_vibrato.iout', fade='vibrato_delay.kenv')
    for i, level in enumerate([.52, .105, .038, .014], 1):
        id = 'bore_'+str(i)
        node(id, 'oscil3', dict(ifn=-1, iphs=0), 850, 50+(i-1)*250)
        formula(id+'.amp', f'env * {level}' + (' * (0.35 + 0.65 * velocity)' if i > 1 else ''),
                **{'env':'amp_velocity_envelope.kout', **({'velocity':'velocity_ampmidi.iamp'} if i>1 else {})})
        formula(id+'.freq', f'pitch * {i} * (1 + vibrato)', pitch='pitch_cpsmidi.kfreq', vibrato='vibrato.kout')
    node('breath_noise', 'noise', dict(beta=.1), 850, 1100)
    formula('breath_noise.amp', 'env * breath * 0.065', env='amp_velocity_envelope.kout', breath='flute_breath.iout')
    node('breath_band', 'butterbp', dict(xfreq=2300, xband=2500), 1140, 1100)
    formula('breath_band.asig', 'air', air='breath_noise.aout')
    node('warmth', 'butterlp', {}, 1440, 400)
    formula('warmth.asig', 'fundamental + second + third + fourth + air',
            fundamental='bore_1.asig', second='bore_2.asig', third='bore_3.asig', fourth='bore_4.asig', air='breath_band.aout')
    formula('warmth.xfreq', 'tone', tone='flute_tone.iout')
    formula('output_pan2.asig', 'flute * 0.5', flute='warmth.aout')
    for n in nodes:
        if n['id'].startswith('output_'): n['position']['x'] += 450
    # Keep the stereo output block last, as in CLI-generated graphs.
    graph['nodes'] = [n for n in nodes if not n['id'].startswith('output_')] + [n for n in nodes if n['id'].startswith('output_')]
    validate_graph_invariants(graph)
    PatchCreateRequest.model_validate(payload)
    return payload


def main(action):
    payload = build()
    dump(HERE/'Lake_Bamboo_Flute.spec.json', SPEC)
    dump(HERE/'Lake_Bamboo_Flute.patch.json', payload)
    if action == 'build': return
    client = ApiClient(DEFAULT_API_URL, timeout=120)
    result = compile_payload_preflight(client, payload)
    assert result['state'] == 'compiled', result
    dump(HERE/'validation/compile.json', {k:v for k,v in result.items() if k!='orc'})
    (HERE/'work').mkdir(exist_ok=True)
    (HERE/'work/flute.orc').write_text(result['orc'])
    if action == 'publish':
        checks = json.loads((HERE/'validation/audio.json').read_text())
        assert checks['passed'] and checks['spectrograms_inspected']
        import hashlib
        assert checks['patch_sha256'] == hashlib.sha256((HERE/'Lake_Bamboo_Flute.patch.json').read_bytes()).hexdigest()
        matches = [p for p in client.get('/patches') if p['name']==SPEC['name']]
        if matches:
            saved = client.get('/patches/'+matches[0]['id'])
            assert saved['graph'] == payload['graph'], 'Existing differently authored flute; refusing overwrite.'
        else: saved = client.post('/patches', payload)
        dump(HERE/'library_manifest.json', {'patchId':saved['id'], 'name':saved['name']})
        exported = dict(sourcePatchId=saved['id'], name=saved['name'], description=saved['description'],
                        isTemplate=saved['is_template'], alwaysOn=saved['always_on'],
                        instrumentType=saved['instrument_type'], schema_version=saved['schema_version'], graph=saved['graph'])
        dump(HERE/'Lake_Bamboo_Flute.orch.instrument.json', exported)
        print(saved['id'])
    print('Graph validation and compile preflight passed.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['build','preflight','publish'])
    main(parser.parse_args().action)
