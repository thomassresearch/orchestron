"""Timing contract shared by live playback, exports and the standalone CLI."""
from copy import deepcopy
from fractions import Fraction
import importlib.util
import json
from pathlib import Path

import pytest

from backend.app.models.session import SessionSequencerConfigRequest, SessionSequencerTrackConfig
from backend.app.services.sequencer_runtime_config import compile_sequencer_runtime_config
from backend.app.services.sequencer_runtime import SessionSequencerRuntime
from backend.app.services.sequencer_runtime_constants import TRANSPORT_SUBUNITS_PER_BEAT as BEAT
from backend.app.services.sequencer_timing_migration import migrate_sequencer_timing
from backend.tests.test_sequencer_note_timing import make_runtime, advance, notes

FIXTURES = json.loads((Path(__file__).parent / 'fixtures/sequencers/timing_migration.json').read_text())
RATIOS = [(1, 1), (2, 1), (3, 2), (4, 3), (3, 4), (5, 4), (4, 5), (7, 4)]


@pytest.mark.parametrize('case', FIXTURES, ids=lambda case: case['name'])
def test_shared_migrations_are_exact_nonmutating_and_idempotent(case):
    spec = importlib.util.spec_from_file_location('cli_timing', Path(__file__).parents[2] / 'integrations/skills/orchestron-performance-creator/src/orchestron/timing_migration.py')
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    for migrate in (migrate_sequencer_timing, cli.migrate_sequencer_timing):
        source = deepcopy(case['input'])
        actual = migrate(source, app_state=case['appState'])
        assert source == case['input']
        assert actual == case['expected']
        assert migrate(actual, app_state=case['appState']) is actual


@pytest.mark.parametrize('grid', [1, 2, 3, 4, 6, 8])
@pytest.mark.parametrize('denominator', [4, 8])
@pytest.mark.parametrize('numerator,denom', RATIOS)
def test_every_subdivision_meter_speed_has_exact_stable_boundaries(grid, denominator, numerator, denom):
    config = compile_sequencer_runtime_config(SessionSequencerConfigRequest.model_validate({
        'tracks': [{'track_id': 'lead', 'length_beats': 5, 'timing': {
            'beat_unit': 'meter', 'meter_denominator': denominator, 'steps_per_beat': grid,
            'beat_rate_numerator': numerator, 'beat_rate_denominator': denom},
            'pads': [{'pad_index': 0, 'length_beats': 5, 'steps': [60] * (5 * grid)}]}]
    }), controller_default_channels=(1,))
    timing = config.tracks['lead'].timing
    expected = Fraction(BEAT * 4 * denom, denominator * grid * numerator)
    assert expected.denominator == 1
    assert timing.transport_subunits_per_local_step == expected
    track = config.tracks['lead']
    for loop in (1, 7, 100_000):
        boundary = int(expected * grid * 5 * loop)
        assert SessionSequencerRuntime._local_step_for(track, boundary) == 0
        assert SessionSequencerRuntime._local_step_for(track, boundary - 1) == 5 * grid - 1
        assert SessionSequencerRuntime._local_step_boundary_reached(track, boundary)
        assert not SessionSequencerRuntime._local_step_boundary_reached(track, boundary - 1)
    assert timing.step_duration_seconds == pytest.approx(float(expected / BEAT / 2))


def test_triplet_attacks_span_two_seconds_and_six_eight_spans_three_quarters():
    runtime, capture, request = make_runtime([60] * 12, length_beats=4, timing={'beat_unit': 'meter', 'steps_per_beat': 3},
                                      pads=[{'pad_index': 0, 'length_beats': 4, 'steps': [60] * 12}])
    request.playback_end_step = 32
    request.tracks.append(SessionSequencerTrackConfig.model_validate({
        'track_id': 'drums', 'midi_channel': 10, 'length_beats': 4,
        'timing': {'beat_unit': 'meter', 'steps_per_beat': 1},
        'pads': [{'pad_index': 0, 'length_beats': 4, 'steps': [36] * 4}]}))
    runtime.configure(request)
    advance(runtime, capture, 13440)
    attacks = [at for at, msg in notes(capture) if msg[0] == 0x90]
    assert attacks == list(range(0, 13440, 1120))
    assert [at for at, msg in notes(capture) if msg[0] == 0x99] == [0, 3360, 6720, 10080]
    assert runtime._config.tracks['lead'].timing.transport_subunits_per_local_step * 12 == 4 * BEAT
    request = SessionSequencerConfigRequest.model_validate({'tracks': [{'track_id': 'six', 'length_beats': 6,
        'timing': {'beat_unit': 'meter', 'meter_denominator': 8}}]})
    config = compile_sequencer_runtime_config(request, controller_default_channels=(1,))
    assert config.playback_end_subunit == 3 * BEAT


@pytest.mark.parametrize('grid', [2, 4, 8])
@pytest.mark.parametrize('numerator,denom', RATIOS)
def test_legacy_eighth_meter_schedule_matches_migration_with_holds_offsets_rests_and_curves(grid, numerator, denom):
    timing = {'meter_denominator': 8, 'steps_per_beat': grid, 'beat_rate_numerator': numerator, 'beat_rate_denominator': denom}
    payload = {'tracks': [{'track_id': 'lead', 'length_beats': 6, 'timing': timing,
        'pad_loop_enabled': True, 'pad_loop_sequence': [0, -16], 'pads': [{'pad_index': 0, 'length_beats': 6,
        'steps': [{'note': 60, 'timing_offset_percent': -23}, {'hold': True}, 64]}]}],
        'controller_tracks': [{'track_id': 'cc', 'controller_number': 74, 'length_beats': 16, 'timing': {**timing, 'steps_per_beat': 2},
        'pad_loop_enabled': True, 'pad_loop_sequence': [0, -16], 'pads': [{'pad_index': 0, 'length_beats': 16,
        'keypoints': [{'position': 0, 'value': 0}, {'position': .37, 'value': 127}, {'position': 1, 'value': 7}]}]}]}
    old = compile_sequencer_runtime_config(SessionSequencerConfigRequest.model_validate(payload), controller_default_channels=(1,))
    new_payload = deepcopy(payload)
    for field in ['tracks', 'controller_tracks']:
        for track in new_payload[field]:
            track['length_beats'] *= 2
            track['timing'] = {**track['timing'], 'beat_unit': 'meter', 'steps_per_beat': track['timing']['steps_per_beat'] // 2}
            track['pad_loop_sequence'] = [0, -32]
            for pad in track['pads']:
                pad['length_beats'] *= 2
    new = compile_sequencer_runtime_config(SessionSequencerConfigRequest.model_validate(new_payload), controller_default_channels=(1,))
    assert old.playback_end_subunit == new.playback_end_subunit
    assert old.tracks['lead'].pads[0].steps == new.tracks['lead'].pads[0].steps
    assert old.tracks['lead'].timing.transport_subunits_per_local_step == new.tracks['lead'].timing.transport_subunits_per_local_step
    assert old.controller_tracks['cc'].pads[0].events == new.controller_tracks['cc'].pads[0].events
