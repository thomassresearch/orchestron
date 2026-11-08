"""Isolated container-only playback evidence server; never ordinary startup."""
# ruff: noqa: E402 -- Isolate database/assets before importing application settings.
import json
import os
from pathlib import Path
import tempfile

DATA = Path(tempfile.mkdtemp(prefix='orchestron-t07b-'))
os.environ.update(VISUALCSOUND_DATABASE_URL=f'sqlite:///{DATA}/probe.db',
    VISUALCSOUND_GEN_AUDIO_ASSETS_DIR=str(DATA/'audio'), VISUALCSOUND_STATIC_DIR='/app/backend/app/static',
    VISUALCSOUND_FRONTEND_DIST_DIR='/app/frontend/dist', VISUALCSOUND_FORCE_MOCK_ENGINE='false',
    VISUALCSOUND_DEFAULT_MIDI_DEVICE='internal:loopback')
from backend.app.main import create_app
from backend.app.engine.session_renderer_options import SessionRendererOptions
from backend.app.models.render_protocol import RendererPolicy
from backend.tests.render_plan_support import synthetic_costs
mode = os.environ.get('T07B_RENDERER', 'parallel')
options = None if mode == 'single' else SessionRendererOptions(policy=RendererPolicy(mode='parallel', max_workers=8),
    costs=synthetic_costs, allow_unqualified=True)
app = create_app(renderer_options=options)

@app.get('/probe/fixture')
async def fixture():
    from backend.tools._parallel_render_workload import Workload, build_workload_inputs
    spec = next(c for c in json.loads(Path('/app/backend/tests/fixtures/parallel_render/qualification_workloads.json').read_text())['cases']
                if c['id'] == os.environ.get('T07B_CASE', 'realtime_4'))
    case = Workload.model_validate({k:v for k,v in spec.items() if k != 'filter_resonance'})
    targets, graph, mixer, request = build_workload_inputs(case, 32)
    for target in targets:
        for node in target.patch.graph.nodes:
            if node.opcode == 'moogladder' and 'filter_resonance' in spec:
                node.params['kres'] = spec['filter_resonance']
    request.playback_end_step = 100000  # Same repeated pattern; extend finite duration for soak.
    return {'specification':spec, 'targets':[{'identity':t.assignment_id,'channel':t.midi_channel,
        'patch':{'name':t.patch.name,'always_on':t.always_on,'graph':t.patch.graph.model_dump(mode='json')}} for t in targets],
        'graph':graph.model_dump(mode='json',by_alias=True), 'mixer':mixer.model_dump(mode='json',by_alias=True),
        'sequencer':request.model_dump(mode='json')}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app,host='0.0.0.0',port=8000,log_level='warning')
