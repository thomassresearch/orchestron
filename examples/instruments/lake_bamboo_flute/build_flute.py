"""Reproduce the reference-informed bamboo flute and preserve the saved user graph.

Build/preflight first, audition with
validate_audio.py, then publish. API writes never touch other library patches.
"""
import argparse
import copy
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
    'description': 'Breath-first bamboo flute with velocity-driven blowing pressure. '
        'Air starts immediately, then the bore tone builds. Soft/medium notes settle '
        'on the played pitch; firm attacks briefly overblow and fall back; hard blows '
        'favor the octave while held. Ground and octave families overlap and exchange '
        'strength irregularly near the register boundary, then stabilize away from it. '
        'Unequal resonance memory preserves the lower tone through transitions. '
        'A recording-informed modal-envelope approximation, not a full air-jet simulation. '
        'Best E3–E5, playable to D6. Five compatible controls and dry Stereo Output.',
    'family': 'simple_osc',
    'envelope': {'attack': .075, 'decay': .32, 'sustain': .88, 'release': .22},
    'layers': [{'id': 'seed', 'opcode': 'oscili', 'gain': .4, 'table': -1}],
    'output': {'pan': .5},
}


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + '\n')


def build_original_modal_graph():
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
    # Air reaches the edge first; coherent bore oscillation takes time to establish.
    formula('amp_madsr.idel', '.022 + .30 * attack + .020 * (1 - velocity)',
            attack='flute_attack.iout', velocity='velocity_ampmidi.iamp')
    node('breath_env', 'madsr', dict(iatt=.004, idec=.06, islev=1, idel=0), 50, 2260)
    for port in ('irel', 'ireltim'):
        formula('breath_env.'+port, '.018 + .16 * release', release='flute_release.iout')
    # The initial pressure overshoot relaxes to a velocity-dependent sustained blow.
    node('blowing_pressure', 'linseg', dict(ia=0, idur2=.12, idur3=.40), 360, 2260)
    formula('blowing_pressure.idur1', '.014 + .32 * attack', attack='flute_attack.iout')
    for port in ('ib', 'ic'):
        formula('blowing_pressure.'+port, '.30 + .68 * velocity + .22 * velocity * velocity', velocity='velocity_ampmidi.iamp')
    formula('blowing_pressure.id', '.30 + .68 * velocity', velocity='velocity_ampmidi.iamp')
    node('register_threshold', 'k_mul', dict(b=1), 650, 2260)
    formula('register_threshold.a', '(blow * gate - .815) / .13',
            blow='blowing_pressure.kenv', gate='breath_env.kenv')
    node('register_balance', 'k_mul', dict(b=1), 850, 2520)
    formula('register_balance.a', '.5 * (abs(drive) - abs(drive - 1) + 1)', drive='register_threshold.kout')
    # The recordings show irregular, sometimes opposed harmonic envelopes during
    # attacks, and stable upper notes too. Competition is strongest in the broad
    # transition region; attack turbulence fades even when velocity stays high.
    node('competition_rate', 'jitter', dict(kamp=2.4, kcpsmin=2.3, kcpsmax=5.7), 50, 2580)
    node('competition_pulse', 'lfo', dict(kamp=1, itype=0), 360, 2580)
    formula('competition_pulse.kcps', '6.7 + wander', wander='competition_rate.kout')
    node('competition_scatter', 'randomi', dict(kmin=-1, kmax=1, kcps=17.3, imode=3), 50, 2880)
    node('attack_instability', 'linseg', dict(ia=1, idur1=.16, ib=1, idur2=.65, ic=0, idur3=3600, id=0), 360, 2880)
    node('competing_modes', 'k_mul', dict(b=1), 650, 2820)
    formula('competing_modes.a',
            'mean + (.78 * 4 * mean * (1 - mean) + .48 * onset * velocity * velocity) * (.78 * pulse + .22 * scatter)',
            mean='register_balance.kout', onset='attack_instability.kenv', velocity='velocity_ampmidi.iamp',
            pulse='competition_pulse.kout', scatter='competition_scatter.kout')
    node('octave_mode', 'portk', dict(khtim=.006, isig=0), 850, 2820)
    formula('octave_mode.ksig', '.5 * (abs(drive) - abs(drive - 1) + 1)', drive='competing_modes.kout')
    # Different buildup/decay memories avoid a perfectly complementary crossfade.
    # A small residual ground component remains even after the upper mode locks.
    node('ground_resonance', 'portk', dict(khtim=.022, isig=1), 1140, 2620)
    formula('ground_resonance.ksig', '.055 + .945 * (1 - mode)', mode='octave_mode.kout')
    node('upper_resonance', 'portk', dict(khtim=.009, isig=0), 1140, 2880)
    formula('upper_resonance.ksig', 'mode', mode='octave_mode.kout')
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
    node('harmonic_bloom', 'linseg', dict(ia=.75, idur1=.18, ib=1.03, idur2=.6, ic=.92, idur3=3600, id=.92), 360, 1740)
    # Overlapping harmonic families share oscillators at coincident frequencies;
    # their unequal, pressure-dependent envelopes trade intensity, not pitch.
    ground = dict(enumerate([.40, .30, .19, .023, .018, .013, .007], 1))
    octave = {2*(i+1):level for i,level in enumerate([.48, .19, .16, .020, .014, .010])}
    partial_ids = sorted(ground.keys() | octave.keys())
    for i in partial_ids:
        id = 'bore_'+str(i)
        node(id, 'oscil3', dict(ifn=-1, iphs=0), 850, 50+(i-1)*250)
        sources = dict(env='amp_velocity_envelope.kout', pressure='pressure.kout')
        terms = []
        for bank, weight, root in ((ground, 'ground', 1), (octave, 'upper', 2)):
            if i not in bank:
                continue
            sources[weight] = ('ground_resonance' if root == 1 else 'upper_resonance') + '.kout'
            term = f'{bank[i]} * {weight}'
            if i > root:
                cutoff = 1800 if i == 2*root else 950
                term += f' * (.30 + .70 * velocity) * bloom * (1 + colour) / (1 + (pitch * {root} / {cutoff}) * (pitch * {root} / {cutoff}))'
                sources.update(velocity='velocity_ampmidi.iamp', bloom='harmonic_bloom.kenv', colour='colour_wander.kout', pitch='pitch_cpsmidi.kfreq')
            terms.append(term)
        amp = 'env * (1 + pressure) * (' + ' + '.join(terms) + ')'
        formula(id+'.amp', amp, **sources)
        formula(id+'.freq', f'pitch * {i} * (1 + vibrato + drift + flutter + .012 * scoop)',
                pitch='pitch_cpsmidi.kfreq', vibrato='vibrato.kout', drift='pitch_drift.kout', flutter='jet_flutter.kout', scoop='pitch_scoop.kenv')
    node('breath_noise', 'noise', dict(beta=.12), 850, 1900)
    formula('breath_noise.amp', 'velocity * airenv * breath * (.10 + .50 * (1 - capture) * (1 - capture)) * (.7 + .8 * velocity * velocity) * (1 + pressure)',
            airenv='breath_env.kenv', breath='flute_breath.iout', velocity='velocity_ampmidi.iamp', capture='amp_madsr.kenv', pressure='pressure.kout')
    node('breath_band', 'butterbp', dict(xfreq=2600, xband=3600), 1140, 1800)
    formula('breath_band.asig', 'air', air='breath_noise.aout')
    node('bore_air', 'butterbp', {}, 1140, 2080)
    node('bore_capture', 'k_to_a', {}, 1140, 2340)
    formula('bore_capture.kin', 'capture', capture='amp_madsr.kenv')
    formula('bore_air.asig', 'air * capture', air='breath_noise.aout', capture='bore_capture.aout')
    formula('bore_air.xfreq', 'pitch * 2.8 * (1 + mode)', pitch='pitch_cpsmidi.kfreq', mode='octave_mode.kout')
    formula('bore_air.xband', 'pitch * 1.5', pitch='pitch_cpsmidi.kfreq')
    node('warmth', 'butterlp', {}, 1440, 400)
    formula('warmth.asig', ' + '.join(f'h{i}' for i in partial_ids) + ' + air + .8 * resonance',
            **{f'h{i}':f'bore_{i}.asig' for i in partial_ids}, air='breath_band.aout', resonance='bore_air.aout')
    formula('warmth.xfreq', 'tone', tone='flute_tone.iout')
    formula('output_pan2.asig', 'flute * 0.42', flute='warmth.aout')
    for n in nodes:
        if n['id'].startswith('output_'): n['position']['x'] += 450
    # Keep the stereo output block last, as in CLI-generated graphs.
    graph['nodes'] = [n for n in nodes if not n['id'].startswith('output_')] + [n for n in nodes if n['id'].startswith('output_')]
    validate_graph_invariants(graph)
    PatchCreateRequest.model_validate(payload)
    return payload


BASELINE = HERE/'revisions/2026-09-27-pre-legato/library_patch.json'


def apply_legato(payload):
    """Idempotent migration; existing IDs, positions and controller settings survive."""
    payload = copy.deepcopy(payload)
    graph = payload['graph']
    nodes, edges = graph['nodes'], graph['connections']
    if any(n['id'] == 'midi_legato_live' for n in nodes):
        assert {'pressure_overshoot', 'live_blowing_pressure'} <= {n['id'] for n in nodes}
        return payload
    formulas = graph['ui_layout']['input_formulas']
    from backend.app.services.opcode_service import OpcodeService
    catalog = OpcodeService('/static/icons')
    by_id = {n['id']: n for n in nodes}

    def live_source(binding, target, port):
        spec = catalog.get_opcode(by_id[target]['opcode'])
        if next(p for p in spec.inputs if p.id == port).signal_type.value == 'i':
            return
        old = binding['from_node_id']
        if old in ('pitch_cpsmidi', 'velocity_ampmidi'):
            binding['from_node_id'] = 'midi_legato_live'
            binding['from_port_id'] = 'kfreq' if old == 'pitch_cpsmidi' else 'kvelocity'
        elif old == 'blowing_pressure':
            binding['from_node_id'] = 'live_blowing_pressure'
            binding['from_port_id'] = 'kout'

    for edge in edges:
        live_source(edge, edge['to_node_id'], edge['to_port_id'])
    for target, value in formulas.items():
        node, port = target.split('::')
        for binding in value['inputs']:
            live_source(binding, node, port)

    def formula(target, expression, **inputs):
        node, port = target.split('.')
        edges[:] = [e for e in edges if (e['to_node_id'], e['to_port_id']) != (node, port)]
        bindings = []
        for token, source in inputs.items():
            src, out = source.split('.')
            binding = dict(token=token, from_node_id=src, from_port_id=out)
            bindings.append(binding)
            edges.append(dict(from_node_id=src, from_port_id=out, to_node_id=node, to_port_id=port))
        formulas[node+'::'+port] = dict(expression=expression, inputs=bindings)

    for port in ('ib', 'ic', 'id'):
        formulas.pop('blowing_pressure::'+port, None)
        edges[:] = [e for e in edges if (e['to_node_id'], e['to_port_id']) != ('blowing_pressure', port)]
        by_id['blowing_pressure']['params'][port] = 1
    # Add nodes in unused canvas space. Do not move any existing node or block.
    added = [
        dict(id='midi_legato_live', opcode='midi_legato', params={}, position=dict(x=2350,y=900)),
        dict(id='pressure_overshoot', opcode='linseg',
             params=dict(ia=0,ib=1,idur2=.12,ic=1,idur3=.40,id=0), position=dict(x=2350,y=1250)),
        dict(id='live_blowing_pressure', opcode='k_mul', params=dict(b=1), position=dict(x=2690,y=1250)),
    ]
    nodes[-2:-2] = added
    formula('pressure_overshoot.idur1', '.014 + .32 * attack', attack='flute_attack.iout')
    formula('live_blowing_pressure.a', '(.30 + .68 * velocity) * contour + .22 * velocity * velocity * overshoot',
            velocity='midi_legato_live.kvelocity', contour='blowing_pressure.kenv', overshoot='pressure_overshoot.kenv')
    payload['description'] += ' Gapless monophonic legato: connected notes preserve the breath, bore and vibrato; pitch changes immediately and velocity follows with a 10 ms half-time. Gaps articulate a new phrase.'
    validate_graph_invariants(graph)
    return payload


def build():
    from backend.app.models.patch import PatchCreateRequest
    saved = json.loads(BASELINE.read_text())
    payload = {k: v for k, v in saved.items() if k not in ('id', 'created_at', 'updated_at')}
    payload = apply_legato(payload)
    PatchCreateRequest.model_validate(payload)
    assert apply_legato(payload) == payload
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
        original = json.loads(BASELINE.read_text())
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
        exported = client.post('/bundles/export/patch', exported)
        dump(HERE/'Lake_Bamboo_Flute.orch.instrument.json', exported)
        dump(HERE.parent/'Lake_Bamboo_Flute.orch.instrument.json', exported)
        preview = client.post('/bundles/import/expand?preview=true', exported)
        assert normalized_graph(preview['graph']) == normalized_graph(saved['graph'])
        print(saved['id'])
    print('Graph validation and compile preflight passed.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['build','preflight','publish'])
    main(parser.parse_args().action)
