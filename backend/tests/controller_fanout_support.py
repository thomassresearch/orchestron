"""One controller sequencer fans out across native processes without a new clock."""
import json

import numpy as np

from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.session_parallel_renderer import ParallelCsoundRenderer
from backend.app.models.patch import NodeInstance
from backend.app.models.session import SessionSequencerConfigRequest
from backend.app.services.arpeggiator_runtime import PerformanceMidiRouter
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.tests.render_plan_support import FIXTURE_DIR, planner_inputs
from backend.tests.session_parallel_support import options


def probe_controller_fanout(mode):
    fixture = json.loads((FIXTURE_DIR/'controller_fanout.json').read_text())
    targets, graph, mixer = planner_inputs('four', 32)
    sources = [t for t in targets if t.midi_channel]
    for target, channel in zip(sources, fixture['read_channels'], strict=True):
        patch = target.patch.graph
        patch.nodes = [n for n in patch.nodes if n.id != 'amp']
        patch.nodes.append(NodeInstance(id='amp', opcode='ctrl7', params={
            'ichan': channel, 'ictlno': fixture['controller_number'], 'kmin': 0, 'kmax': .1}))
        for link in patch.connections:
            if link.from_node_id == 'amp':
                link.from_port_id = 'kout'
    payload = fixture['sequencer']
    if mode == 'curve':
        track = payload['controller_tracks'][0]
        track['controller_mode'] = 'curve'
        track['pads'] = [{'pad_index': 0, 'length_beats': 2, 'keypoints': [
            {'position': 0, 'value': 0}, {'position': 1, 'value': 127}]}]
    request = SessionSequencerConfigRequest.model_validate(payload)
    compiler = CompilerService(OpcodeService('/static/icons'))
    artifact = compiler.compile_patch_bundle(targets, audio_graph=graph, mixer=mixer,
        midi_input='internal:loopback', rtmidi_module='null')
    parallel = ParallelCsoundRenderer(options=options('parallel'))
    single = CsoundWorker()
    if single.backend != 'ctcsound':
        raise RuntimeError('Native Csound unavailable')
    parallel.prepare(compiler, targets, graph, mixer, artifact)
    plan = parallel._candidate[1]
    owners = {s.instance_id: p.id for p in plan.partitions for stage in p.stages
              for s in plan.graph.stages if s.id == stage and s.kind == 'patch'}
    assert len({owners[t.assignment_id] for t in sources[:3]}) >= 2
    assert owners[sources[0].assignment_id] != owners[sources[2].assignment_id]
    results, traces, meters, stopped_levels = [], [], [], []
    try:
        for worker in (single, parallel):
            trace = []
            def enqueue(message, **kwargs):
                trace.append((kwargs.get('target_engine_sample'), tuple(message)))
                return worker.enqueue_timestamped_midi(message, **kwargs)
            router = PerformanceMidiRouter(enqueue_timestamped_midi=enqueue,
                current_engine_sample=lambda: worker.render_sample_cursor)
            sequencer = SessionSequencerRuntime(session_id='fanout', midi_service=router,
                midi_input_selector='internal:loopback', controller_default_channels=(2, 5),
                clock_mode='render_driven', publish_event=lambda *_: None)
            worker.start(artifact.csd, 'internal:loopback', 'null')
            worker.configure_mixer(artifact.manifest, artifact.manifest['initialControls'])
            # An untargeted channel must retain its independent state in every child.
            worker.enqueue_timestamped_midi([0xB0 + fixture['untargeted_channel'] - 1,
                fixture['controller_number'], 127], source='test', target_engine_sample=0)
            for source in sources:
                worker.enqueue_timestamped_midi([0x90 + source.midi_channel - 1, 60, 100],
                    source='test', target_engine_sample=0)
            sequencer.configure(request)
            sequencer.start(0)
            def before(_index, sample):
                tempo = sequencer.advance_render_block(sample_rate=48000, ksmps=32, block_start_sample=sample)
                router.advance_render_block(block_start_sample=sample, block_end_sample=sample+32,
                    sample_rate=48000, tempo_bpm=tempo)
            result = worker.render_blocks(block_count=512, target_sample_rate=48000, before_block=before)
            levels = worker.drain_mixer_meters()
            sequencer.stop()
            # Cross the normal meter publication interval after the Stop reset.
            worker.render_blocks(block_count=128, target_sample_rate=48000)
            stopped_levels.append(worker.drain_mixer_meters()[-1]['levels'])
            results.append(result)
            traces.append(trace)
            meters.append(levels)
        assert parallel.renderer_diagnostics['selected'] == 'parallel'
        assert len(parallel._coordinator.process_ids) >= 3
        assert traces[0] == traces[1]
        events = traces[1]
        left = [(sample, m[2]) for sample, m in events if m[:2] == (0xB1, 74)]
        right = [(sample, m[2]) for sample, m in events if m[:2] == (0xB4, 74)]
        assert left == right and len({value for _, value in left}) >= 3
        if mode == 'step':
            assert left[0][1] == left[-1][1] == 0  # Start/Stop resets fan out too.
            for levels in stopped_levels:
                # RMS meters retain their decay; instantaneous peaks verify silence.
                assert all(max(levels[name]['peakL'], levels[name]['peakR']) < .00001
                           for name in ('source0', 'source1', 'source2'))
                assert max(levels['source3'].values()) > .001
        assert not any(m[:2] == (0xB6, 74) for _, m in events)
        assert results[0].engine_sample_end == results[1].engine_sample_end == 16384
        np.testing.assert_allclose(np.frombuffer(results[0].pcm_f32le, dtype='<f4'),
            np.frombuffer(results[1].pcm_f32le, dtype='<f4'), rtol=0, atol=1e-7)
        for identity in ('source0', 'source1', 'source2'):
            peaks = [max(frame['levels'][identity].values()) for frame in meters[1]]
            assert min(peaks) < .00001 and max(peaks) > .01
        assert min(max(frame['levels']['source3'].values()) for frame in meters[1][4:]) > .001
        report = {'mode': mode, 'workers': len(parallel._coordinator.process_ids),
            'frames': results[0].engine_sample_end, 'plan_hash': plan.plan_hash,
            'event_count': len(events), 'matching_events': True, 'audio_atol': 1e-7,
            'channel_isolation': True, 'reset_checked': mode == 'step'}
    finally:
        parallel.stop()
        single.stop()
    report['cleaned'] = not parallel._coordinator.process_ids and parallel._coordinator.shared_memory_name is None
    assert report['cleaned']
    return report
