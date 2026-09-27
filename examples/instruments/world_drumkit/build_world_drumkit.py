"""Build the sample-free World Drumkit graph with the patch-creator CLI library.

Run from the repository root with .venv/bin/python. No backend writes here.
The companion JSON is the editable, complete voice/parameter specification.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'integrations/skills/orchestron-patch-creator/src'))
sys.path.insert(0, str(ROOT))
from orchestron_patch.cli.orchestron_patch_cli import build_patch_payload, validate_graph_invariants
from backend.app.models.patch import PatchCreateRequest

HERE = Path(__file__).resolve().parent

def build(spec):
    payload = build_patch_payload(spec['spine'])
    graph = payload['graph']
    # The CLI supplies the MIDI/envelope/output spine; replace its simple source.
    keep = {'pitch_cpsmidi','velocity_ampmidi','velocity_scale_const','amp_madsr',
            'env_attack_const','env_decay_const','env_sustain_const','env_release_const',
            'env_delay_const','env_release_time_const'}
    graph['nodes'] = [n for n in graph['nodes'] if n['id'] in keep]
    graph['connections'] = [c for c in graph['connections'] if c['from_node_id'] in keep and c['to_node_id'] in keep]
    graph['ui_layout'] = {'input_formulas': {}, 'audio_blocks': {'main-output': True}, 'control_flow_blocks': {}}
    graph['control_flow'] = {}
    graph['engine_config'].update({'sr':48000,'ksmps':32,'control_rate':1500})
    nodes, edges, formulas = graph['nodes'], graph['connections'], graph['ui_layout']['input_formulas']
    def node(id, opcode, params=None, x=0, y=0):
        nodes.append({'id':id,'opcode':opcode,'params':params or {},'position':{'x':x,'y':y}})
        return id
    def edge(src, dst):
        a,b=src.split('.'); c,d=dst.split('.')
        item={'from_node_id':a,'from_port_id':b,'to_node_id':c,'to_port_id':d}
        if item not in edges: edges.append(item)
    def formula(dst, expression, **bindings):
        d,p=dst.split('.')
        for s in bindings.values(): edge(s,dst)
        formulas[f'{d}::{p}']={'expression':expression,'inputs':[{'token':k,'from_node_id':s.split('.')[0],'from_port_id':s.split('.')[1]} for k,s in bindings.items()]}
        for n in nodes:
            if n['id']==d: n['params'].pop(p,None); break
    node('midi_note','notnum',x=-1100,y=0)
    for i,c in enumerate(spec['controllers']):
        node(c['id'],'perf_controller',{k:v for k,v in c.items() if k!='id'},x=-1100,y=350+i*350)
    # Release gate is deliberately much slower than the finite percussion envelopes.
    # Very short MIDI triggers therefore retain the natural body decay.
    formula('amp_madsr.irel','4 * decay',decay='world_decay.iout')
    graph['connections']=[c for c in edges if not (c['to_node_id']=='amp_madsr' and c['to_port_id']=='irel' and c['from_node_id']!='world_decay')]
    edges=graph['connections']
    node('velocity_gate','k_mul',x=-650,y=400)
    formula('velocity_gate.a','velocity * gate',velocity='velocity_ampmidi.iamp',gate='amp_madsr.kenv')
    nodes[-1]['params']['b']=1
    # Named shared finite decays; tonal sources still exist only in selected If cases.
    for i,(key,dur) in enumerate(spec['decays'].items()):
        node('env_'+key,'expseg',{'ia':1,'ib':0.001,'ic':0.000001},x=-650+(i//6)*320,y=800+(i%6)*330)
        formula('env_'+key+'.idur1',f'{dur} * decay',decay='world_decay.iout')
        formula('env_'+key+'.idur2',f'{dur*.35} * decay',decay='world_decay.iout')
        node('amp_'+key,'k_mul',x=30+(i//6)*300,y=800+(i%6)*330)
        edge('env_'+key+'.kenv','amp_'+key+'.a'); edge('velocity_gate.kout','amp_'+key+'.b')
    # Dimensionless pitch motions, shared across voices of one event.
    for i,(key,params) in enumerate(spec['motions'].items()):
        node('motion_'+key,'expseg',params,x=-300,y=2900+i*330)
    for i,(key,t) in enumerate(spec['textures'].items()):
        node('noise_'+key,'noise',{'beta':t.get('color',0)},x=400,y=750+i*300)
        formula('noise_'+key+'.amp',f"env * {t['level']} * (0.7 + 0.3 * bright)",env='amp_'+t['env']+'.kout',bright='world_brightness.iout')
        node('texture_'+key,'butterbp',{'xband':t['band']},x=740,y=750+i*300)
        edge('noise_'+key+'.aout','texture_'+key+'.asig')
        formula('texture_'+key+'.xfreq',f"{t['freq']} * bright",bright='world_brightness.iout')
    for i,v in enumerate(spec['voices']):
        prefix=v['id']; block=prefix+'_if'; x=1300+(i//11)*550; y=(i%11)*350
        node(block,'If',{'rhs':v['note']},x=x,y=y)
        edge('midi_note.inote',block+'.lhs')
        graph['ui_layout']['control_flow_blocks'][block]=True
        member_start=len(nodes)
        signals=[]; weights=[]
        for j,p in enumerate(v.get('partials',[])):
            # [frequency, relative level, envelope, optional pitch-motion key]
            freq,level,env,*motion=p
            osc=prefix+'_partial_'+str(j+1)
            node(osc,'oscil3',{'ifn':-1,'iphs':0},x=x+30+(j%4)*330,y=y+700+(j//4)*340)
            amp_expr=f'env * {level}'
            amp_bind={'env':'amp_'+env+'.kout'}
            if j>0:
                amp_expr+=' * (0.65 + 0.35 * bright)'; amp_bind['bright']='world_brightness.iout'
            formula(osc+'.amp',amp_expr,**amp_bind)
            freq_expr=f'{freq} * tuning'; freq_bind={'tuning':'world_tuning.iout'}
            if v.get('tabla'):
                freq_expr+=' * tabla'; freq_bind['tabla']='world_tabla_tuning.iout'
            if motion:
                freq_expr+=' * motion'; freq_bind['motion']='motion_'+motion[0]+'.kenv'
            formula(osc+'.freq',freq_expr,**freq_bind)
            signals.append(osc+'.asig'); weights.append(1)
        for key,level in v.get('textures',[]):
            signals.append('texture_'+key+'.aout'); weights.append(level)
        if v.get('shaker'):
            s=v['shaker']; source=prefix+'_shaker'
            node(source,'sekere',{'idettack':0.01,'inum':s['objects'],'idamp':s['damping'],'imaxshake':0},x=x+30,y=y+1050)
            formula(source+'.iamp',f"velocity * {s['level']}",velocity='velocity_ampmidi.iamp')
            shaped=prefix+'_shape'; node(shaped,'k_to_a',x=x+360,y=y+1050)
            formula(shaped+'.kin','env * (0.65 + 0.35 * bright)',env='amp_'+s['env']+'.kout',bright='world_brightness.iout')
            mul=prefix+'_shaped'; node(mul,'a_mul',x=x+690,y=y+1050)
            edge(source+'.asig',mul+'.a'); edge(shaped+'.aout',mul+'.b')
            signals.append(mul+'.aout'); weights.append(1)
        if v.get('scrape'):
            s=v['scrape']; pulse=prefix+'_ridges'
            node(pulse,'vco2',{'kamp':1,'imode':2,'kpw':s['width'],'kcps':s['rate']},x=x+30,y=y+1050)
            shaped=prefix+'_scrape'; node(shaped,'a_mul',x=x+360,y=y+1050)
            formula(shaped+'.a','noise * (0.5 + 0.5 * ridge)',noise='texture_'+s['texture']+'.aout',ridge=pulse+'.asig')
            nodes[-1]['params']['b']=s['level']
            signals.append(shaped+'.aout');weights.append(1)
        result=prefix+'_result'; node(result,'CaseResult',x=x+1300,y=y+1550)
        bind={f's{j}':s for j,s in enumerate(signals)}
        formula(result+'.left',' + '.join(f's{j} * {w}' for j,w in enumerate(weights)),**bind)
        members=[n['id'] for n in nodes[member_start:]]
        silent=prefix+'_silence';node(silent,'CaseResult',x=x+1300,y=y+1950)
        graph['control_flow'][block]={'kind':'if','output_format':'mono','operator':'==','cases':[
            {'id':prefix+'_hit','name':f"{v['note']}: {v['name']}",'value':None,'node_ids':members,'result_node_id':result,'silence':False},
            {'id':prefix+'_off','name':'Other notes: silence','value':None,'node_ids':[silent],'result_node_id':silent,'silence':True}]}
    node('output_pan2','pan2',{'xp':0.5,'imode':0},x=4400,y=1100)
    for v in spec['voices']: edge(v['id']+'_if.left','output_pan2.asig')
    node('output_left','outleta',{'sname':'left'},x=4800,y=1050)
    node('output_right','outleta',{'sname':'right'},x=4800,y=1350)
    edge('output_pan2.aleft','output_left.asignal');edge('output_pan2.aright','output_right.asignal')
    graph['ui_layout']['editor_state']={'selection':{'nodeIds':[],'connections':[]},'viewport':{'x':250,'y':120,'k':0.22}}
    payload.update(name='World Drumkit',description=spec['description'],schema_version=2,instrument_type='percussion',always_on=False,is_template=False)
    validate_graph_invariants(graph)
    PatchCreateRequest.model_validate(payload)
    return payload

if __name__=='__main__':
    spec=json.loads((HERE/'World_Drumkit.spec.json').read_text())
    payload=build(spec)
    out=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/world-drumkit-validation/World_Drumkit.patch.json')
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,indent=2)+'\n')
    print(json.dumps({'path':str(out),'voices':len(spec['voices']),'nodes':len(payload['graph']['nodes']),'connections':len(payload['graph']['connections']),'description_characters':len(payload['description'])}))
