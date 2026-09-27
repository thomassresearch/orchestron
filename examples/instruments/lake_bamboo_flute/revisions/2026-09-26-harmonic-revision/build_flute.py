"""Reproduce the reference-informed bamboo flute using the patch CLI graph spine.

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
    ('flute_attack', 'Attack (s)', .015, .18, .075, 'logarithmic'),
    ('flute_release', 'Release (s)', .08, 1.2, .22, 'logarithmic'),
    ('flute_breath', 'Breath', 0, 1, .55, 'linear'),
    ('flute_tone', 'Tone (Hz)', 1000, 7500, 4800, 'logarithmic'),
    ('flute_vibrato', 'Vibrato (cents)', 0, 15, 9, 'linear'),
]
SPEC = {
    'name': 'Lake Bamboo Flute',
    'description': 'Breathy bamboo flute revised against Samurai Flute Sample: strong '
        'second/third partials, pressure-dependent harmonic bloom, resonant air, soft '
        'breath attacks, a small pitch scoop and irregular delayed vibrato. Synthesized '
        'without sampled audio. Best E3–D6; the reference character is strongest E3–E5. '
        'Velocity shapes loudness, colour and air. Five compatible per-instance controls; '
        'dry Stereo Output, route through Master or a shared room reverb.',
    'family': 'simple_osc',
    'envelope': {'attack': .075, 'decay': .32, 'sustain': .88, 'release': .22},
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
    node('vibrato_delay', 'linseg', dict(ia=0, idur1=.32, ib=0, idur2=.85, ic=1, idur3=3600, id=1), 50, 700)
    node('vibrato_rate', 'jitter', dict(kamp=.55, kcpsmin=.45, kcpsmax=1.3), 50, 960)
    node('vibrato_depth', 'randomi', dict(kmin=.65, kmax=1.2, kcps=1.7, imode=3), 50, 1220)
    node('vibrato', 'lfo', dict(itype=0), 360, 700)
    formula('vibrato.kcps', '4.8 + wander', wander='vibrato_rate.kout')
    formula('vibrato.kamp', 'depth * 0.00057762265 * fade * variation', depth='flute_vibrato.iout', fade='vibrato_delay.kenv', variation='vibrato_depth.kout')
    node('pitch_drift', 'randomi', dict(kmin=-.0026, kmax=.0026, kcps=1.8, imode=3), 50, 1480)
    node('jet_flutter', 'randomi', dict(kmin=-.00065, kmax=.00065, kcps=17, imode=3), 50, 1740)
    node('pitch_scoop', 'linseg', dict(ia=-1, ib=.08, idur2=.12, ic=0, idur3=3600, id=0), 360, 960)
    formula('pitch_scoop.idur1', '.025 + 1.4 * attack', attack='flute_attack.iout')
    node('pressure', 'randomi', dict(kmin=-.09, kmax=.09, kcps=3.2, imode=3), 360, 1220)
    node('colour_wander', 'randomi', dict(kmin=-.22, kmax=.22, kcps=2.1, imode=3), 360, 1480)
    node('harmonic_bloom', 'linseg', dict(ia=.4, idur1=.22, ib=1.12, idur2=.9, ic=.85, idur3=3600, id=.85), 360, 1740)
    node('breath_attack', 'expseg', dict(ia=1, idur1=.09, ib=.3, idur2=.22, ic=.04, idur3=3600, id=.04), 360, 2000)
    # Reference windows show H2 typically around -2 dB and a mobile, often strong H3.
    # Each partial responds to the same pressure, with extra bloom in the overtones.
    for i, level in enumerate([.34, .28, .30, .030, .024, .017, .009], 1):
        id = 'bore_'+str(i)
        node(id, 'oscil3', dict(ifn=-1, iphs=0), 850, 50+(i-1)*250)
        amp = f'env * {level} * (1 + pressure)'
        sources = dict(env='amp_velocity_envelope.kout', pressure='pressure.kout')
        if i > 1:
            amp += ' * (0.40 + 0.60 * velocity) * bloom * (1 + colour)'
            sources.update(velocity='velocity_ampmidi.iamp', bloom='harmonic_bloom.kenv', colour='colour_wander.kout')
            # Let the low register retain a woody body without making the high register shrill.
            amp += f' / (1 + (pitch / {1800 if i == 2 else 950}) * (pitch / {1800 if i == 2 else 950}))'
            sources['pitch'] = 'pitch_cpsmidi.kfreq'
        formula(id+'.amp', amp, **sources)
        formula(id+'.freq', f'pitch * {i} * (1 + vibrato + drift + flutter + .012 * scoop)',
                pitch='pitch_cpsmidi.kfreq', vibrato='vibrato.kout', drift='pitch_drift.kout', flutter='jet_flutter.kout', scoop='pitch_scoop.kenv')
    node('breath_noise', 'noise', dict(beta=.12), 850, 1900)
    formula('breath_noise.amp', 'env * breath * .22 * (.6 + .4 * velocity) * (1 + 2 * attack + 2 * pressure)',
            env='amp_velocity_envelope.kout', breath='flute_breath.iout', velocity='velocity_ampmidi.iamp', attack='breath_attack.kenv', pressure='pressure.kout')
    node('breath_band', 'butterbp', dict(xfreq=2600, xband=3600), 1140, 1800)
    formula('breath_band.asig', 'air', air='breath_noise.aout')
    node('bore_air', 'butterbp', {}, 1140, 2080)
    formula('bore_air.asig', 'air', air='breath_noise.aout')
    formula('bore_air.xfreq', 'pitch * 2.8', pitch='pitch_cpsmidi.kfreq')
    formula('bore_air.xband', 'pitch * 1.5', pitch='pitch_cpsmidi.kfreq')
    node('warmth', 'butterlp', {}, 1440, 400)
    formula('warmth.asig', 'fundamental + second + third + fourth + fifth + sixth + seventh + air + .8 * resonance',
            fundamental='bore_1.asig', second='bore_2.asig', third='bore_3.asig', fourth='bore_4.asig',
            fifth='bore_5.asig', sixth='bore_6.asig', seventh='bore_7.asig', air='breath_band.aout', resonance='bore_air.aout')
    formula('warmth.xfreq', 'tone', tone='flute_tone.iout')
    formula('output_pan2.asig', 'flute * 0.42', flute='warmth.aout')
    for n in nodes:
        if n['id'].startswith('output_'): n['position']['x'] += 450
    # Keep the stereo output block last, as in CLI-generated graphs.
    graph['nodes'] = [n for n in nodes if not n['id'].startswith('output_')] + [n for n in nodes if n['id'].startswith('output_')]
    validate_graph_invariants(graph)
    PatchCreateRequest.model_validate(payload)
    return payload


def main(action):
    from backend.app.models.patch import PatchGraph
    def normalized_graph(graph):
        return PatchGraph.model_validate(graph).model_dump(mode='json')

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
        manifest = json.loads((HERE/'library_manifest.json').read_text())
        patch_id = manifest['patchId']
        saved = client.get('/patches/'+patch_id)
        original = json.loads((HERE/'revisions/2026-09-26-original/library_patch.json').read_text())
        assert saved['name'] == SPEC['name'] and saved['id'] == original['id']
        assert normalized_graph(saved['graph']) in (normalized_graph(original['graph']), normalized_graph(payload['graph'])), 'Flute changed since backup; review before overwriting.'
        original_controls = {n['id'] for n in original['graph']['nodes'] if n['opcode']=='perf_controller'}
        assert original_controls == {c[0] for c in CONTROLS}
        saved = client.put('/patches/'+patch_id, {
            'graph': payload['graph'], 'description': payload['description'],
            'schema_version': payload['schema_version'],
        })
        verified = client.get('/patches/'+patch_id)
        assert normalized_graph(verified['graph']) == normalized_graph(payload['graph'])
        assert verified['instrument_type'] == original['instrument_type']
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
