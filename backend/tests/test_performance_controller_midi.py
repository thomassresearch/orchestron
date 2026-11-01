"""Per-instance CC conversion, revisions, delivery and standalone audio regression."""
from io import BytesIO
import json
import shutil
import struct
import subprocess
import zipfile

import numpy as np
import pytest
from backend.app.engine.csound_worker import CsoundWorker
from backend.app.engine.midi_scheduler import EngineMidiEvent
from backend.app.engine.lane_output import LaneRouting
from backend.app.engine.performance_controllers import PerformanceControllers, ControllerRevisionConflict
from backend.app.models.session import SessionInstrumentAssignment
from backend.app.services.compiler_common import PatchInstrumentTarget
from backend.app.services.compiler_service import CompilerService
from backend.app.services.opcode_service import OpcodeService
from backend.app.services.performance_controller_service import controller_bindings, controller_definitions, controller_midi_value
from backend.app.services.performance_export_service import CapturedMidiEvent, PerformanceExportService
from backend.tests.csound_test_support import load_patch_fixture
from backend.tests.api_test_support import _client
from backend.tests.test_api import _performance_csd_export_payload


def fixture():
    return load_patch_fixture('performance_controller_midi')


def configured(queue=None):
    patch = fixture()
    assignments = [SessionInstrumentAssignment(id=name, patch_id=patch.id, midi_channel=channel,
        performance_controller_midi_ccs={node: 21 for node in ('setting', 'count', 'enabled', 'log')})
        for name, channel in [('one', 1), ('two', 2)]]
    targets = [PatchInstrumentTarget(patch, a.midi_channel, assignment_id=a.id,
        performance_controller_midi_ccs=a.performance_controller_midi_ccs) for a in assignments]
    manifest = {t.assignment_id: controller_bindings(t, t.assignment_id) for t in targets}
    state = PerformanceControllers(queue or (lambda controls: None))
    state.configure(assignments, manifest)
    return state, assignments, targets, manifest


def cc(value, channel=1, number=21):
    return EngineMidiEvent(0, 0, 'test', bytes([0xB0 + channel - 1, number, value]))


def test_conversion_boundaries_and_quantization():
    definitions = {d.node_id: d for d in controller_definitions(fixture().graph)}
    for d in definitions.values():
        assert controller_midi_value(0, d) == d.min
        assert controller_midi_value(127, d) == d.max
    assert controller_midi_value(63, definitions['enabled']) == 0
    assert controller_midi_value(64, definitions['enabled']) == 1
    assert controller_midi_value(63.5, definitions['log']) == pytest.approx(1)
    d = definitions['count'].model_copy(update={'min': -2, 'max': -1})
    assert controller_midi_value(63.5, d) == -1


def test_instance_isolation_repeated_cc_revisions_reassignment_and_reset():
    state, assignments, _, _ = configured()
    before = state.snapshot('one')
    state.deliver([cc(127)])
    assert state.snapshot('one')['values'] == {'setting': 1, 'count': 3, 'enabled': 1, 'log': 1000}
    assert state.snapshot('two')['values'] == {}
    with pytest.raises(ControllerRevisionConflict):
        state.update('one', {'setting': .4}, revisions=before['revisions'])
    state.update('one', {'setting': .4})
    state.deliver([cc(127)])
    assert assignments[0].performance_controller_values['setting'] == 1
    state.update('one', {'setting': None})
    assert state.snapshot('one')['midi_ccs']['setting'] == 21
    state.update('one', {}, {'setting': 22})
    state.deliver([cc(0)])
    assert 'setting' not in state.snapshot('one')['values']
    state.deliver([cc(0, number=22), cc(127, channel=2)])
    assert state.snapshot('one')['values']['setting'] == 0
    assert state.snapshot('two')['values']['setting'] == 1
    state.update('one', {}, {'setting': None})
    assert state.snapshot('one')['values']['setting'] == 0


def test_live_reassignment_is_independent_of_incoming_value_revisions():
    state, _, _, _ = configured()
    before = state.snapshot('one')
    state.deliver([cc(64), cc(65), cc(66)])
    state.update('one', {}, {'setting': 22}, revisions=before['revisions'],
                 midi_revisions=before['midi_revisions'])
    assert state.snapshot('one')['values']['setting'] == pytest.approx(66 / 127)
    with pytest.raises(ControllerRevisionConflict):
        state.update('one', {}, {'setting': 23}, revisions=before['revisions'],
                     midi_revisions=before['midi_revisions'])
    state.deliver([cc(127)])
    assert state.snapshot('one')['values']['setting'] == pytest.approx(66 / 127)
    state.deliver([cc(0, number=22)])
    assert state.snapshot('one')['values']['setting'] == 0


def test_delivery_respects_lane_gating_and_multi_channel_output():
    _, assignments, _, manifest = configured()
    worker = CsoundWorker()
    worker.performance_controllers.configure(assignments, manifest)
    gate = worker._midi_scheduler.lane_output
    gate.routing = {'controller': LaneRouting((1, 2))}
    gate.apply(0, {'controller': {'mute': True, 'solo': False}})
    for channel in (1, 2):
        worker.enqueue_timestamped_midi([0xB0 + channel - 1, 21, 127], source='lane:controller')
    worker._prepare_host_midi_block(block_start_sample=0, block_end_sample=32)
    assert all(not snapshot['values'] for snapshot in worker.performance_controllers.snapshot().values())
    gate.apply(1, {})
    for channel in (1, 2):
        worker.enqueue_timestamped_midi([0xB0 + channel - 1, 21, 127], source='lane:controller')
    worker._prepare_host_midi_block(block_start_sample=0, block_end_sample=32)
    assert all(snapshot['values']['setting'] == 1 for snapshot in worker.performance_controllers.snapshot().values())
    assert bytes(worker._host_midi_buffer) == bytes([0xB0, 21, 127, 0xB1, 21, 127])


def test_export_setter_timing_uses_encoded_midi_ticks_or_exact_score_samples():
    _, _, targets, bindings = configured()
    # The two messages quantize to one MIDI tick but must retain delivery order.
    events = [CapturedMidiEvent(time_seconds=sample / 48000, sequence=index,
                               message=bytes([0xB0, 21, value]))
              for index, (sample, value) in enumerate([(481, 0), (482, 127)])]
    manifest = {'performanceControllers': bindings}
    score = PerformanceExportService._mapped_controller_lines(events, targets, manifest)
    midi = PerformanceExportService._mapped_controller_lines(events, targets, manifest, midi_tempo=137)
    assert score[0][0] == 481 / 48000
    assert score[4][0] == 482 / 48000
    tick = round(481 / 48000 * 137 * 480 / 60)
    expected = tick * round(60_000_000 / 137) / (1_000_000 * 480)
    assert all(time == expected for time, _ in midi)
    assert [float(line.split()[-1]) for _, line in midi] == [0, -3, 0, .001, 1, 3, 1, 1000]


@pytest.mark.parametrize('offset', [-1, 0, 1])
def test_sparse_score_setters_render_identical_note_initialization(monkeypatch, offset):
    from backend.app.engine.ctcsound_loader import load_ctcsound_module
    from backend.app.models.session import SessionSequencerTimingConfig
    from backend.app.services.compiler_common import CompilationProfile

    _, _, targets, _ = configured()
    for target in targets:
        target.patch.graph.engine_config.ksmps = 1
    artifact = CompilerService(OpcodeService(icon_prefix='/static/icons')).compile_patch_bundle(
        targets, midi_input='0', rtmidi_module='none', performance_input_mode='score',
        profile=CompilationProfile.OFFLINE)
    messages = [(0, [0xB0, 21, 20]), (0, [0xB0, 21, 20]), (.01, [0x90, 60, 100]),
                (.03, [0x80, 60, 0]), (.05 + offset / 48000, [0x90, 62, 100]),
                (.09, [0x80, 62, 0]), (.12, [0xB0, 21, 0])]
    messages += [(step / 1000, [0xB0, 21, step]) for step in range(11, 80)]
    messages += [(.05, [0xB0, 21, 100]), (.05, [0xB0, 21, 90])]
    events = [CapturedMidiEvent(time, bytes(message), sequence)
              for sequence, (time, message) in enumerate(messages)]
    service = PerformanceExportService(None, None)
    args = dict(events=events, targets=targets, manifest=artifact.manifest, orchestra=artifact.orc,
                duration_seconds=.15, timing=SessionSequencerTimingConfig())
    compact, _ = service._build_score_lines(**args)
    monkeypatch.setattr(PerformanceExportService, '_compact_mapped_controller_events', staticmethod(lambda events, _: events))
    original, _ = service._build_score_lines(**args)
    assert len(compact) < len(original)

    def render(lines):
        csd = '\n'.join(['<CsoundSynthesizer>', '<CsOptions>', '-n -d -m0', '</CsOptions>',
            '<CsInstruments>', artifact.orc, '</CsInstruments>', '<CsScore>', *lines,
            '</CsScore>', '</CsoundSynthesizer>'])
        cs = load_ctcsound_module().Csound()
        try:
            assert cs.compileCsdText(csd) == 0
            assert cs.start() == 0
            samples = []
            while cs.performKsmps() == 0:
                samples.append(cs.spout().copy())
            return np.array(samples)
        finally:
            cs.cleanup()
            cs.reset()
    before, after = render(original), render(compact)
    assert np.max(before) > 0
    np.testing.assert_array_equal(after, before)


@pytest.mark.parametrize('ksmps', [1, 32])
def test_native_delivery_is_due_gated_and_precedes_note_initialization(monkeypatch, ksmps):
    monkeypatch.delenv('VISUALCSOUND_FORCE_MOCK_ENGINE', raising=False)
    monkeypatch.setenv('VISUALCSOUND_AUDIO_OUTPUT_MODE', 'browser_clock')
    _, assignments, targets, manifest = configured()
    targets = targets[:1]
    targets[0].patch.graph.engine_config.ksmps = ksmps
    artifact = CompilerService(OpcodeService('/static/icons')).compile_patch_bundle(targets, '0', 'none')
    worker = CsoundWorker()
    if worker.backend != 'ctcsound':
        pytest.skip('Native Csound unavailable')
    try:
        worker.start(artifact.csd, midi_input='0', rtmidi_module='none')
        worker.performance_controllers.configure(assignments[:1], {'one': manifest['one']})
        worker.enqueue_timestamped_midi([0xB0, 21, 127], source='host', target_engine_sample=ksmps)
        worker.enqueue_timestamped_midi([0x90, 60, 100], source='host', target_engine_sample=ksmps)
        worker.render_blocks(block_count=1, target_sample_rate=48000)
        assert worker.performance_controllers.snapshot('one')['values'] == {}
        pcm = worker.render_blocks(block_count=3, target_sample_rate=48000)
        assert np.frombuffer(pcm.pcm_f32le, dtype=np.float32)[-1] == pytest.approx(1)
        worker.enqueue_timestamped_midi([0xB0, 21, 0], source='host')
        pcm = worker.render_blocks(block_count=2, target_sample_rate=48000)
        assert np.frombuffer(pcm.pcm_f32le, dtype=np.float32)[-1] == pytest.approx(1)  # held note
    finally:
        worker.stop()


@pytest.mark.parametrize('mode', ['midiFile', 'score'])
@pytest.mark.parametrize('with_mixer', [False, True])
@pytest.mark.parametrize('automation', ['manual', 'step', 'curve', 'legato'])
def test_export_mapped_cc_renders_without_client(tmp_path, mode, with_mixer, automation):
    if not shutil.which('csound'):
        pytest.skip('Native Csound unavailable')
    payload = _performance_csd_export_payload()
    payload['eventSource'] = mode
    exported = payload['performanceExport']
    patch = fixture()
    if automation == 'legato':
        patch.graph.nodes.extend(node for node in load_patch_fixture('midi_legato').graph.nodes if node.opcode in {'midi_legato', 'madsr'})
    exported['patch_definitions'][0]['graph'] = patch.graph.model_dump(mode='json', by_alias=True)
    config = {'version': 22, 'instruments': [{'id': 'one', 'patchId': 'patch-1', 'midiChannel': 1,
        'performanceControllerValues': {'setting': .2}, 'performanceControllerMidiCCs': {'setting': 21}}]}
    if with_mixer:
        config.update(audioGraph={'routes': [], 'masterId': '$master', 'insertOwners': {}}, mixer={'strips': {}, 'sends': {}})
    exported['performance']['config'] = config
    payload['midiControllers'] = [{'controllerNumber': 21, 'value': 127, 'targetChannels': [1]}]
    if automation == 'manual':
        payload['sequencerConfig']['controller_tracks'] = []
    else:
        track = payload['sequencerConfig']['controller_tracks'][0]
        track.update(controller_number=21, target_channels=[1])
        if automation != 'curve':
            track['controller_mode'] = 'step'
            track['pads'][0]['steps'] = [127, None, 64, None]
        # Each later note/phrase must adopt the automation value at its boundary.
        payload['sequencerConfig']['tracks'][0]['pads'][0]['steps'][2] = {'note': 64, 'hold': False, 'velocity': 100}
    with _client(tmp_path) as client:
        response = client.post('/api/bundles/export/performance-csd', json=payload)
        assert response.status_code == 200, response.text
        native = client.post('/api/bundles/export/performance', json=exported)
        assert native.status_code == 200
        assert json.loads(native.content)['performance']['config']['instruments'][0]['performanceControllerMidiCCs'] == {'setting': 21}
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        archive.extractall(tmp_path/'render')
    csd = next((tmp_path/'render').rglob('*.csd'))
    result = subprocess.run(['csound', '-m0', csd.name], cwd=csd.parent, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr.decode()
    wav = next(csd.parent.glob('*.wav')).read_bytes()
    offset = 12
    audio = None
    while offset + 8 <= len(wav):
        kind, size = struct.unpack_from('<4sI', wav, offset)
        if kind == b'data':
            audio = np.frombuffer(wav[offset + 8:offset + 8 + size], dtype='<f4')
        offset += 8 + size + size % 2
    assert audio is not None
    if automation == 'manual':
        assert np.max(audio) == pytest.approx(1, abs=1e-5)
    else:
        audio = audio.reshape(-1, 2)
        assert audio[round(.02 * 48000), 0] == pytest.approx(0 if automation == 'curve' else 1, abs=1e-5)
        assert audio[round(.27 * 48000), 0] == pytest.approx(64 / 127, abs=1e-5)
